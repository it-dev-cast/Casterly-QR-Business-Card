# CardDesk — QR Business Cards

Digital business cards for the employees in **nexusAuth (Nexus core)**. Each employee gets a QR code; scanning it opens their card on any phone, with a **Save contact** button. **QR code** on an employee previews a shareable card image (photo, name, role, company and QR), and **Download card** saves it as a PNG.

## Where the data comes from

| Data | Source | Stored by CardDesk? |
|---|---|---|
| Employees: name, designation, department, company, email, phone, address, LinkedIn, photo, status | nexusAuth API (`/api/v1/employees`, `/api/v1/companies`, photos from `/uploads`) | **No.** Read live and kept in memory for 30 seconds |
| Who can sign in | nexusAuth accounts with the **admin** or **operator** role | **No.** CardDesk has no user accounts or passwords |
| QR card links, card branding (banner, logo, website, colour), uploaded banner/logo images, sign-in sessions | CardDesk | Yes, in its own **`carddesk` schema inside nexusAuth's database** (`nexus_auth`) |

There is **no separate CardDesk database**. Employees are added, edited and removed **in nexusAuth only**; CardDesk shows the change within about 30 seconds (or straight away with **Sync now**).

- **Exited** employees in nexusAuth lose their card: their QR code shows "Card not found".
- **Operators** only see their own company's employees, as in nexusAuth; admins see all companies.
- nexusAuth's sensitive fields (bank account, IFSC, PAN, Aadhaar, residence proof) are dropped the moment they arrive and never reach a card, the admin page or a log.
- Employee data is read through nexusAuth's API, not its tables: nexusAuth encrypts phone, address and photo in the database, and its API applies its own permissions.

## Requirements

- Node.js **22.5 or newer**
- nexusAuth running and reachable (default `http://127.0.0.1:8000`)
- nexusAuth's PostgreSQL database (`nexus_auth`)

## First-time setup

1. **Database (once, as the PostgreSQL admin).** This creates CardDesk's login role, its `carddesk` schema inside `nexus_auth`, and a throwaway test database:

   ```bash
   psql -U postgres -v app_password=choose-a-password -f scripts/setup-database.sql
   ```

2. **Settings.** Copy `.env.example` to `.env` and fill in:
   - `DATABASE_URL` / `TEST_DATABASE_URL` with the password from step 1;
   - `NEXUSAUTH_URL`, `NEXUSAUTH_EMAIL`, `NEXUSAUTH_PASSWORD`: a nexusAuth service account with the operator or admin role, which CardDesk uses to read employees.

3. **Install and start:**

   ```bash
   npm install
   ```

   ```bash
   npm start
   ```

   Open http://localhost:4300 and sign in with **your nexusAuth account** (admin or operator role).

4. **Moving from the old stand-alone CardDesk (optional).** If `data/carddesk.db` exists, this copies its QR links (matched to nexusAuth employees by email, so printed QR codes keep working), banner, QR address and logo/website. Preview first, then apply:

   ```bash
   npm run import-old
   ```

   ```bash
   npm run import-old -- --apply
   ```

   The old file is only read. Once you're happy, you can delete the `data/` folder.

The console prints `Network:` addresses that phones on the same Wi-Fi can open. In the QR popup, **Use this computer's network address** makes QR codes follow the current address. For permanent printed cards, host CardDesk at a fixed address (see [DEPLOY.md](DEPLOY.md)).

Development mode with auto-restart: `npm run dev`

## Try it without nexusAuth

```bash
node scripts/sandbox.js
```

Runs CardDesk on http://localhost:4310 with an in-memory database and a stand-in nexusAuth holding sample employees. Sign in as `admin@casterly.com` / `admin-pass`. Nothing is saved.

## Test

```bash
npm test
```

Runs the API tests against a stand-in nexusAuth and an in-memory PostgreSQL: sign-in by nexusAuth role, employees from nexusAuth (exited left out, sensitive fields never exposed, per-company access), updates from nexusAuth, public cards, photos, vCards, QR codes, uploads, branding, nexusAuth outages, rate limiting.

`npm run test:db` runs the same tests against the real PostgreSQL test database in `TEST_DATABASE_URL`.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PORT` / `HOST` | `4300` / `0.0.0.0` | Where the server listens |
| `PUBLIC_URL` | _(empty)_ | Address used in QR codes, e.g. `https://cards.yourcompany.com`. Can also be set in the QR popup |
| `NEXUSAUTH_URL` | — | nexusAuth's address |
| `NEXUSAUTH_EMAIL` / `NEXUSAUTH_PASSWORD` | — | Service account CardDesk reads employees with (operator or admin role) |
| `NEXUSAUTH_CACHE_SECONDS` | `30` | How long the employee list is reused before asking nexusAuth again |
| `ALLOWED_ROLES` | `admin,operator` | nexusAuth roles that may sign in to CardDesk |
| `DATABASE_URL` | — | `carddesk_app` login to nexusAuth's database |
| `DATABASE_SCHEMA` | `carddesk` | CardDesk's schema in that database |
| `TRUST_PROXY` | `false` | Set `true` behind an HTTPS reverse proxy (enables Secure cookies) |
| `SESSION_HOURS` | `12` | How long a sign-in lasts |

## API

All `/api` routes return JSON. Routes marked 🔒 need a signed-in session.

| Method | Route | |
|---|---|---|
| POST | `/api/auth/login` | `{ email, password }` of a nexusAuth account → sets session cookie |
| POST | `/api/auth/logout` | |
| GET | `/api/auth/me` | `{ user }` or `{ user: null }` |
| GET 🔒 | `/api/employees?q=&refresh=1` | employees from nexusAuth (`refresh=1` fetches now) |
| GET 🔒 | `/api/employees/:id` | one employee (`:id` = nexusAuth employee id) |
| GET 🔒 | `/api/employees/:id/vcard`, `/api/employees/:id/qr.svg` | downloads |
| GET 🔒 | `/api/status` | database and nexusAuth sync status |
| GET / PUT 🔒 | `/api/settings` | `{ banner, logo, website, accent, publicUrl }` |
| POST 🔒 | `/api/uploads` | raw image body (PNG/JPG/WEBP/GIF, ≤ 5 MB) → `{ url }` |
| GET | `/api/public/cards/:slug` | public card data + banner |
| GET | `/api/public/cards/:slug/vcard` | public vCard download |
| GET | `/c/:slug` | public card page (what the QR opens) |
| GET | `/media/photos/:slug`, `/media/assets/:file` | employee photo (from nexusAuth), uploaded banner/logo |

There are no routes to create, edit or delete employees: that happens in nexusAuth.

## Project layout

```
server/   index.js (startup) · app.js (routes) · nexus.js (nexusAuth client + employee cache) · db.js (carddesk schema)
          auth.js · validate.js · uploads.js · vcard.js · config.js
public/   index.html + app.js (admin) · card.html + card-page.js (public card) · card.js · card-image.js · api.js · styles.css
scripts/  setup-database.sql · import-old-carddesk.js · sandbox.js
tests/    api.test.js · fake-nexus.js (stand-in nexusAuth)
```

## Security notes

- Sign-in is checked by nexusAuth (including its account lockout); CardDesk sessions are random tokens stored hashed, in httpOnly SameSite cookies. Sign-in attempts are also rate limited (10 per 15 minutes per IP).
- CardDesk's database login can only use its own `carddesk` schema; it can't read nexusAuth's tables.
- Uploads are checked by file signature; SVG is rejected. A replaced banner or logo is deleted.
- Public cards show only card details, never internal IDs. A strict Content-Security-Policy is sent, and cross-site write requests are blocked.
