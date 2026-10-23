// People sign in to CardDesk with their nexusAuth account (see nexus.js verifyUser); CardDesk has no
// user accounts or passwords of its own. This file holds the session cookie and login rate limiting.

export const SESSION_COOKIE = "carddesk_sid";

export function parseCookies(header = "") {
  const out = {};
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    if (!key) continue;
    try { out[key] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* skip malformed cookie */ }
  }
  return out;
}

// Simple fixed-window limiter for login attempts, keyed by IP.
export function createRateLimiter({ max, windowMs }) {
  const hits = new Map();
  return {
    check(key) {
      const now = Date.now();
      let entry = hits.get(key);
      if (!entry || entry.reset < now) { entry = { count: 0, reset: now + windowMs }; hits.set(key, entry); }
      entry.count += 1;
      if (hits.size > 10000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
      return { allowed: entry.count <= max, retryAfter: Math.ceil((entry.reset - now) / 1000) };
    },
    reset(key) { hits.delete(key); },
  };
}
