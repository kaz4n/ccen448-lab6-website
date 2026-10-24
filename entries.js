const express = require('express');
const { pool } = require('./db');
const { requireUser } = require('./auth');
const v = require('./views');

const PAGE_SIZE = 10;
const router = express.Router();

// Non-numeric ids fall through to the 404 page instead of hitting the database.
router.param('id', (req, res, next, id) => (/^\d{1,9}$/.test(id) ? next() : next('route')));

function parseTags(raw) {
  const tags = String(raw || '')
    .split(',')
    .map((t) => t.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '').slice(0, 24))
    .filter(Boolean);
  return [...new Set(tags)].slice(0, 8);
}

function parseEntry(body) {
  const lab = Number.parseInt(body.lab, 10);
  return {
    title: String(body.title || '').trim().slice(0, 120),
    body: String(body.body || '').slice(0, 5000),
    lab: lab >= 1 && lab <= 10 ? lab : null,
    tags: parseTags(body.tags),
  };
}

router.get('/', requireUser, async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 100);
  const tag = String(req.query.tag || '').trim().toLowerCase().slice(0, 24);
  const lab = Number.parseInt(req.query.lab, 10) || null;
  const requested = Math.max(1, Number.parseInt(req.query.page, 10) || 1);

  const args = [req.user.id];
  const where = ['e.user_id = $1'];
  const add = (sql, value) => {
    args.push(value);
    where.push(sql.replace('?', `$${args.length}`));
  };
  if (q) add(`e.search @@ websearch_to_tsquery('english', ?)`, q);
  if (tag) add('? = ANY(e.tags)', tag);
  if (lab) add('e.lab = ?', lab);
  const whereSql = where.join(' AND ');

  const { rows: c } = await pool.query(`SELECT count(*)::int AS n FROM entries e WHERE ${whereSql}`, args);
  const total = c[0].n;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(requested, pages);

  // With a search term: rank by relevance and show a highlighted excerpt.
  // ts_headline marks hits with private markers; views.highlight escapes the text first.
  const qIdx = q ? args.indexOf(q) + 1 : 0;
  const select = q
    ? `ts_headline('english', e.body, websearch_to_tsquery('english', $${qIdx}),
                   'StartSel=@@HL@@, StopSel=@@/HL@@, MaxWords=35, MinWords=12') AS excerpt,
       ts_rank(e.search, websearch_to_tsquery('english', $${qIdx})) AS rank`
    : `left(e.body, 300) AS excerpt, 0 AS rank`;

  const { rows: entries } = await pool.query(
    `SELECT e.id, e.lab, e.title, e.tags, e.created_at, ${select}
       FROM entries e WHERE ${whereSql}
      ORDER BY rank DESC, e.created_at DESC, e.id DESC
      LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`,
    args
  );

  const { rows: tags } = await pool.query(
    `SELECT t AS tag, count(*)::int AS n FROM entries e, unnest(e.tags) AS t
      WHERE e.user_id = $1 GROUP BY t ORDER BY n DESC, t LIMIT 20`,
    [req.user.id]
  );

  v.render(req, res, 'Entries', v.entriesPage({ entries, tags, q, tag, lab, page, pages, total, highlighted: Boolean(q) }));
});

router.post('/entries', requireUser, async (req, res) => {
  const e = parseEntry(req.body);
  if (!e.title) return res.redirect('/');
  await pool.query(
    'INSERT INTO entries (user_id, lab, title, body, tags) VALUES ($1, $2, $3, $4, $5)',
    [req.user.id, e.lab, e.title, e.body, e.tags]
  );
  res.redirect('/');
});

router.get('/entries/:id/edit', requireUser, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, lab, title, body, tags FROM entries WHERE id = $1 AND user_id = $2',
    [req.params.id, req.user.id]
  );
  if (!rows[0]) return v.render(req, res, 'Not found', v.errorPage(404, 'No such entry.'), 404);
  v.render(req, res, 'Edit entry', v.editPage(rows[0]));
});

router.post('/entries/:id', requireUser, async (req, res) => {
  const e = parseEntry(req.body);
  if (!e.title) return res.redirect(`/entries/${req.params.id}/edit`);
  await pool.query(
    `UPDATE entries SET lab = $1, title = $2, body = $3, tags = $4, updated_at = now()
      WHERE id = $5 AND user_id = $6`,
    [e.lab, e.title, e.body, e.tags, req.params.id, req.user.id]
  );
  res.redirect('/');
});

router.post('/entries/:id/delete', requireUser, async (req, res) => {
  await pool.query('DELETE FROM entries WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
  res.redirect('/');
});

module.exports = router;
