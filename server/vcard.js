import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const qrcode = require("qrcode-generator");

// RFC 6350 text escaping.
const esc = (s = "") => String(s).replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/([,;])/g, "\\$1");

// vCard lines longer than 75 characters must be folded (continuation lines start with a space).
function fold(line) {
  if (line.length <= 75) return line;
  const chunks = [line.slice(0, 75)];
  for (let i = 75; i < line.length; i += 74) chunks.push(" " + line.slice(i, i + 74));
  return chunks.join("\r\n");
}

// photo: { type: "JPEG" | "PNG" | "GIF", base64 } for an embedded image, or { uri } for an external one.
export function buildVCard(e, cardUrl, photo = null) {
  const parts = (e.name || "").trim().split(/\s+/);
  const first = parts.shift() || "";
  const last = parts.join(" ");
  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `N:${esc(last)};${esc(first)};;;`,
    `FN:${esc(e.name)}`,
    e.company && `ORG:${esc(e.company)}`,
    e.designation && `TITLE:${esc(e.designation)}`,
    e.phone && `TEL;TYPE=CELL:${esc(e.phone)}`,
    e.email && `EMAIL;TYPE=INTERNET:${esc(e.email)}`,
    e.website && `URL:${esc(e.website)}`,
    e.address && `ADR;TYPE=WORK:;;${esc(e.address)};;;;`,
    e.linkedin && `X-SOCIALPROFILE;TYPE=linkedin:${esc(e.linkedin)}`,
    e.github && `X-SOCIALPROFILE;TYPE=github:${esc(e.github)}`,
    e.instagram && `X-SOCIALPROFILE;TYPE=instagram:${esc(e.instagram)}`,
    e.x && `X-SOCIALPROFILE;TYPE=x:${esc(e.x)}`,
    cardUrl && `NOTE:Digital card: ${esc(cardUrl)}`,
    photo && photo.base64 && `PHOTO;ENCODING=b;TYPE=${photo.type}:${photo.base64}`,
    photo && photo.uri && `PHOTO;VALUE=uri:${photo.uri}`,
    "END:VCARD",
  ];
  return lines.filter(Boolean).map(fold).join("\r\n") + "\r\n";
}

export function vcardFilename(e) {
  return `${(e.name || "contact").replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "") || "contact"}.vcf`;
}

export function qrSvg(text) {
  const qr = qrcode(0, "M");
  qr.addData(unescape(encodeURIComponent(text)), "Byte");
  qr.make();
  const n = qr.getModuleCount();
  let path = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) path += `M${c} ${r}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-4 -4 ${n + 8} ${n + 8}" shape-rendering="crispEdges"><rect x="-4" y="-4" width="${n + 8}" height="${n + 8}" fill="#fff"/><path d="${path}" fill="#1f2430"/></svg>`;
}
