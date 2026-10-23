// nexusAuth (Nexus core) is the only source of employee data. CardDesk reads it through nexusAuth's
// REST API, keeps it in memory for a short time, and never writes it to a database.
//
// Only the fields a business card needs are kept. nexusAuth's sensitive data (bank account, IFSC,
// PAN, Aadhaar, residence proof) is dropped the moment a response arrives and never leaves this file.

import { HttpError } from "./validate.js";

const PAGE_SIZE = 100;
const PHOTO_PATH_RE = /^\/uploads\/[A-Za-z0-9_\-/]+\.(png|jpe?g|webp|gif)$/i;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
// Employees in these states get a live card; "exited" employees' cards stop working.
const CARD_STATUSES = new Set(["onboarded", "active", "on_leave"]);

export class NexusError extends Error {}

async function readJson(res) {
  try { return await res.json(); } catch { return null; }
}

export function createNexusClient({ baseUrl, email, password, fetchImpl = fetch, timeoutMs = 15000 }) {
  let access = null;
  let refresh = null;
  let expiresAt = 0;

  async function call(path, { method = "GET", body, token, query } = {}) {
    const url = new URL(baseUrl + path);
    for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    const headers = { Accept: "application/json" };
    if (body) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = `Bearer ${token}`;
    let res;
    try {
      res = await fetchImpl(url, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      throw new NexusError(`nexusAuth can't be reached at ${baseUrl} (${err.cause?.code || err.name})`);
    }
    return { res, data: await readJson(res) };
  }

  function store(tokens) {
    access = tokens.access_token;
    refresh = tokens.refresh_token || null;
    expiresAt = Date.now() + Math.max(Number(tokens.expires_in || 60) - 30, 10) * 1000;
  }

  async function serviceLogin() {
    const { res, data } = await call("/api/v1/auth/login", { method: "POST", body: { email, password } });
    if (!res.ok || !data?.data?.access_token) {
      throw new NexusError(`nexusAuth rejected CardDesk's service account (${res.status}). Check NEXUSAUTH_EMAIL / NEXUSAUTH_PASSWORD.`);
    }
    store(data.data);
  }

  async function serviceToken() {
    if (access && Date.now() < expiresAt) return access;
    if (refresh) {
      const { res, data } = await call("/api/v1/auth/refresh", { method: "POST", body: { refresh_token: refresh } });
      if (res.ok && data?.data?.access_token) { store(data.data); return access; }
    }
    await serviceLogin();
    return access;
  }

  async function getAuthed(path, query) {
    let { res, data } = await call(path, { token: await serviceToken(), query });
    if (res.status === 401) { // token revoked early: sign in once more
      access = null;
      ({ res, data } = await call(path, { token: await serviceToken(), query }));
    }
    if (!res.ok) throw new NexusError(`nexusAuth returned ${res.status} for ${path}${data?.message ? `: ${data.message}` : ""}`);
    return data?.data;
  }

  async function listAll(path, query) {
    const items = [];
    for (let offset = 0; offset < 100000; offset += PAGE_SIZE) {
      const page = await getAuthed(path, { ...query, limit: PAGE_SIZE, offset });
      items.push(...(page?.items || []));
      if (!page?.has_more || !page?.items?.length) break;
    }
    return items;
  }

  return {
    // Signs a person in with their own nexusAuth account; returns who they are.
    async verifyUser(userEmail, userPassword) {
      const { res, data } = await call("/api/v1/auth/login", { method: "POST", body: { email: userEmail, password: userPassword } });
      if (res.status === 401 || res.status === 400 || res.status === 422) throw new HttpError(401, "Invalid email or password");
      if (res.status === 403) throw new HttpError(403, data?.message || "This nexusAuth account is locked. Try again later.");
      if (res.status === 429) throw new HttpError(429, "Too many sign-in attempts. Try again in a few minutes.");
      if (!res.ok || !data?.data?.access_token) throw new NexusError(`nexusAuth sign-in failed (${res.status})`);
      const token = data.data.access_token;
      const me = await call("/api/v1/auth/me", { token });
      // Sign that nexusAuth session out again: CardDesk keeps its own session, not the person's tokens.
      call("/api/v1/auth/logout", { method: "POST", token, body: { refresh_token: data.data.refresh_token } }).catch(() => {});
      const u = me.data?.data;
      if (!me.res.ok || !u) throw new NexusError(`nexusAuth didn't return the signed-in account (${me.res.status})`);
      return { id: u.id, email: u.email, name: u.full_name || "", role: String(u.role || "").toLowerCase(), companyId: u.company_id ?? null };
    },
    employees: () => listAll("/api/v1/employees", { include_exited: "true", sort_by: "id", sort_dir: "asc" }),
    companies: () => listAll("/api/v1/companies", { include_inactive: "true" }),
    // nexusAuth serves photos from its /uploads folder; only such paths are fetched.
    async photo(path) {
      if (!PHOTO_PATH_RE.test(path) || path.includes("..")) return null;
      let res;
      try {
        res = await fetchImpl(new URL(baseUrl + path), { signal: AbortSignal.timeout(timeoutMs) });
      } catch {
        return null;
      }
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      return buf.length && buf.length <= MAX_PHOTO_BYTES ? buf : null;
    },
  };
}

const clean = (v) => (typeof v === "string" ? v.trim() : "");

// The card fields CardDesk uses; everything else in nexusAuth's response is discarded here.
export function toCardEmployee(raw, companyNames) {
  const first = clean(raw.first_name), last = clean(raw.last_name);
  return {
    nexusId: Number(raw.id),
    companyId: raw.company_id ?? null,
    employeeCode: clean(raw.employee_code),
    name: clean(raw.full_name) || [first, last].filter(Boolean).join(" "),
    designation: clean(raw.designation),
    department: clean(raw.department),
    company: companyNames.get(raw.company_id) || "",
    email: clean(raw.email).toLowerCase(),
    phone: clean(raw.phone_number),
    address: clean(raw.address).split(/\r?\n/).map((l) => l.trim()).filter(Boolean).join(", "),
    linkedin: clean(raw.linkedin_url),
    photoPath: PHOTO_PATH_RE.test(clean(raw.photo_reference)) ? clean(raw.photo_reference) : "",
    status: clean(raw.status) || "active",
  };
}

// Caches nexusAuth's employee list for `ttlSeconds`, so a page load doesn't call nexusAuth every time.
// If nexusAuth is briefly unreachable, the last good list keeps cards working (and the error is reported).
export function createDirectory(client, { ttlSeconds = 30, now = () => Date.now() } = {}) {
  let cache = null; // { at, employees: Map<nexusId, employee> }
  let pending = null;
  let lastError = null;
  const photos = new Map(); // photoPath -> Buffer (small LRU)
  const missing = new Map(); // photoPath -> time it was found missing (retried after 10 minutes)
  const MISSING_RETRY_MS = 10 * 60 * 1000;
  const found = new Set(); // photoPaths nexusAuth has served (kept even after the bytes leave the LRU)

  async function fetchPhoto(path) {
    if (photos.has(path)) return photos.get(path);
    if (missing.has(path) && now() - missing.get(path) < MISSING_RETRY_MS) return null;
    const buf = await client.photo(path);
    if (buf) {
      missing.delete(path);
      found.add(path);
      photos.set(path, buf);
      if (photos.size > 200) photos.delete(photos.keys().next().value);
    } else {
      missing.set(path, now());
    }
    return buf;
  }

  // Each sync checks photos it hasn't seen yet (6 at a time), so a photo that's missing in nexusAuth is
  // left off the card instead of showing as a broken image. Known photos aren't fetched again.
  async function checkPhotos(employees) {
    const paths = [...new Set([...employees.values()].map((e) => e.photoPath).filter((p) => p && !found.has(p) && !missing.has(p)))];
    for (let i = 0; i < paths.length; i += 6) {
      await Promise.all(paths.slice(i, i + 6).map((p) => fetchPhoto(p).catch(() => null)));
    }
  }

  async function load() {
    const [rows, companies] = await Promise.all([client.employees(), client.companies().catch(() => [])]);
    const names = new Map(companies.filter((c) => c && c.id !== undefined).map((c) => [c.id, clean(c.name)]));
    const employees = new Map();
    for (const raw of rows) {
      if (!raw || raw.id === undefined) continue;
      const e = toCardEmployee(raw, names);
      if (e.name) employees.set(e.nexusId, e);
    }
    await checkPhotos(employees);
    cache = { at: now(), employees };
    lastError = null;
    return cache;
  }

  async function current({ force = false } = {}) {
    if (!force && cache && now() - cache.at < ttlSeconds * 1000) return cache;
    if (!pending) pending = load().finally(() => { pending = null; });
    try {
      return await pending;
    } catch (err) {
      lastError = { message: err.message, at: new Date(now()).toISOString() };
      if (cache && !force) return cache; // serve the last good list
      throw new HttpError(503, `Employee data from nexusAuth is unavailable: ${err.message}`);
    }
  }

  return {
    // Employees with a live card (exited employees left out).
    async list(opts) {
      const { employees } = await current(opts);
      return [...employees.values()].filter((e) => CARD_STATUSES.has(e.status));
    },
    async get(nexusId) {
      const { employees } = await current();
      const e = employees.get(Number(nexusId));
      return e && CARD_STATUSES.has(e.status) ? e : null;
    },
    status() {
      return { lastSyncedAt: cache ? new Date(cache.at).toISOString() : null, lastError };
    },
    async photo(path) {
      return path ? fetchPhoto(path) : null;
    },
    // True once a photo has been tried and nexusAuth didn't have it.
    photoMissing(path) {
      return !!path && missing.has(path) && now() - missing.get(path) < MISSING_RETRY_MS;
    },
  };
}
