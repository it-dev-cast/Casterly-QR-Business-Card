export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const BANNER_PRESETS = ["mist", "sand", "sage", "blush", "slate", "lilac"];
export const DEFAULT_ACCENT = "#678b27";

// Images uploaded to CardDesk (banner, logo) are stored in its schema and served from /media/assets/.
export const ASSET_PATH_RE = /^\/media\/assets\/([a-f0-9]{32})\.(png|jpg|webp|gif)$/;

function httpUrl(value, max = 500) {
  if (value.length > max) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
  let u;
  try { u = new URL(withScheme); } catch { return null; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (!u.hostname.includes(".") && u.hostname !== "localhost") return null;
  return u.href;
}

// An uploaded image or an http(s) image URL.
function image(value) {
  if (ASSET_PATH_RE.test(value)) return value;
  return /^https?:\/\//i.test(value) ? httpUrl(value) : null;
}

const text = (input, key) => {
  const v = input[key];
  if (typeof v !== "string") throw new HttpError(400, `${key} must be text`, { [key]: "Must be text" });
  return v.trim();
};

// Card settings shared by every employee's card. Employee details themselves come from nexusAuth.
export function validateSettings(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new HttpError(400, "Request body must be a JSON object");
  const out = {};

  if ("banner" in input) {
    const b = text(input, "banner");
    if (b === "" || (b.startsWith("preset:") && BANNER_PRESETS.includes(b.slice(7)))) out.banner = b;
    else if (image(b)) out.banner = image(b);
    else throw new HttpError(400, "Banner must be a preset, an uploaded image or an http(s) image URL", { banner: "Invalid banner" });
  }
  if ("logo" in input) {
    const v = text(input, "logo");
    if (v && !image(v)) throw new HttpError(400, "Logo must be an uploaded image or an http(s) image URL", { logo: "Invalid logo" });
    out.logo = v ? image(v) : "";
  }
  if ("website" in input) {
    const v = text(input, "website");
    if (v && !httpUrl(v, 300)) throw new HttpError(400, "Website must be a valid web address", { website: "Invalid website" });
    out.website = v ? httpUrl(v, 300) : "";
  }
  if ("accent" in input) {
    const v = text(input, "accent");
    if (v && !/^#[0-9a-f]{6}$/i.test(v)) throw new HttpError(400, "Accent colour must look like #678b27", { accent: "Invalid colour" });
    out.accent = (v || DEFAULT_ACCENT).toLowerCase();
  }
  if ("publicUrl" in input) {
    const v = text(input, "publicUrl");
    if (v === "" || v === "lan") out.publicUrl = v;
    else {
      let u;
      try { u = new URL(v); } catch { /* handled below */ }
      if (!u || !/^https?:$/.test(u.protocol) || v.length > 300) {
        throw new HttpError(400, "Public URL must be a full address like https://cards.example.com", { publicUrl: "Invalid URL" });
      }
      out.publicUrl = (u.origin + u.pathname).replace(/\/+$/, "");
    }
  }
  return out;
}
