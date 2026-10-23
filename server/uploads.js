import { HttpError } from "./validate.js";

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const IMAGE_TYPES = { png: "image/png", jpg: "image/jpeg", gif: "image/gif", webp: "image/webp" };

// Detect the image type from its first bytes. SVG is deliberately not accepted (it can carry scripts).
export function sniffImage(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf.toString("ascii", 0, 4) === "GIF8") return "gif";
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "webp";
  return null;
}

export function checkUpload(buf) {
  if (!Buffer.isBuffer(buf) || buf.length === 0) throw new HttpError(400, "No image received");
  const ext = sniffImage(buf);
  if (!ext) throw new HttpError(415, "Only PNG, JPG, WEBP or GIF images are allowed");
  return ext;
}
