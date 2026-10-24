const express = require('express');
const { pool } = require('./db');
const { requireUser } = require('./auth');
const v = require('./views');

const router = express.Router();
const STATUSES = ['todo', 'doing', 'done'];

// ---------- dashboard: aggregate queries over the user's entries ----------

router.get('/dashboard', requireUser, async (req, res) => {
  const uid = [req.user.id];
  const [totals, perLab, perDay, topTags, progress] = await Promise.all([
    pool.query(
      `SELECT count(*)::int AS entries,
              count(DISTINCT lab)::int AS labs,
              coalesce(sum(CASE WHEN trim(body) = '' THEN 0
                                ELSE cardinality(regexp_split_to_array(trim(body), '\\s+')) END), 0)::int AS words,
              max(created_at) AS latest
         FROM entries WHERE user_id = $1`, uid),
    pool.query(
      `SELECT g AS lab, count(e.id)::int AS n
         FROM generate_series(1, 10) g
         LEFT JOIN entries e ON e.lab = g AND e.user_id = $1
        GROUP BY g ORDER BY g`, uid),
    pool.query(
      `SELECT to_char(d, 'DD') AS day, count(e.id)::int AS n
         FROM generate_series((current_date - 13)::timestamp, current_date::timestamp, interval '1 day') d
         LEFT JOIN entries e ON e.user_id = $1 AND e.created_at::date = d::date
        GROUP BY d ORDER BY d`, uid),
    pool.query(
      `SELECT t AS tag, count(*)::int AS n FROM entries e, unnest(e.tags) AS t
        WHERE e.user_id = $1 GROUP BY t ORDER BY n DESC, t LIMIT 6`, uid),
    pool.query(`SELECT status, count(*)::int AS n FROM lab_progress WHERE user_id = $1 GROUP BY status`, uid),
  ]);

  const done = progress.rows.find((r) => r.status === 'done')?.n || 0;
  const doing = progress.rows.find((r) => r.status === 'doing')?.n || 0;
  v.render(req, res, 'Dashboard', v.dashboardPage({
    totals: totals.rows[0],
    perLab: perLab.rows,
    perDay: perDay.rows,
    topTags: topTags.rows,
    done,
    doing,
  }));
});

// ---------- lab progress ----------

router.get('/progress', requireUser, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT g AS lab, coalesce(p.status, 'todo') AS status, count(e.id)::int AS entries
       FROM generate_series(1, 10) g
       LEFT JOIN lab_progress p ON p.user_id = $1 AND p.lab = g
       LEFT JOIN entries e ON e.user_id = $1 AND e.lab = g
      GROUP BY g, p.status ORDER BY g`,
    [req.user.id]
  );
  v.render(req, res, 'Lab progress', v.progressPage(rows, { saved: req.query.saved }));
});

router.post('/progress', requireUser, async (req, res) => {
  const labs = [];
  const statuses = [];
  for (let lab = 1; lab <= 10; lab++) {
    const s = String(req.body[`lab${lab}`] || 'todo');
    labs.push(lab);
    statuses.push(STATUSES.includes(s) ? s : 'todo');
  }
  await pool.query(
    `INSERT INTO lab_progress (user_id, lab, status)
     SELECT $1, t.lab, t.status FROM unnest($2::smallint[], $3::text[]) AS t(lab, status)
     ON CONFLICT (user_id, lab) DO UPDATE SET status = EXCLUDED.status, updated_at = now()`,
    [req.user.id, labs, statuses]
  );
  res.redirect('/progress?saved=1');
});

// ---------- CSV export ----------

const csvCell = (value) => {
  let s = value instanceof Date ? value.toISOString() : String(value ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // stop spreadsheet formula injection
  return `"${s.replace(/"/g, '""')}"`;
};

router.get('/export.csv', requireUser, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, lab, title, body, array_to_string(tags, ' ') AS tags, created_at, updated_at
       FROM entries WHERE user_id = $1 ORDER BY created_at, id`,
    [req.user.id]
  );
  const head = ['id', 'lab', 'title', 'notes', 'tags', 'created_at', 'updated_at'];
  const lines = [head.join(',')].concat(
    rows.map((r) => [r.id, r.lab, r.title, r.body, r.tags, r.created_at, r.updated_at].map(csvCell).join(','))
  );
  res
    .type('text/csv')
    .set('Content-Disposition', `attachment; filename="lab-notebook-${req.user.username}.csv"`)
    .send(lines.join('\r\n') + '\r\n');
});

module.exports = router;
