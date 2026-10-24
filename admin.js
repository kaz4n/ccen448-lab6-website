const express = require('express');
const { pool, audit } = require('./db');
const { requireAdmin } = require('./auth');
const v = require('./views');

const router = express.Router();
router.param('id', (req, res, next, id) => (/^\d{1,9}$/.test(id) ? next() : next('route')));

router.get('/admin', requireAdmin, async (req, res) => {
  const [users, events, sizes] = await Promise.all([
    pool.query(
      `SELECT u.id, u.username, u.role, u.created_at, u.last_login, u.locked_until,
              count(e.id)::int AS entries
         FROM users u LEFT JOIN entries e ON e.user_id = u.id
        GROUP BY u.id ORDER BY u.id`),
    pool.query(`SELECT username, event, ip, created_at FROM audit_log ORDER BY created_at DESC, id DESC LIMIT 25`),
    pool.query(
      `SELECT pg_size_pretty(pg_database_size(current_database())) AS db_size,
              (SELECT count(*)::int FROM entries) AS entries,
              (SELECT count(*)::int FROM sessions WHERE expires_at > now()) AS sessions,
              (SELECT count(*)::int FROM audit_log) AS audit`),
  ]);
  v.render(req, res, 'Admin', v.adminPage({ users: users.rows, events: events.rows, stats: sizes.rows[0] }, req.user, req.query.msg));
});

router.post('/admin/users/:id/role', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.redirect('/admin?msg=You+cannot+change+your+own+role.');
  const role = req.body.role === 'admin' ? 'admin' : 'user';
  const { rows } = await pool.query('UPDATE users SET role = $1 WHERE id = $2 RETURNING username', [role, id]);
  if (rows[0]) await audit(req, `role_${role}:${rows[0].username}`, req.user.id, req.user.username);
  res.redirect('/admin');
});

router.post('/admin/users/:id/delete', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.redirect('/admin?msg=You+cannot+delete+your+own+account.');
  const { rows } = await pool.query('DELETE FROM users WHERE id = $1 RETURNING username', [id]);
  if (rows[0]) await audit(req, `user_deleted:${rows[0].username}`, req.user.id, req.user.username);
  res.redirect('/admin');
});

module.exports = router;
