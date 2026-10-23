import fs from "node:fs";
import path from "node:path";

export const ROOT = path.resolve(import.meta.dirname, "..");

// First value that is set and not blank (an empty variable in a hosting dashboard means "use the default").
const pick = (...vals) => vals.find((v) => v !== undefined && v !== null && String(v).trim() !== "");
const bool = (v, fallback) => (v === undefined || v === "" ? fallback : /^(1|true|yes)$/i.test(String(v)));
const list = (v) => String(v).split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

// Reads settings from (in order) explicit overrides, environment variables, then .env.
export function loadConfig(overrides = {}) {
  const envFile = path.join(ROOT, ".env");
  if (!overrides.skipEnvFile && fs.existsSync(envFile)) process.loadEnvFile(envFile);
  const env = overrides.skipEnvFile ? {} : process.env;

  const config = {
    port: Number(pick(overrides.port, env.PORT, 4300)),
    host: pick(overrides.host, env.HOST, "0.0.0.0"),
    publicUrl: String(pick(overrides.publicUrl, env.PUBLIC_URL) ?? "").replace(/\/+$/, ""),
    trustProxy: overrides.trustProxy ?? bool(env.TRUST_PROXY, false),
    sessionHours: Number(pick(overrides.sessionHours, env.SESSION_HOURS, 12)),
    logRequests: overrides.logRequests ?? bool(env.LOG_REQUESTS, true),

    // CardDesk's own settings live in this schema inside nexusAuth's database (no separate database).
    databaseUrl: String(pick(overrides.databaseUrl, env.DATABASE_URL) ?? ""),
    databaseSchema: String(pick(overrides.databaseSchema, env.DATABASE_SCHEMA, "carddesk")),

    // nexusAuth (Nexus core) is the only source of employee data.
    nexusUrl: String(pick(overrides.nexusUrl, env.NEXUSAUTH_URL, "") ?? "").replace(/\/+$/, ""),
    nexusEmail: String(pick(overrides.nexusEmail, env.NEXUSAUTH_EMAIL, "") ?? ""),
    nexusPassword: String(pick(overrides.nexusPassword, env.NEXUSAUTH_PASSWORD, "") ?? ""),
    nexusCacheSeconds: Number(pick(overrides.nexusCacheSeconds, env.NEXUSAUTH_CACHE_SECONDS, 30)),
    // nexusAuth roles allowed to sign in to CardDesk.
    allowedRoles: list(pick(overrides.allowedRoles, env.ALLOWED_ROLES, "admin,operator")),
  };

  const missing = [
    !config.databaseUrl && "DATABASE_URL",
    !config.nexusUrl && "NEXUSAUTH_URL",
    !config.nexusEmail && "NEXUSAUTH_EMAIL",
    !config.nexusPassword && "NEXUSAUTH_PASSWORD",
  ].filter(Boolean);
  if (missing.length && !overrides.allowMissing) {
    throw new Error(`Missing settings: ${missing.join(", ")}. Set them in .env (see .env.example).`);
  }
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(config.databaseSchema)) throw new Error("DATABASE_SCHEMA must be a plain lowercase name");
  return config;
}
