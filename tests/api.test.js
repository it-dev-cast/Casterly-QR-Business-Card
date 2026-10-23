import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { newDb } from "pg-mem";
import { loadConfig } from "../server/config.js";
import { createStore } from "../server/db.js";
import { createNexusClient, createDirectory } from "../server/nexus.js";
import { createApp } from "../server/app.js";
import { startFakeNexus, PNG_1PX } from "./fake-nexus.js";

// By default the tests use an in-memory PostgreSQL. `npm run test:db` runs the same tests against the
// real PostgreSQL test database in TEST_DATABASE_URL (a throwaway schema is created and dropped).
const REAL_DB = process.env.TEST_DATABASE_URL;
const TEST_SCHEMA = `carddesk_test_${process.pid}`;

let server, base, nexus, store, pool;
const cookies = {}; // one cookie jar per "browser"

async function api(method, url, { body, raw, type, as = "admin", headers = {} } = {}) {
  const h = { ...headers };
  if (as && cookies[as]) h.Cookie = cookies[as];
  let payload;
  if (raw !== undefined) { payload = raw; h["Content-Type"] = type || "application/octet-stream"; }
  else if (body !== undefined) { payload = typeof body === "string" ? body : JSON.stringify(body); h["Content-Type"] = "application/json"; }
  const res = await fetch(base + url, { method, headers: h, body: payload, redirect: "manual" });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie && as) cookies[as] = setCookie.split(";")[0];
  const ct = res.headers.get("content-type") || "";
  const data = ct.includes("application/json") ? await res.json() : ct.startsWith("image/png") ? Buffer.from(await res.arrayBuffer()) : await res.text();
  return { status: res.status, data, headers: res.headers };
}

const login = (as, email, password) => api("POST", "/api/auth/login", { as, body: { email, password } });
const SENSITIVE = ["bank_account_number", "bank_ifsc", "pan_number", "aadhaar_number", "residence_proof_reference", "ABCDE1234F", "123412341234", "123456789012", "HDFC0000001"];

before(async () => {
  nexus = await startFakeNexus();
  if (REAL_DB) {
    const admin = new pg.Client({ connectionString: REAL_DB });
    await admin.connect();
    await admin.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE; CREATE SCHEMA ${TEST_SCHEMA}`);
    await admin.end();
    pool = new pg.Pool({ connectionString: REAL_DB, options: `-c search_path=${TEST_SCHEMA}` });
  } else {
    const { Pool } = newDb().adapters.createPg();
    pool = new Pool();
  }
  store = createStore(pool);
  await store.migrate();

  const config = loadConfig({
    skipEnvFile: true, logRequests: false, databaseUrl: "unused-in-tests",
    nexusUrl: nexus.url, nexusEmail: "service@casterly.com", nexusPassword: "service-pass", nexusCacheSeconds: 60,
  });
  const client = createNexusClient({ baseUrl: config.nexusUrl, email: config.nexusEmail, password: config.nexusPassword });
  const directory = createDirectory(client, { ttlSeconds: config.nexusCacheSeconds });
  const app = createApp({ config, store, directory, nexus: client });
  await new Promise((resolve) => { server = app.listen(0, "127.0.0.1", resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  if (REAL_DB) {
    await pool.end();
    const admin = new pg.Client({ connectionString: REAL_DB });
    await admin.connect();
    await admin.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
    await admin.end();
  }
  await nexus.close();
});

test("config refuses to start without the database and nexusAuth settings", () => {
  assert.throws(() => loadConfig({ skipEnvFile: true }), /DATABASE_URL, NEXUSAUTH_URL, NEXUSAUTH_EMAIL, NEXUSAUTH_PASSWORD/);
  assert.throws(() => loadConfig({ skipEnvFile: true, allowMissing: true, databaseSchema: "bad;drop" }), /DATABASE_SCHEMA/);
});

test("health and static frontend are served", async () => {
  assert.equal((await api("GET", "/api/health")).data.ok, true);
  const index = await api("GET", "/");
  assert.equal(index.status, 200);
  assert.match(index.data, /CardDesk/);
  assert.match(index.headers.get("content-security-policy"), /default-src 'self'/);
  assert.equal((await api("GET", "/vendor/qrcode.js")).status, 200);
  assert.equal((await api("GET", "/nope")).status, 404);
  assert.equal((await api("GET", "/api/nope")).status, 404);
});

test("protected routes require sign-in", async () => {
  for (const [m, u] of [["GET", "/api/employees"], ["GET", "/api/settings"], ["PUT", "/api/settings"], ["POST", "/api/uploads"], ["GET", "/api/status"], ["GET", "/api/employees/11"]]) {
    const r = await api(m, u, { as: null, body: m === "GET" ? undefined : {} });
    assert.equal(r.status, 401, `${m} ${u}`);
  }
  const me = await api("GET", "/api/auth/me", { as: null });
  assert.equal(me.status, 200);
  assert.equal(me.data.user, null);
});

test("sign-in uses nexusAuth accounts and roles", async () => {
  assert.equal((await api("POST", "/api/auth/login", { as: null, body: {} })).status, 400);
  const wrong = await login(null, "admin@casterly.com", "nope");
  assert.equal(wrong.status, 401);
  assert.equal(wrong.data.error, "Invalid email or password");
  const viewer = await login("viewer", "viewer@casterly.com", "viewer-pass");
  assert.equal(viewer.status, 403);
  assert.match(viewer.data.error, /read_only/);
  assert.equal(viewer.headers.get("set-cookie"), null);

  const ok = await login("admin", " ADMIN@casterly.com ", "admin-pass");
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.data.user, { id: 2, email: "admin@casterly.com", name: "Asha Admin", role: "admin" });
  assert.match(ok.headers.get("set-cookie"), /HttpOnly/i);
  assert.match(ok.headers.get("set-cookie"), /SameSite=Lax/i);
  assert.equal((await api("GET", "/api/auth/me")).data.user.email, "admin@casterly.com");
  assert.equal((await login("ops", "ops@orbit.com", "ops-pass")).status, 200);
});

test("employees come from nexusAuth, exited ones left out, sensitive fields never exposed", async () => {
  const r = await api("GET", "/api/employees");
  assert.equal(r.status, 200);
  assert.equal(r.data.source, "nexusAuth");
  assert.deepEqual(r.data.employees.map((e) => e.name), ["Ravi Kiran", "Nandeesh", "Daniel Okafor"]);
  assert.equal(r.data.total, 3);
  const ravi = r.data.employees[0];
  assert.equal(ravi.id, "11");
  assert.match(ravi.slug, /^[A-Za-z0-9]{8}$/);
  assert.equal(ravi.email, "ravikiran@casterly.com");
  assert.equal(ravi.company, "Casterly");
  assert.equal(ravi.department, "IT");
  assert.equal(ravi.phone, "+91 98450 00011");
  assert.equal(ravi.address, "Tower B Beacon, 4th Floor, Bengaluru 560022");
  assert.equal(ravi.linkedin, "https://linkedin.com/in/ravikiran");
  assert.match(ravi.photo, new RegExp(`^/media/photos/${ravi.slug}\\?v=[a-f0-9]{10}$`));
  assert.equal(ravi.accent, "#678b27");
  assert.equal(r.data.employees[1].photo, "");
  const text = JSON.stringify(r.data);
  for (const s of SENSITIVE) assert.ok(!text.includes(s), `response must not contain ${s}`);

  assert.deepEqual((await api("GET", "/api/employees?q=design")).data.employees.map((e) => e.name), ["Nandeesh"]);
  assert.equal((await api("GET", "/api/employees/13")).status, 404, "exited employee has no card");
  assert.equal((await api("GET", "/api/employees/11")).data.employee.name, "Ravi Kiran");
});

test("operators only see their own company's employees", async () => {
  const r = await api("GET", "/api/employees", { as: "ops" });
  assert.deepEqual(r.data.employees.map((e) => e.name), ["Daniel Okafor"]);
  assert.equal((await api("GET", "/api/employees/11", { as: "ops" })).status, 404);
});

test("changes in nexusAuth show up on refresh and the card link stays the same", async () => {
  const before = (await api("GET", "/api/employees")).data.employees[0];
  nexus.employees[0].designation = "Lead Developer";
  assert.equal((await api("GET", "/api/employees")).data.employees[0].designation, "Developer", "cached for a short time");
  const fresh = (await api("GET", "/api/employees?refresh=1")).data.employees[0];
  assert.equal(fresh.designation, "Lead Developer");
  assert.equal(fresh.slug, before.slug);
});

test("there is no way to create, edit or delete employees in CardDesk", async () => {
  assert.equal((await api("POST", "/api/employees", { body: { name: "X" } })).status, 404);
  assert.equal((await api("PUT", "/api/employees/11", { body: { name: "X" } })).status, 404);
  assert.equal((await api("DELETE", "/api/employees/11")).status, 404);
  assert.equal((await api("POST", "/api/employees/reset")).status, 404);
  assert.equal((await api("GET", "/api/backup")).status, 404);
});

test("public card page, card data, photo and vCard work without sign-in", async () => {
  const ravi = (await api("GET", "/api/employees")).data.employees[0];
  const page = await api("GET", `/c/${ravi.slug}`, { as: null });
  assert.equal(page.status, 200);
  assert.match(page.data, /card-page\.js/);

  const card = await api("GET", `/api/public/cards/${ravi.slug}`, { as: null });
  assert.equal(card.status, 200);
  assert.equal(card.data.card.name, "Ravi Kiran");
  assert.equal(card.data.card.designation, "Lead Developer");
  assert.equal(card.data.card.id, undefined);
  assert.equal(card.data.card.employeeCode, undefined);
  for (const s of SENSITIVE) assert.ok(!JSON.stringify(card.data).includes(s));

  const photo = await api("GET", ravi.photo, { as: null });
  assert.equal(photo.status, 200);
  assert.equal(photo.headers.get("content-type"), "image/png");
  assert.deepEqual(photo.data, PNG_1PX);
  // Daniel's photo is listed in nexusAuth but the file is missing: once checked, it's left off the card.
  await new Promise((r) => setTimeout(r, 200));
  const daniel = (await api("GET", "/api/employees")).data.employees[2];
  assert.equal(daniel.name, "Daniel Okafor");
  assert.equal(daniel.photo, "");
  assert.equal((await api("GET", "/media/photos/ZZZZZZZZ", { as: null })).status, 404);

  const vcf = await api("GET", `/api/public/cards/${ravi.slug}/vcard`, { as: null });
  assert.equal(vcf.status, 200);
  assert.match(vcf.headers.get("content-type"), /text\/vcard/);
  assert.match(vcf.headers.get("content-disposition"), /Ravi_Kiran\.vcf/);
  assert.match(vcf.data, /^BEGIN:VCARD\r\n/);
  assert.match(vcf.data, /FN:Ravi Kiran/);
  assert.match(vcf.data, /TITLE:Lead Developer/);
  assert.match(vcf.data, /TEL;TYPE=CELL:\+91 98450 00011/);
  assert.match(vcf.data, /PHOTO;ENCODING=b;TYPE=PNG:/);
  assert.match(vcf.data, new RegExp(`/c/${ravi.slug}`));

  assert.equal((await api("GET", "/api/public/cards/nope", { as: null })).status, 404);
  assert.equal((await api("GET", "/api/public/cards/ZZZZZZZZ", { as: null })).status, 404);
});

test("an employee who exits in nexusAuth loses their card", async () => {
  const nandeesh = (await api("GET", "/api/employees")).data.employees[1];
  assert.equal((await api("GET", `/api/public/cards/${nandeesh.slug}`, { as: null })).status, 200);
  nexus.employees[1].status = "exited";
  await api("GET", "/api/employees?refresh=1");
  assert.equal((await api("GET", `/api/public/cards/${nandeesh.slug}`, { as: null })).status, 404);
  nexus.employees[1].status = "on_leave";
  await api("GET", "/api/employees?refresh=1");
});

test("QR code and admin vCard downloads", async () => {
  const qr = await api("GET", "/api/employees/11/qr.svg?download=1");
  assert.equal(qr.status, 200);
  assert.match(qr.headers.get("content-type"), /image\/svg\+xml/);
  assert.match(qr.headers.get("content-disposition"), /Ravi_Kiran_QR\.svg/);
  assert.match(qr.data, /^<svg/);
  const vcf = await api("GET", "/api/employees/11/vcard");
  assert.match(vcf.data, /ORG:Casterly/);
  assert.equal((await api("GET", "/api/employees/999/vcard")).status, 404);
});

let bannerUrl;
test("uploads are stored in the database and checked by content", async () => {
  const ok = await api("POST", "/api/uploads", { raw: PNG_1PX, type: "image/png" });
  assert.equal(ok.status, 201);
  assert.match(ok.data.url, /^\/media\/assets\/[a-f0-9]{32}\.png$/);
  bannerUrl = ok.data.url;
  const served = await api("GET", bannerUrl, { as: null });
  assert.equal(served.status, 200);
  assert.equal(served.headers.get("content-type"), "image/png");
  assert.deepEqual(served.data, PNG_1PX);

  assert.equal((await api("POST", "/api/uploads", { raw: Buffer.from("<svg><script>alert(1)</script></svg>"), type: "image/svg+xml" })).status, 415);
  assert.equal((await api("POST", "/api/uploads", { raw: Buffer.alloc(0), type: "image/png" })).status, 400);
  const tooBig = await api("POST", "/api/uploads", { raw: Buffer.concat([PNG_1PX, Buffer.alloc(5 * 1024 * 1024 + 10)]), type: "image/png" });
  assert.equal(tooBig.status, 413);
  assert.equal(tooBig.data.error, "Image must be 5 MB or smaller");
  assert.equal((await api("GET", "/media/assets/0123456789abcdef0123456789abcdef.png", { as: null })).status, 404);
});

test("card settings: banner, branding and QR address apply to every card", async () => {
  const s = await api("GET", "/api/settings");
  assert.equal(s.status, 200);
  assert.equal(s.data.banner, "");
  assert.equal(s.data.accent, "#678b27");
  assert.match(s.data.cardBaseUrl, /^http:\/\/127\.0\.0\.1:\d+$/);

  assert.equal((await api("PUT", "/api/settings", { body: { banner: "preset:sage" } })).data.banner, "preset:sage");
  for (const bad of [{ banner: "preset:neon" }, { banner: "javascript:alert(1)" }, { banner: 42 }, { accent: "red" }, { website: "not a url" }, { logo: "/etc/passwd" }, { publicUrl: "ftp://x" }]) {
    assert.equal((await api("PUT", "/api/settings", { body: bad })).status, 400, JSON.stringify(bad));
  }
  assert.equal((await api("PUT", "/api/settings", { body: { logo: "/media/assets/0123456789abcdef0123456789abcdef.png" } })).status, 400, "missing image");

  const up = await api("PUT", "/api/settings", { body: { banner: bannerUrl, logo: bannerUrl, website: "casterly.com", accent: "#AABBCC" } });
  assert.equal(up.status, 200);
  assert.equal(up.data.website, "https://casterly.com/");
  const ravi = (await api("GET", "/api/employees")).data.employees[0];
  assert.equal(ravi.logo, bannerUrl);
  assert.equal(ravi.website, "https://casterly.com/");
  assert.equal(ravi.accent, "#aabbcc");
  const pub = await api("GET", `/api/public/cards/${ravi.slug}`, { as: null });
  assert.equal(pub.data.banner, bannerUrl);
  assert.equal(pub.data.card.logo, bannerUrl);

  // Replacing both drops the uploaded image from the database.
  await api("PUT", "/api/settings", { body: { banner: "preset:mist", logo: "" } });
  assert.equal((await api("GET", bannerUrl, { as: null })).status, 404);

  const p = await api("PUT", "/api/settings", { body: { publicUrl: "https://cards.example.com/" } });
  assert.equal(p.data.cardBaseUrl, "https://cards.example.com");
  assert.match((await api("GET", "/api/employees/11/vcard")).data, /https:\/\/cards\.example\.com\/c\//);
  assert.equal((await api("PUT", "/api/settings", { body: { publicUrl: "" } })).data.publicUrl, "");
});

test("if nexusAuth goes down, cards keep working from the last list and the problem is reported", async () => {
  const ravi = (await api("GET", "/api/employees")).data.employees[0];
  nexus.down = true;
  try {
    const forced = await api("GET", "/api/employees?refresh=1");
    assert.equal(forced.status, 503);
    assert.match(forced.data.error, /nexusAuth/);
    assert.equal((await api("GET", `/api/public/cards/${ravi.slug}`, { as: null })).status, 200, "served from the last good list");
    const st = await api("GET", "/api/status");
    assert.equal(st.data.database, "ok");
    assert.match(st.data.nexusAuth.lastError.message, /502/);
    assert.equal((await login(null, "admin@casterly.com", "admin-pass")).status, 503);
  } finally {
    nexus.down = false;
  }
  const back = await api("GET", "/api/employees?refresh=1");
  assert.equal(back.status, 200);
  assert.equal(back.data.lastError, null);
});

test("cross-site writes are blocked", async () => {
  assert.equal((await api("PUT", "/api/settings", { body: { banner: "" }, headers: { Origin: "https://evil.example" } })).status, 403);
});

test("logout ends the session", async () => {
  assert.equal((await api("POST", "/api/auth/logout")).status, 204);
  assert.equal((await api("GET", "/api/employees")).status, 401);
  assert.equal((await api("GET", "/api/auth/me")).data.user, null);
});

test("sign-in is rate limited", async () => {
  let last;
  for (let i = 0; i < 11; i++) last = await login(null, "admin@casterly.com", "bad");
  assert.equal(last.status, 429);
  assert.ok(last.headers.get("retry-after"));
});
