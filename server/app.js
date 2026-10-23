import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import express from "express";
import { ROOT } from "./config.js";
import { SLUG_RE } from "./db.js";
import { SESSION_COOKIE, parseCookies, createRateLimiter } from "./auth.js";
import { HttpError, validateSettings, ASSET_PATH_RE, DEFAULT_ACCENT } from "./validate.js";
import { buildVCard, vcardFilename, qrSvg } from "./vcard.js";
import { checkUpload, sniffImage, MAX_UPLOAD_BYTES, IMAGE_TYPES } from "./uploads.js";

const require = createRequire(import.meta.url);
const PUBLIC_DIR = path.join(ROOT, "public");
const QR_LIB = require.resolve("qrcode-generator/qrcode.js");

export const LAN_MODE = "lan"; // publicUrl value meaning "this computer's current network address"

const isPrivateIPv4 = (ip) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
const isCgnatIPv4 = (ip) => /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip); // VPN/tunnel range (e.g. Tailscale)

// This computer's network addresses, best first: normal Wi-Fi/LAN ranges, then others, then VPN/tunnel addresses.
export function lanUrls(port) {
  const ips = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === "IPv4" && !a.internal && !a.address.startsWith("169.254.")) ips.push(a.address);
    }
  }
  const rank = (ip) => (isPrivateIPv4(ip) ? 0 : isCgnatIPv4(ip) ? 2 : 1);
  return ips.sort((a, b) => rank(a) - rank(b)).map((ip) => `http://${ip}:${port}`);
}

// A saved address that points at this server's own old network IP (private IP, same port, no longer assigned).
function isStaleSelfAddress(url, port) {
  let u;
  try { u = new URL(url); } catch { return false; }
  if (!isPrivateIPv4(u.hostname) && !isCgnatIPv4(u.hostname)) return false;
  if (String(u.port || (u.protocol === "https:" ? 443 : 80)) !== String(port)) return false;
  return !lanUrls(port).some((l) => new URL(l).hostname === u.hostname);
}

const shortHash = (s) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 10);

export function createApp({ config, store, directory, nexus }) {
  const app = express();
  const loginLimiter = createRateLimiter({ max: 10, windowMs: 15 * 60 * 1000 });

  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy);

  // ---------- logging & security headers ----------
  if (config.logRequests) {
    app.use((req, res, next) => {
      const start = Date.now();
      res.on("finish", () => {
        if (req.path.startsWith("/api/") || res.statusCode >= 400) {
          console.log(`${req.method} ${req.originalUrl.split("?")[0]} ${res.statusCode} ${Date.now() - start}ms`);
        }
      });
      next();
    });
  }

  app.use((req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy": [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com",
        "img-src 'self' data: blob: https:",
        "connect-src 'self'",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join("; "),
    });
    if (req.secure) res.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    next();
  });

  // Reject cross-site state-changing requests (defence in depth on top of SameSite cookies).
  app.use((req, res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    const origin = req.get("origin");
    if (origin && origin !== `${req.protocol}://${req.get("host")}`) return next(new HttpError(403, "Cross-site request blocked"));
    next();
  });

  const json = express.json({ limit: "64kb" });
  const route = (fn) => (req, res, next) => Promise.resolve().then(() => fn(req, res, next)).catch(next);

  // ---------- sign-in (with a nexusAuth account) ----------
  const currentToken = (req) => parseCookies(req.headers.cookie)[SESSION_COOKIE];
  const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, role: u.role });

  const requireAuth = route(async (req, res, next) => {
    const user = await store.getSession(currentToken(req));
    if (!user) throw new HttpError(401, "Please sign in");
    req.user = user;
    next();
  });

  app.post("/api/auth/login", json, route(async (req, res) => {
    const limit = loginLimiter.check(req.ip);
    if (!limit.allowed) {
      res.set("Retry-After", String(limit.retryAfter));
      throw new HttpError(429, "Too many sign-in attempts. Try again in a few minutes.");
    }
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!email || !password) throw new HttpError(400, "Email and password are required");
    let user;
    try {
      user = await nexus.verifyUser(email, password);
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(503, `Sign-in is unavailable: ${err.message}`);
    }
    if (!config.allowedRoles.includes(user.role)) {
      throw new HttpError(403, `Your nexusAuth role (${user.role || "none"}) can't use CardDesk. Ask an admin for the operator or admin role.`);
    }
    loginLimiter.reset(req.ip);
    const { token, expiresAt } = await store.createSession(user, config.sessionHours);
    res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: req.secure, path: "/", expires: expiresAt });
    res.json({ user: publicUser(user) });
  }));

  app.post("/api/auth/logout", route(async (req, res) => {
    await store.destroySession(currentToken(req));
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    res.status(204).end();
  }));

  // Returns { user: null } (not 401) when signed out, so page loads don't log errors.
  app.get("/api/auth/me", route(async (req, res) => {
    const user = await store.getSession(currentToken(req));
    res.json({ user: user ? publicUser(user) : null });
  }));

  // ---------- card settings (shared by all cards) ----------
  async function settings() {
    const s = await store.getSettings();
    return { banner: s.banner || "", logo: s.logo || "", website: s.website || "", accent: s.accent || DEFAULT_ACCENT, publicUrl: s.publicUrl || "" };
  }

  // The address QR codes point to. "lan" (and a saved, now-stale copy of this computer's old network
  // address) resolves to the current network address on every request, so codes follow IP changes.
  function publicUrlSetting(req, s) {
    const saved = s.publicUrl || config.publicUrl;
    if (saved && saved !== LAN_MODE && isStaleSelfAddress(saved, req.socket.localPort)) return { mode: LAN_MODE, healedFrom: saved };
    return { mode: saved === LAN_MODE ? LAN_MODE : saved ? "custom" : "site", value: saved === LAN_MODE ? "" : saved };
  }

  function cardBaseUrl(req, s) {
    const p = publicUrlSetting(req, s);
    const own = `${req.protocol}://${req.get("host")}`;
    if (p.mode === LAN_MODE) return lanUrls(req.socket.localPort)[0] || own;
    return p.value || own;
  }

  async function settingsPayload(req) {
    const s = await settings();
    const p = publicUrlSetting(req, s);
    return {
      banner: s.banner, logo: s.logo, website: s.website, accent: s.accent,
      publicUrl: p.mode === LAN_MODE ? LAN_MODE : p.value,
      publicUrlMode: p.mode,
      cardBaseUrl: cardBaseUrl(req, s),
      lanUrls: lanUrls(req.socket.localPort),
    };
  }

  // ---------- employees: read from nexusAuth, never stored ----------
  // Non-admins only see their own company's employees, as in nexusAuth.
  const visibleTo = (user, e) => user.role === "admin" || user.companyId === null || e.companyId === user.companyId;

  function toCard(e, slug, s) {
    return {
      id: String(e.nexusId),
      slug,
      employeeCode: e.employeeCode,
      name: e.name, designation: e.designation, department: e.department, company: e.company,
      email: e.email, phone: e.phone, address: e.address, linkedin: e.linkedin,
      photo: e.photoPath && !directory.photoMissing(e.photoPath) ? `/media/photos/${slug}?v=${shortHash(e.photoPath)}` : "",
      // Card branding (CardDesk settings, the same on every card).
      logo: s.logo, website: s.website, accent: s.accent,
    };
  }

  async function cardsFor(list) {
    const [slugs, s] = await Promise.all([store.slugsFor(list.map((e) => e.nexusId)), settings()]);
    return list.map((e) => toCard(e, slugs.get(e.nexusId), s));
  }

  async function findForUser(req) {
    const e = await directory.get(req.params.id);
    if (!e || !visibleTo(req.user, e)) throw new HttpError(404, "Employee not found");
    const [card] = await cardsFor([e]);
    return card;
  }

  app.get("/api/employees", requireAuth, route(async (req, res) => {
    const force = req.query.refresh === "1";
    const list = (await directory.list({ force })).filter((e) => visibleTo(req.user, e));
    const q = typeof req.query.q === "string" ? req.query.q.trim().toLowerCase().slice(0, 100) : "";
    const matches = q ? list.filter((e) => [e.name, e.designation, e.company, e.email, e.phone, e.department, e.employeeCode]
      .some((v) => (v || "").toLowerCase().includes(q))) : list;
    res.json({ employees: await cardsFor(matches), total: list.length, source: "nexusAuth", ...directory.status() });
  }));

  app.get("/api/employees/:id", requireAuth, route(async (req, res) => res.json({ employee: await findForUser(req) })));

  app.get("/api/employees/:id/vcard", requireAuth, route(async (req, res) => {
    const card = await findForUser(req);
    await sendVCard(res, card, `${cardBaseUrl(req, await settings())}/c/${card.slug}`);
  }));

  app.get("/api/employees/:id/qr.svg", requireAuth, route(async (req, res) => {
    const card = await findForUser(req);
    res.type("image/svg+xml");
    if (req.query.download) res.attachment(`${vcardFilename(card).replace(/\.vcf$/, "")}_QR.svg`);
    res.send(qrSvg(`${cardBaseUrl(req, await settings())}/c/${card.slug}`));
  }));

  app.get("/api/status", requireAuth, route(async (req, res) => {
    let database = "ok";
    try { await store.ping(); } catch (err) { database = err.message; }
    res.json({ database, nexusAuth: directory.status() });
  }));

  // ---------- settings ----------
  app.get("/api/settings", requireAuth, route(async (req, res) => res.json(await settingsPayload(req))));

  app.put("/api/settings", requireAuth, json, route(async (req, res) => {
    const clean = validateSettings(req.body);
    const before = await settings();
    for (const key of ["banner", "logo"]) {
      const m = ASSET_PATH_RE.exec(clean[key] || "");
      if (m && !(await store.getAsset(m[1]))) throw new HttpError(400, `That ${key} image no longer exists. Upload it again.`, { [key]: "Missing image" });
    }
    await store.setSettings(clean);
    // Delete an uploaded image once neither setting uses it any more.
    const after = await settings();
    for (const old of [before.banner, before.logo]) {
      const m = ASSET_PATH_RE.exec(old);
      if (m && old !== after.banner && old !== after.logo) await store.deleteAsset(m[1]);
    }
    res.json(await settingsPayload(req));
  }));

  // ---------- images uploaded for the cards (stored in CardDesk's schema) ----------
  app.post("/api/uploads", requireAuth, express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES }), route(async (req, res) => {
    const ext = checkUpload(req.body);
    const id = await store.saveAsset(IMAGE_TYPES[ext], req.body);
    res.status(201).json({ url: `/media/assets/${id}.${ext}` });
  }));

  app.get("/media/assets/:file", route(async (req, res) => {
    const m = ASSET_PATH_RE.exec(`/media/assets/${req.params.file}`);
    const asset = m && await store.getAsset(m[1]);
    if (!asset) throw new HttpError(404, "File not found");
    res.set({ "Content-Type": asset.contentType, "Cache-Control": "public, max-age=2592000, immutable" });
    res.send(asset.data);
  }));

  // Employee photos come from nexusAuth (which usually isn't reachable from phones), served through here.
  app.get("/media/photos/:slug", route(async (req, res) => {
    const id = await store.employeeIdForSlug(req.params.slug);
    const e = id === null ? null : await directory.get(id);
    const buf = e && e.photoPath ? await directory.photo(e.photoPath) : null;
    const ext = buf && sniffImage(buf);
    if (!ext) throw new HttpError(404, "File not found");
    res.set({ "Content-Type": IMAGE_TYPES[ext], "Cache-Control": "public, max-age=3600" });
    res.send(buf);
  }));

  // ---------- public card (what the QR opens) ----------
  const PHOTO_TYPES = { jpg: "JPEG", png: "PNG", gif: "GIF" };
  const MAX_VCARD_PHOTO = 1024 * 1024;

  async function sendVCard(res, card, url) {
    let photo = null;
    const e = await directory.get(card.id);
    const buf = e && e.photoPath ? await directory.photo(e.photoPath) : null;
    const ext = buf && sniffImage(buf);
    if (ext && PHOTO_TYPES[ext] && buf.length <= MAX_VCARD_PHOTO) photo = { type: PHOTO_TYPES[ext], base64: buf.toString("base64") };
    res.attachment(vcardFilename(card)); // sets a legacy type from the extension, so override it after
    res.set("Content-Type", "text/vcard; charset=utf-8");
    res.set("Cache-Control", "no-store");
    res.send(buildVCard(card, url, photo));
  }

  async function publicCard(slug) {
    if (!SLUG_RE.test(String(slug))) return null;
    const id = await store.employeeIdForSlug(slug);
    const e = id === null ? null : await directory.get(id);
    if (!e) return null;
    const [card] = await cardsFor([e]);
    return card;
  }

  app.get("/api/public/cards/:slug", route(async (req, res) => {
    const card = await publicCard(req.params.slug);
    if (!card) throw new HttpError(404, "Card not found");
    const { id, employeeCode, ...shown } = card; // internal ids stay private
    res.set("Cache-Control", "no-store");
    res.json({ card: shown, banner: (await settings()).banner });
  }));

  app.get("/api/public/cards/:slug/vcard", route(async (req, res) => {
    const card = await publicCard(req.params.slug);
    if (!card) throw new HttpError(404, "Card not found");
    await sendVCard(res, card, `${cardBaseUrl(req, await settings())}/c/${card.slug}`);
  }));

  app.get("/c/:slug", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "card.html")));

  // ---------- frontend ----------
  app.get("/vendor/qrcode.js", (req, res) => res.sendFile(QR_LIB));
  app.get("/favicon.ico", (req, res) => res.type("image/svg+xml").sendFile(path.join(PUBLIC_DIR, "favicon.svg")));
  app.get("/api/health", (req, res) => res.json({ ok: true }));
  app.use("/api", (req, res, next) => next(new HttpError(404, "Not found")));
  app.use(express.static(PUBLIC_DIR, { index: "index.html", extensions: ["html"] }));
  app.use((req, res) => res.status(404).type("text/plain").send("Not found"));

  // ---------- errors ----------
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    let status = err.status || err.statusCode || 500;
    let message = err.message;
    if (err.type === "entity.too.large") message = req.path === "/api/uploads" ? "Image must be 5 MB or smaller" : "Request is too large";
    else if (err.type === "entity.parse.failed") message = "Request body is not valid JSON";
    if (status >= 500 && status !== 503) {
      console.error(err);
      status = 500;
      message = "Something went wrong on the server";
    }
    if (req.path.startsWith("/api/") || req.path.startsWith("/media/")) {
      res.status(status).json({ error: message, ...(err.details ? { details: err.details } : {}) });
    } else {
      res.status(status).type("text/plain").send(message);
    }
  });

  return app;
}
