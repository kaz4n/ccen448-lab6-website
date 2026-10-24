const os = require('os');
const express = require('express');
const { pool } = require('./db');
const auth = require('./auth');
const v = require('./views');

const app = express();

// Behind the Cloudflare tunnel the request arrives as plain HTTP on localhost;
// trusting X-Forwarded-* lets req.secure / req.protocol reflect the browser's HTTPS.
app.set('trust proxy', true);
app.disable('x-powered-by');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: false }));
app.use(auth.blockCrossSite);
app.use(auth.loadSession);

app.use(auth.router);
app.use(require('./entries'));
app.use(require('./insights'));
app.use(require('./admin'));

// ---------- status ----------

app.get('/status', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT version() AS db_version,
            inet_server_addr()::text AS db_addr,
            pg_size_pretty(pg_database_size(current_database())) AS db_size,
            (SELECT count(*)::int FROM pg_stat_activity WHERE datname = current_database()) AS connections,
            (SELECT count(*)::int FROM users) AS users,
            (SELECT count(*)::int FROM entries) AS entries`
  );
  const r = rows[0];
  v.render(req, res, 'Status', v.statusPage({
    dbVersion: r.db_version.split(' on ')[0],
    dbHost: r.db_addr ? `${process.env.PGHOST || 'localhost'} (${r.db_addr})` : process.env.PGHOST || 'localhost',
    dbSize: r.db_size,
    connections: r.connections,
    users: r.users,
    entries: r.entries,
    rssMb: Math.round(process.memoryUsage().rss / 1048576),
    systemMemMb: Math.round(os.totalmem() / 1048576),
  }, req));
});

app.get('/health', async (req, res) => {
  await pool.query('SELECT 1');
  res.type('text').send('ok\n');
});

// ---------- errors ----------

app.use((req, res) => v.render(req, res, 'Not found', v.errorPage(404, 'Page not found.'), 404));

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  v.render(req, res, 'Error', v.errorPage(500, 'Something went wrong on the server.'), 500);
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, '0.0.0.0', () => console.log(`Lab Notebook listening on ${port}`));
