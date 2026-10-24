const crypto = require('crypto');
const { promisify } = require('util');
const express = require('express');
const { Pool } = require('pg');
const v = require('./views');

const scrypt = promisify(crypto.scrypt);
const SESSION_DAYS = 7;

const app = express();
const pool = new Pool(); // connection settings come from the PG* environment variables

// Behind the Cloudflare tunnel the request arrives as plain HTTP on localhost;
// trusting X-Forwarded-* lets req.secure / req.protocol reflect the browser's HTTPS.
app.set('trust proxy', true);
app.disable('x-powered-by');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: false }));

// ---------- helpers ----------

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
  await pool.query(
    `INSERT INTO sessions (token_hash, user_id, expires_at)
     VALUES ($1, $2, now() + make_interval(days => $3))`,
    [sha256(token), userId, SESSION_DAYS]
  );
  setSessionCookie(req, res, token, SESSION_DAYS * 86400);
}

const page = (res, req, title, body, status = 200) =>
  res.status(status).send(v.layout(title, req.user, body));

// ---------- middleware ----------

// Reject cross-site form posts. Browsers send Sec-Fetch-Site on every request.
app.use((req, res, next) => {
  if (req.method === 'POST') {
    const site = req.get('sec-fetch-site');
    if (site && site !== 'same-origin' && site !== 'none') {
      return page(res, req, 'Blocked', v.errorPage(403, 'Cross-site request blocked.'), 403);
    }
  }
  next();
});

app.use(async (req, res, next) => {
  req.user = null;
  const token = readCookie(req, 'sid');
  if (token) {
    const { rows } = await pool.query(
      `SELECT u.id, u.username FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = $1 AND s.expires_at > now()`,
      [sha256(token)]
    );
    req.user = rows[0] || null;
  }
  next();
});

const requireUser = (req, res, next) => (req.user ? next() : res.redirect('/login'));

// ---------- auth ----------

app.get('/login', (req, res) => {
  if (req.user) return res.redirect('/');
  page(res, req, 'Sign in', v.authPage('login'));
});

app.post('/login', async (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const { rows } = await pool.query('SELECT id, password_hash FROM users WHERE username = $1', [username]);
  if (!rows[0] || !(await checkPassword(password, rows[0].password_hash))) {
    return page(res, req, 'Sign in', v.authPage('login', 'Wrong username or password.', username), 401);
  }
  await startSession(req, res, rows[0].id);
  res.redirect('/');
});

app.get('/register', (req, res) => {
  if (req.user) return res.redirect('/');
  page(res, req, 'Register', v.authPage('register'));
});

app.post('/register', async (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const fail = (msg) => page(res, req, 'Register', v.authPage('register', msg, username), 400);

  if (!/^[a-z0-9_]{3,32}$/.test(username)) return fail('Username must be 3 to 32 characters: a-z, 0-9, underscore.');
  if (password.length < 8) return fail('Password needs at least 8 characters.');

  try {
    const { rows } = await pool.query(
      'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id',
      [username, await hashPassword(password)]
    );
    await startSession(req, res, rows[0].id);
    res.redirect('/');
  } catch (err) {
    if (err.code === '23505') return fail('That username is taken.');
    throw err;
  }
});

app.post('/logout', async (req, res) => {
  const token = readCookie(req, 'sid');
  if (token) await pool.query('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)]);
  setSessionCookie(req, res, '', 0);
  res.redirect('/login');
});

// ---------- entries ----------

function parseEntry(body) {
  const title = String(body.title || '').trim().slice(0, 120);
  const text = String(body.body || '').slice(0, 5000);
  const lab = Number.parseInt(body.lab, 10);
  return { title, body: text, lab: lab >= 1 && lab <= 10 ? lab : null };
}

app.get('/', requireUser, async (req, res) => {
  const q = String(req.query.q || '').trim();
  const { rows } = await pool.query(
    `SELECT id, lab, title, body, created_at FROM entries
      WHERE user_id = $1 AND ($2 = '' OR title ILIKE '%' || $2 || '%' OR body ILIKE '%' || $2 || '%')
      ORDER BY created_at DESC`,
    [req.user.id, q]
  );
  page(res, req, 'Entries', v.homePage(rows, q));
});

app.post('/entries', requireUser, async (req, res) => {
  const e = parseEntry(req.body);
  if (!e.title) return res.redirect('/');
  await pool.query('INSERT INTO entries (user_id, lab, title, body) VALUES ($1, $2, $3, $4)', [
    req.user.id, e.lab, e.title, e.body,
  ]);
  res.redirect('/');
});

app.get('/entries/:id/edit', requireUser, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, lab, title, body FROM entries WHERE id = $1 AND user_id = $2',
    [req.params.id, req.user.id]
  );
  if (!rows[0]) return page(res, req, 'Not found', v.errorPage(404, 'No such entry.'), 404);
  page(res, req, 'Edit entry', v.editPage(rows[0]));
});

app.post('/entries/:id', requireUser, async (req, res) => {
  const e = parseEntry(req.body);
  if (!e.title) return res.redirect(`/entries/${req.params.id}/edit`);
  await pool.query(
    `UPDATE entries SET lab = $1, title = $2, body = $3, updated_at = now()
      WHERE id = $4 AND user_id = $5`,
    [e.lab, e.title, e.body, req.params.id, req.user.id]
  );
  res.redirect('/');
});

app.post('/entries/:id/delete', requireUser, async (req, res) => {
  await pool.query('DELETE FROM entries WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
  res.redirect('/');
});

// ---------- status ----------

app.get('/status', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT version() AS db_version,
            inet_server_addr()::text AS db_host,
            (SELECT count(*) FROM users) AS users,
            (SELECT count(*) FROM entries) AS entries`
  );
  const r = rows[0];
  page(res, req, 'Status', v.statusPage({
    dbVersion: r.db_version.split(' on ')[0],
    dbHost: r.db_host ? `${process.env.PGHOST || 'localhost'} (${r.db_host})` : process.env.PGHOST || 'localhost',
    users: r.users,
    entries: r.entries,
  }, req));
});

app.get('/health', async (req, res) => {
  await pool.query('SELECT 1');
  res.type('text').send('ok\n');
});

// ---------- errors ----------

app.use((req, res) => page(res, req, 'Not found', v.errorPage(404, 'Page not found.'), 404));

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  page(res, req, 'Error', v.errorPage(500, 'Something went wrong on the server.'), 500);
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, '0.0.0.0', () => console.log(`Lab Notebook listening on ${port}`));
