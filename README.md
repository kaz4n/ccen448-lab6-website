# CCEN 448 Lab Notebook

A small web application for keeping lab notes. Users register, sign in, and
write, search, edit and delete their own entries. Accounts, sessions and
entries are stored in PostgreSQL.

Built for CCEN 448 Exercise 6 (Khalifa University).

## Stack

| Part | Technology |
| --- | --- |
| Web server | Node.js 22, Express 5 |
| Database | PostgreSQL 16 (container, not exposed outside the host) |
| Authentication | Username + password (scrypt hashes), server-side sessions in the database, `HttpOnly` cookie |
| Packaging | Docker Compose |

## Install

Requires Docker with the Compose plugin.

```bash
git clone https://github.com/<your-user>/ku-lab-notebook.git
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
SELECT id, user_id, lab, title FROM entries;
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
server.js          routes, sessions, database queries
views.js           HTML templates
public/style.css   styles
schema.sql         tables: users, sessions, entries
Dockerfile         web image
docker-compose.yml web + db services
```
