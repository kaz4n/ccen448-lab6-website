# CCEN 448 Lab Notebook

A web application for keeping lab notes, with user accounts and a PostgreSQL
database behind it. Built for CCEN 448 Exercise 6 (Khalifa University).

## Features

- Accounts: register, sign in, change password (other devices are signed out),
  lockout for 15 minutes after 5 wrong passwords, per-user activity log.
- Roles: the first account on a fresh database is the administrator. Admins see
  all users, can promote, demote or delete them, and read the audit log.
- Entries: create, edit, delete; each has a lab number (1 to 10), notes and up
  to 8 tags. Ten entries per page.
- Search: PostgreSQL full-text search (`tsvector` + GIN index, `websearch_to_tsquery`),
  ranked by relevance with highlighted excerpts. Quoted phrases and `-word` work.
  Filter by lab or tag.
- Dashboard: totals, entries per lab and per day (SQL aggregates drawn as SVG
  charts, no JavaScript on the page), most used tags.
- Lab progress: not started / in progress / done for each of the ten labs.
- CSV export of your entries.
- `/status` shows which host runs the web server, database version and size,
  memory in use, and whether the request arrived over HTTPS.

## Stack

| Part | Technology |
| --- | --- |
| Web server | Node.js 22, Express 5 |
| Database | PostgreSQL 16 (container, not exposed outside the host) |
| Authentication | Username + password (scrypt hashes), server-side sessions in the database, `HttpOnly` cookie |
| Packaging | Docker Compose |

## Resource use

Sized for the smallest Lightsail plans. Compose caps the containers (`db` 256 MB,
`web` 160 MB), Postgres runs with `shared_buffers=48MB` and 30 connections, and
Node uses at most 96 MB of heap and a pool of 5 connections. The Node process used about 55 MB resident
in testing; check the live figure on `/status`. The only npm dependencies are `express` and `pg`.

## Install

Requires Docker with the Compose plugin.

```bash
git clone https://github.com/kaz4n/ku-lab-notebook.git
cd ku-lab-notebook
echo "DB_PASSWORD=$(openssl rand -hex 12)" > .env
docker compose up -d --build
```

The site listens on port `3000` (change it with `WEB_PORT` in `.env`).
The database schema in `schema.sql` is loaded automatically the first time the
database container starts.

Ubuntu note: install Docker with `sudo apt-get install -y docker.io docker-compose-v2`
and run the commands above with `sudo`, or add your user to the `docker` group.
On a 512 MB instance, add swap before building:

```bash
sudo fallocate -l 1G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
```

## Use

Open `http://<host>:3000`, register an account, and add entries.
`/status` shows which host runs the web server, which database version is
behind it, and whether the request arrived over HTTPS.
`/health` returns `ok` when the database answers.

## Look at the database

```bash
docker compose exec db psql -U notebook -d notebook
```

```sql
\dt
SELECT id, username, created_at FROM users;
SELECT id, user_id, lab, title, tags FROM entries;
SELECT event, username, ip, created_at FROM audit_log ORDER BY id DESC LIMIT 10;
```

## HTTPS behind a proxy or tunnel

The app trusts `X-Forwarded-*` headers (`trust proxy`), so behind Cloudflare
Quick Tunnel the session cookie is marked `Secure` automatically. There is no
hard-coded base URL or allowed-origin list; links are relative. Cross-site
form posts are refused using the `Sec-Fetch-Site` header and `SameSite=Lax`
cookies.

## Maintenance

```bash
docker compose logs -f web     # application log
docker compose restart web     # restart the web server only
docker compose down            # stop (data kept in the dbdata volume)
docker compose down -v         # stop and delete all data
```

## Layout

```
server.js          app setup, /status, /health
auth.js            sign in, register, sessions, lockout, account page
entries.js         entries CRUD, search, tags, pagination
insights.js        dashboard, lab progress, CSV export
admin.js           user management, audit log
db.js              connection pool, audit helper
views.js           HTML templates and SVG charts
public/style.css   styles
schema.sql         tables: users, sessions, entries, lab_progress, audit_log
Dockerfile         web image
docker-compose.yml web + db services
```
