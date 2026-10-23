import crypto from "node:crypto";
import pg from "pg";

// CardDesk stores only what nexusAuth doesn't have: card links (for QR codes), card settings, images
// uploaded for the cards (banner, logo) and admin sign-in sessions. Every table lives in CardDesk's
// own schema inside nexusAuth's database; employee data is never stored here.
const MIGRATION = `
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS card_links (
    employee_id INTEGER PRIMARY KEY,
    slug        TEXT NOT NULL UNIQUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS assets (
    id           TEXT PRIMARY KEY,
    content_type TEXT NOT NULL,
    data_base64  TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL,
    email      TEXT NOT NULL,
    name       TEXT NOT NULL DEFAULT '',
    role       TEXT NOT NULL,
    company_id INTEGER,
    expires_at TIMESTAMPTZ NOT NULL
  );
`;

const SLUG_ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const SLUG_RE = /^[A-Za-z0-9]{8}$/;

function makeSlug() {
  let s = "";
  for (const b of crypto.randomBytes(8)) s += SLUG_ALPHABET[b % SLUG_ALPHABET.length];
  return s;
}

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

// `pool` is any object with pg's `query(text, params)` (a pg.Pool, or pg-mem's in tests).
export function createStore(pool) {
  const q = (text, params) => pool.query(text, params);

  return {
    async migrate() { await q(MIGRATION); },
    async close() { if (pool.end) await pool.end(); },
    async ping() { await q("SELECT 1"); },

    // ---------- settings ----------
    async getSettings() {
      const { rows } = await q("SELECT key, value FROM settings");
      return Object.fromEntries(rows.map((r) => [r.key, r.value]));
    },
    async setSettings(values) {
      for (const [key, value] of Object.entries(values)) {
        await q("INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [key, value]);
      }
    },

    // ---------- card links: one permanent, unguessable slug per nexusAuth employee ----------
    async slugsFor(employeeIds) {
      const ids = [...new Set(employeeIds.map(Number))].filter(Number.isInteger);
      const map = new Map();
      if (!ids.length) return map;
      const { rows } = await q("SELECT employee_id, slug FROM card_links WHERE employee_id = ANY($1::int[])", [ids]);
      for (const r of rows) map.set(Number(r.employee_id), r.slug);
      for (const id of ids) {
        if (map.has(id)) continue;
        for (let attempt = 0; attempt < 10; attempt++) {
          const slug = makeSlug();
          try {
            const res = await q(
              "INSERT INTO card_links (employee_id, slug) VALUES ($1, $2) ON CONFLICT (employee_id) DO NOTHING RETURNING slug", [id, slug]);
            if (res.rows.length) { map.set(id, res.rows[0].slug); break; }
            // Another request created it first: read that one.
            const again = await q("SELECT slug FROM card_links WHERE employee_id = $1", [id]);
            map.set(id, again.rows[0].slug);
            break;
          } catch (err) {
            if (err.code !== "23505") throw err; // slug collision: try another
          }
        }
      }
      return map;
    },
    async employeeIdForSlug(slug) {
      if (!SLUG_RE.test(String(slug))) return null;
      const { rows } = await q("SELECT employee_id FROM card_links WHERE slug = $1", [String(slug)]);
      return rows.length ? Number(rows[0].employee_id) : null;
    },
    // Used by the one-time import of card links made before CardDesk read from nexusAuth.
    async importLink(employeeId, slug) {
      if (!SLUG_RE.test(slug)) return false;
      const res = await q("INSERT INTO card_links (employee_id, slug) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING slug", [employeeId, slug]);
      return res.rows.length > 0;
    },

    // ---------- images uploaded for the cards (banner, logo) ----------
    async saveAsset(contentType, data) {
      const id = crypto.randomBytes(16).toString("hex");
      await q("INSERT INTO assets (id, content_type, data_base64) VALUES ($1, $2, $3)", [id, contentType, data.toString("base64")]);
      return id;
    },
    async getAsset(id) {
      const { rows } = await q("SELECT content_type, data_base64 FROM assets WHERE id = $1", [id]);
      return rows.length ? { contentType: rows[0].content_type, data: Buffer.from(rows[0].data_base64, "base64") } : null;
    },
    async deleteAsset(id) { await q("DELETE FROM assets WHERE id = $1", [id]); },

    // ---------- admin sessions (people sign in with their nexusAuth account) ----------
    async createSession(user, hours) {
      const token = crypto.randomBytes(32).toString("base64url");
      const expiresAt = new Date(Date.now() + hours * 3600 * 1000);
      await q("DELETE FROM sessions WHERE expires_at < now()");
      await q(
        "INSERT INTO sessions (token_hash, user_id, email, name, role, company_id, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
        [sha256(token), user.id, user.email, user.name || "", user.role, user.companyId ?? null, expiresAt]);
      return { token, expiresAt };
    },
    async getSession(token) {
      if (!token) return null;
      const { rows } = await q(
        "SELECT user_id, email, name, role, company_id, expires_at FROM sessions WHERE token_hash = $1", [sha256(token)]);
      const r = rows[0];
      if (!r) return null;
      if (new Date(r.expires_at).getTime() < Date.now()) {
        await q("DELETE FROM sessions WHERE token_hash = $1", [sha256(token)]);
        return null;
      }
      return { id: Number(r.user_id), email: r.email, name: r.name, role: r.role, companyId: r.company_id === null ? null : Number(r.company_id) };
    },
    async destroySession(token) {
      if (token) await q("DELETE FROM sessions WHERE token_hash = $1", [sha256(token)]);
    },
  };
}

// Production pool: every connection only sees CardDesk's own schema (search_path), never the rest of
// nexusAuth's database.
export function createPool(databaseUrl, schema) {
  return new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, max: 5 });
}
