// One-time import from the old stand-alone CardDesk (data/carddesk.db, SQLite) into CardDesk's schema in
// nexusAuth's database. It copies only what isn't employee data:
//   * each card's QR link (slug), matched to the nexusAuth employee with the same email, so QR codes that
//     were already printed keep working;
//   * the card banner and QR address setting;
//   * the logo and website most of the matched employees used, as the shared card branding.
// Employee details are NOT copied: they come from nexusAuth.
//
//   node scripts/import-old-carddesk.js            preview what would be imported (changes nothing)
//   node scripts/import-old-carddesk.js --apply    import it
//
// The old SQLite file is only read, never changed or deleted.

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { loadConfig, ROOT } from "../server/config.js";
import { createPool, createStore } from "../server/db.js";
import { createNexusClient, toCardEmployee } from "../server/nexus.js";
import { sniffImage, IMAGE_TYPES } from "../server/uploads.js";
import { validateSettings } from "../server/validate.js";

const apply = process.argv.includes("--apply");
const oldFile = path.join(ROOT, "data", "carddesk.db");
const oldUploads = path.join(ROOT, "data", "uploads");
if (!fs.existsSync(oldFile)) { console.log(`Nothing to import: ${oldFile} doesn't exist.`); process.exit(0); }

const config = loadConfig();
const old = new DatabaseSync(oldFile, { readOnly: true });
const oldEmployees = old.prepare("SELECT name, email, slug, logo, website, accent FROM employees").all();
const oldSettings = Object.fromEntries(old.prepare("SELECT key, value FROM settings").all().map((r) => [r.key, r.value]));
old.close();

const client = createNexusClient({ baseUrl: config.nexusUrl, email: config.nexusEmail, password: config.nexusPassword });
const nexusByEmail = new Map((await client.employees()).map((r) => toCardEmployee(r, new Map())).filter((e) => e.email).map((e) => [e.email, e]));

const matched = [], unmatched = [];
for (const e of oldEmployees) {
  const n = nexusByEmail.get(String(e.email || "").trim().toLowerCase());
  (n ? matched : unmatched).push({ ...e, nexus: n });
}

const mostCommon = (values) => {
  const counts = new Map();
  for (const v of values.filter(Boolean)) counts.set(v, (counts.get(v) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
};
const logo = mostCommon(matched.map((e) => e.logo));
const website = mostCommon(matched.map((e) => e.website));
const accent = mostCommon(matched.map((e) => e.accent));

console.log(`Old CardDesk: ${oldEmployees.length} employees.`);
console.log(`\nIn nexusAuth (their QR links will keep working):`);
for (const e of matched) console.log(`  ${e.name} <${e.email}>  →  nexusAuth #${e.nexus.nexusId}, link /c/${e.slug}`);
console.log(`\nNot in nexusAuth (their cards and QR links stop working):`);
for (const e of unmatched) console.log(`  ${e.name} <${e.email}>`);
console.log(`\nCard settings: banner=${oldSettings.banner || "(default)"}, QR address=${oldSettings.publicUrl || "(this site)"}`);
console.log(`Card branding: logo=${logo || "(none)"}, website=${website || "(none)"}, accent=${accent || "(default)"}`);

// The script ends by itself (no process.exit) so network connections close cleanly.
if (!apply) console.log("\nPreview only. Run again with --apply to import.");
else await importAll();

async function importAll() {
const store = createStore(createPool(config.databaseUrl, config.databaseSchema));
await store.migrate();

// Uploaded images in the old app live in data/uploads/; copy them into CardDesk's schema.
async function image(url) {
  if (!url) return "";
  const m = /^\/uploads\/([a-f0-9]{32}\.(png|jpg|webp|gif))$/.exec(url);
  if (!m) return /^https?:\/\//.test(url) || url.startsWith("preset:") ? url : "";
  const file = path.join(oldUploads, m[1]);
  if (!fs.existsSync(file)) { console.log(`  skipped missing image ${url}`); return ""; }
  const buf = fs.readFileSync(file);
  const ext = sniffImage(buf);
  if (!ext) return "";
  return `/media/assets/${await store.saveAsset(IMAGE_TYPES[ext], buf)}.${ext}`;
}

let links = 0;
for (const e of matched) if (await store.importLink(e.nexus.nexusId, e.slug)) links++;
const values = {};
const current = await store.getSettings();
if (!current.banner && oldSettings.banner) values.banner = await image(oldSettings.banner);
if (!current.publicUrl && oldSettings.publicUrl) values.publicUrl = oldSettings.publicUrl;
if (!current.logo && logo) values.logo = await image(logo);
if (!current.website && website) values.website = website;
if (!current.accent && accent) values.accent = accent;
await store.setSettings(validateSettings(Object.fromEntries(Object.entries(values).filter(([, v]) => v))));
await store.close();
console.log(`\nImported ${links} QR links and ${Object.keys(values).length} card settings. The old file was left as it is.`);
}
