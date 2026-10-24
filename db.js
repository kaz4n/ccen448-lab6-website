const { Pool } = require('pg');

// Small pool: the instance is small and Postgres is capped at 30 connections.
const pool = new Pool({ max: 5, idleTimeoutMillis: 30000 }); // PG* environment variables

async function audit(req, event, userId, username) {
  await pool.query(
    'INSERT INTO audit_log (user_id, username, event, ip) VALUES ($1, $2, $3, $4)',
    [userId ?? null, username ?? null, event, req.ip]
  );
}

module.exports = { pool, audit };
