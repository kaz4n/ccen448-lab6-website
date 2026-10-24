const crypto = require('crypto');
const { promisify } = require('util');
const express = require('express');
const { pool, audit } = require('./db');
const v = require('./views');

const scrypt = promisify(crypto.scrypt);
const SESSION_DAYS = 7;
const MAX_FAILS = 5;
const LOCK_MINUTES = 15;

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `${salt.toString('hex')}:${key.toString('hex')}`;
}

async function checkPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const key = await scrypt(password, Buffer.from(salt, 'hex'), 64);
  return crypto.timingSafeEqual(key, Buffer.from(hash, 'hex'));
}

function readCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return null;
}

function setSessionCookie(req, res, token, maxAgeSeconds) {
  const flags = ['Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSeconds}`];
  if (req.secure) flags.push('Secure');
  res.append('Set-Cookie', `sid=${token}; ${flags.join('; ')}`);
}

async function startSession(req, res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  await pool.query('DELETE FROM sessions WHERE expires_at < now()');
  await pool.query(
    `INSERT INTO sessions (token_hash, user_id, expires_at)
     VALUES ($1, $2, now() + make_interval(days => $3))`,
    [sha256(token), userId, SESSION_DAYS]
  );
  setSessionCookie(req, res, token, SESSION_DAYS * 86400);
}

// ---------- middleware ----------

// Reject cross-site form posts. Browsers send Sec-Fetch-Site on every request.
function blockCrossSite(req, res, next) {
  if (req.method === 'POST') {
    const site = req.get('sec-fetch-site');
    if (site && site !== 'same-origin' && site !== 'none') {
      return v.render(req, res, 'Blocked', v.errorPage(403, 'Cross-site request blocked.'), 403);
    }
  }
  next();
}

async function loadSession(req, res, next) {
  req.user = null;
  const token = readCookie(req, 'sid');
  if (token) {
    const { rows } = await pool.query(
      `SELECT u.id, u.username, u.role FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = $1 AND s.expires_at > now()`,
      [sha256(token)]
    );
    req.user = rows[0] || null;
    req.sessionHash = req.user ? sha256(token) : null;
  }
  next();
}

const requireUser = (req, res, next) => (req.user ? next() : res.redirect('/login'));

function requireAdmin(req, res, next) {
  if (!req.user) return res.redirect('/login');
  if (req.user.role !== 'admin') return v.render(req, res, 'Forbidden', v.errorPage(403, 'Administrators only.'), 403);
  next();
}

// ---------- routes ----------

const router = express.Router();

router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/');
  v.render(req, res, 'Sign in', v.authPage('login'));
});

router.post('/login', async (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const bad = (msg, status = 401) => v.render(req, res, 'Sign in', v.authPage('login', msg, username), status);

  const { rows } = await pool.query(
    'SELECT id, password_hash, locked_until FROM users WHERE username = $1',
    [username]
  );
  const user = rows[0];

  if (user && user.locked_until && user.locked_until > new Date()) {
    const mins = Math.ceil((user.locked_until - new Date()) / 60000);
    await audit(req, 'login_blocked', user.id, username);
    return bad(`Too many failed attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`, 429);
  }

  if (!user || !(await checkPassword(password, user.password_hash))) {
    if (user) {
      const { rows: r } = await pool.query(
        `UPDATE users
            SET failed_logins = CASE WHEN failed_logins + 1 >= $2 THEN 0 ELSE failed_logins + 1 END,
                locked_until  = CASE WHEN failed_logins + 1 >= $2 THEN now() + make_interval(mins => $3) ELSE locked_until END
          WHERE id = $1 RETURNING locked_until`,
        [user.id, MAX_FAILS, LOCK_MINUTES]
      );
      await audit(req, r[0].locked_until > new Date() ? 'account_locked' : 'login_failed', user.id, username);
    }
    return bad('Wrong username or password.');
  }

  await pool.query('UPDATE users SET failed_logins = 0, locked_until = NULL, last_login = now() WHERE id = $1', [user.id]);
  await startSession(req, res, user.id);
  await audit(req, 'login', user.id, username);
  res.redirect('/');
});

router.get('/register', (req, res) => {
  if (req.user) return res.redirect('/');
  v.render(req, res, 'Register', v.authPage('register'));
});

router.post('/register', async (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const fail = (msg) => v.render(req, res, 'Register', v.authPage('register', msg, username), 400);

  if (!/^[a-z0-9_]{3,32}$/.test(username)) return fail('Username must be 3 to 32 characters: a-z, 0-9, underscore.');
  if (password.length < 8) return fail('Password needs at least 8 characters.');

  try {
    // The first account on a fresh database becomes the administrator.
    const { rows } = await pool.query(
      `INSERT INTO users (username, password_hash, role)
       VALUES ($1, $2, CASE WHEN EXISTS (SELECT 1 FROM users) THEN 'user' ELSE 'admin' END)
       RETURNING id`,
      [username, await hashPassword(password)]
    );
    await startSession(req, res, rows[0].id);
    await audit(req, 'register', rows[0].id, username);
    res.redirect('/');
  } catch (err) {
    if (err.code === '23505') return fail('That username is taken.');
    throw err;
  }
});

router.post('/logout', async (req, res) => {
  const token = readCookie(req, 'sid');
  if (token) await pool.query('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)]);
  if (req.user) await audit(req, 'logout', req.user.id, req.user.username);
  setSessionCookie(req, res, '', 0);
  res.redirect('/login');
});

// ---------- account ----------

async function accountData(req) {
  const { rows: events } = await pool.query(
    `SELECT event, ip, created_at FROM audit_log WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT 15`,
    [req.user.id]
  );
  const { rows } = await pool.query(
    `SELECT u.created_at, u.last_login,
            (SELECT count(*) FROM sessions s WHERE s.user_id = u.id AND s.expires_at > now()) AS sessions
       FROM users u WHERE u.id = $1`,
    [req.user.id]
  );
  return { events, ...rows[0] };
}

router.get('/account', requireUser, async (req, res) => {
  v.render(req, res, 'Account', v.accountPage(await accountData(req), req.user, { done: req.query.done }));
});

router.post('/account/password', requireUser, async (req, res) => {
  const current = String(req.body.current || '');
  const next = String(req.body.next || '');
  const fail = async (msg) =>
    v.render(req, res, 'Account', v.accountPage(await accountData(req), req.user, { error: msg }), 400);

  const { rows } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  if (!(await checkPassword(current, rows[0].password_hash))) return fail('Current password is wrong.');
  if (next.length < 8) return fail('New password needs at least 8 characters.');

  await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [await hashPassword(next), req.user.id]);
  // Sign out every other device.
  await pool.query('DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2', [req.user.id, req.sessionHash]);
  await audit(req, 'password_changed', req.user.id, req.user.username);
  res.redirect('/account?done=1');
});

module.exports = { router, blockCrossSite, loadSession, requireUser, requireAdmin };
