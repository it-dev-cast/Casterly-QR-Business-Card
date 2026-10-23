# Put CardDesk online (anyone can scan a QR)

Once CardDesk runs on a public HTTPS address, QR codes work for everyone, on any network.

CardDesk has no data of its own to move. It needs to reach two things that belong to nexusAuth:

- **nexusAuth's API**, to read employees and check sign-ins;
- **nexusAuth's PostgreSQL database**, where CardDesk keeps its `carddesk` schema (card links, branding, sessions).

So the simplest setup is to run CardDesk **on the same server as nexusAuth**, behind the same HTTPS reverse proxy.

## 1. Prepare the database (once)

On the database server, as the PostgreSQL admin:

```bash
psql -U postgres -v app_password=choose-a-strong-password -f scripts/setup-database.sql
```

This creates the `carddesk_app` login, the `carddesk` schema inside `nexus_auth`, and the `carddesk_test` database (used only by tests). It doesn't touch nexusAuth's own tables.

## 2. Create a nexusAuth service account

In nexusAuth, create an account for CardDesk with the **operator** role (sees its company's employees) or **admin** role (sees every company). CardDesk uses it only to read employees and companies.

## 3. Run CardDesk with Docker

```bash
docker build -t carddesk .
```

```bash
docker run -d --name carddesk -p 4300:4300 --env-file .env -e TRUST_PROXY=true --restart unless-stopped carddesk
```

`.env` needs `NEXUSAUTH_URL`, `NEXUSAUTH_EMAIL`, `NEXUSAUTH_PASSWORD` and `DATABASE_URL` (see `.env.example`). Inside Docker, `localhost` means the container itself: use the server's address or Docker network name for nexusAuth and PostgreSQL.

Point your reverse proxy (nginx, Caddy) at port 4300 with HTTPS, and set the health check to `/api/health`.

## 4. Set the public address

Set `PUBLIC_URL` to the address people will scan, e.g. `https://cards.casterly.com`, then restart. Do this **before** printing QR codes. A domain you own never has to change, even if you move servers later.

## 5. Move QR links from the old stand-alone CardDesk (optional)

If QR codes were already printed from the old version (which had its own SQLite file in `data/`), copy that `data/` folder next to the app and run:

```bash
npm run import-old -- --apply
```

Employees are matched to nexusAuth by email, so their existing QR codes keep working.

## Render or another cloud host

`render.yaml` and the Dockerfile work on Render too, but only if nexusAuth's API and database are reachable from the internet (ideally through a private network). If nexusAuth only runs inside the office network, host CardDesk next to it instead.

## Backups

CardDesk's data is the `carddesk` schema in `nexus_auth`, so your normal nexusAuth database backups already include it. Employee data is in nexusAuth itself.
