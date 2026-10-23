// Renders an employee's shareable card (details + QR code) to a PNG.
// The QR popup previews this exact image, so what you see is what downloads.
window.CardImage = (() => {
  "use strict";

  const W = 1080;
  const H = 1600;
  const PAD = 80;
  // Colours come from the active NEXUS One theme at render time, so the download matches the screen.
  // The QR panel itself stays dark-on-white in every theme so all scanners can read it.
  const QR_LIGHT = "#ffffff";
  const QR_DARK = "#1d301d";
  let C = { surface: "#ffffff", text: "#1d301d", faint: "#646f61", border: "#e2e5dc" };

  const probe = document.createElement("canvas").getContext("2d");
  function toRgb(color) {
    probe.fillStyle = "#000";
    probe.fillStyle = color;
    const v = probe.fillStyle; // normalised to #rrggbb or rgba()
    if (v.startsWith("#")) { const n = parseInt(v.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
    return (v.match(/[\d.]+/g) || [0, 0, 0]).slice(0, 3).map(Number);
  }

  // Resolves a token that may contain color-mix()/var() into a concrete colour.
  function resolveColor(token, fallback) {
    const el = document.createElement("span");
    el.style.color = `var(${token}, ${fallback})`;
    el.hidden = true;
    document.body.appendChild(el);
    const c = getComputedStyle(el).color;
    el.remove();
    return c || fallback;
  }

  function readTheme() {
    const cs = getComputedStyle(document.documentElement);
    const v = (name, fallback) => cs.getPropertyValue(name).trim() || fallback;
    C = {
      surface: v("--color-theme-surface", "#ffffff"),
      text: v("--color-theme-text", "#1d301d"),
      faint: v("--color-text-faint", "#646f61"),
      border: v("--color-theme-border", "#e2e5dc"),
      avatarBg: resolveColor("--color-avatar-bg", "#e8f0d6"),
      avatarText: resolveColor("--color-avatar-text", "#42571f"),
    };
  }
  const FONT = '"Poppins", system-ui, -apple-system, "Segoe UI", sans-serif';
  const MONO = 'ui-monospace, "SFMono-Regular", Consolas, monospace';

  function loadImage(src) {
    return new Promise((resolve) => {
      if (!src) return resolve(null);
      const img = new Image();
      // Cross-origin images must allow CORS, otherwise the canvas could not be exported.
      if (/^https?:/i.test(src) && !src.startsWith(location.origin)) img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawCover(ctx, img, x, y, w, h) {
    const scale = Math.max(w / img.width, h / img.height);
    const sw = w / scale;
    const sh = h / scale;
    ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h);
  }

  // Blends a colour towards the theme surface, like color-mix() in the on-screen banner.
  function mix(color, towards, amount) {
    const a = toRgb(color);
    const b = toRgb(towards);
    return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * amount)).join(",")})`;
  }
  const mixWithSurface = (color, amount) => mix(color, C.surface, amount);

  // Shrinks the font until the text fits, then truncates with an ellipsis as a last resort.
  function fitText(ctx, text, maxWidth, size, minSize, weight, family = FONT) {
    let s = size;
    ctx.font = `${weight} ${s}px ${family}`;
    while (ctx.measureText(text).width > maxWidth && s > minSize) {
      s -= 2;
      ctx.font = `${weight} ${s}px ${family}`;
    }
    let t = text;
    while (ctx.measureText(t).width > maxWidth && t.length > 1) t = t.slice(0, -2) + "…";
    return t;
  }

  async function loadFonts() {
    if (!document.fonts || !document.fonts.load) return;
    await Promise.all(["700 64px Poppins", "600 34px Poppins", "500 26px Poppins", "400 24px Poppins"]
      .map((f) => document.fonts.load(f).catch(() => null)));
  }

  async function drawBanner(ctx, banner, accent, h) {
    if (banner && !banner.startsWith("preset:")) {
      const img = await loadImage(Card.safeImg(banner));
      if (img) { drawCover(ctx, img, 0, 0, W, h); return; }
    }
    let stops = banner && banner.startsWith("preset:") ? (Card.bannerCSS(banner, accent).match(/#[0-9a-f]{6}/gi) || []) : [];
    if (stops.length < 2) stops = [mixWithSurface(accent, 0.82), mixWithSurface(accent, 0.62)];
    const g = ctx.createLinearGradient(0, 0, W, h);
    g.addColorStop(0, stops[0]);
    g.addColorStop(1, stops[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, h);
    const fade = ctx.createLinearGradient(0, h * 0.6, 0, h);
    fade.addColorStop(0, "rgba(0,0,0,0)");
    fade.addColorStop(1, "rgba(0,0,0,0.06)");
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, W, h);
  }

  async function drawLogoPill(ctx, e, accent) {
    const h = 64;
    const logo = await loadImage(Card.safeImg(e.logo));
    const label = fitText(ctx, e.company || "", 420, 26, 18, 600);
    const textW = ctx.measureText(label).width;
    const w = 10 + 44 + 14 + textW + 26;
    const x = W - 40 - w;
    const y = 40;
    ctx.save();
    ctx.shadowColor = "rgba(29,48,29,0.12)";
    ctx.shadowBlur = 16;
    ctx.globalAlpha = 0.94;
    ctx.fillStyle = C.surface;
    roundRect(ctx, x, y, w, h, h / 2);
    ctx.fill();
    ctx.restore();

    const cx = x + 10 + 22;
    const cy = y + h / 2;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, 22, 0, Math.PI * 2);
    ctx.clip();
    if (logo) drawCover(ctx, logo, cx - 22, cy - 22, 44, 44);
    else {
      ctx.fillStyle = accent;
      ctx.fillRect(cx - 22, cy - 22, 44, 44);
      ctx.fillStyle = "#fff";
      ctx.font = `700 22px ${FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(Card.initials(e.company).slice(0, 1), cx, cy + 1);
    }
    ctx.restore();

    ctx.fillStyle = C.text;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    fitText(ctx, label, 420, 26, 18, 600); // restores the label font
    ctx.fillText(label, x + 10 + 44 + 14, cy + 1);
  }

  async function drawPhoto(ctx, e, x, y, size) {
    const r = 48;
    ctx.save();
    ctx.shadowColor = "rgba(29,48,29,0.18)";
    ctx.shadowBlur = 30;
    ctx.shadowOffsetY = 10;
    ctx.fillStyle = C.surface;
    roundRect(ctx, x - 14, y - 14, size + 28, size + 28, r + 12);
    ctx.fill();
    ctx.restore();

    ctx.save();
    roundRect(ctx, x, y, size, size, r);
    ctx.clip();
    const photo = await loadImage(Card.safeImg(e.photo));
    if (photo) drawCover(ctx, photo, x, y, size, size);
    else {
      ctx.fillStyle = C.avatarBg;
      ctx.fillRect(x, y, size, size);
      ctx.fillStyle = C.avatarText;
      ctx.font = `600 96px ${FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(Card.initials(e.name), x + size / 2, y + size / 2 + 4);
    }
    ctx.restore();
  }

  function drawQr(ctx, text, x, y, size) {
    ctx.fillStyle = QR_LIGHT;
    roundRect(ctx, x, y, size, size, 40);
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = C.border;
    ctx.stroke();

    const qr = window.qrcode(0, "M");
    qr.addData(unescape(encodeURIComponent(text)), "Byte");
    qr.make();
    const n = qr.getModuleCount();
    const inner = size - 72;
    const m = Math.floor(inner / n);
    const qrSize = m * n;
    const ox = x + Math.round((size - qrSize) / 2);
    const oy = y + Math.round((size - qrSize) / 2);
    ctx.fillStyle = QR_DARK;
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) ctx.fillRect(ox + c * m, oy + r * m, m, m);
  }

  async function render(e, banner, url) {
    if (typeof window.qrcode !== "function") throw new Error("QR generator is not available.");
    await loadFonts();
    readTheme();
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    const accent = /^#[0-9a-f]{6}$/i.test(e.accent || "") ? e.accent : "#678b27";

    ctx.fillStyle = C.surface;
    ctx.fillRect(0, 0, W, H);

    const bannerH = 440;
    await drawBanner(ctx, banner, accent, bannerH);
    await drawLogoPill(ctx, e, accent);

    const photoSize = 260;
    const photoY = bannerH - photoSize / 2;
    await drawPhoto(ctx, e, PAD, photoY, photoSize);

    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = C.text;
    const name = fitText(ctx, e.name || "", W - PAD * 2, 68, 40, 700);
    ctx.fillText(name, PAD, photoY + photoSize + 96);

    // Same as the on-screen card: dark themes lift the accent toward the text colour for readability.
    ctx.fillStyle = document.documentElement.classList.contains("dark") ? mix(accent, C.text, 0.45) : accent;
    const role = fitText(ctx, e.designation || "", W - PAD * 2, 36, 24, 600);
    ctx.fillText(role, PAD, photoY + photoSize + 150);

    ctx.fillStyle = C.faint;
    if ("letterSpacing" in ctx) ctx.letterSpacing = "3px";
    const company = fitText(ctx, [e.department, e.company].filter(Boolean).join(" · ").toUpperCase(), W - PAD * 2, 26, 18, 500);
    ctx.fillText(company, PAD, photoY + photoSize + 196);
    if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";

    ctx.fillStyle = accent;
    roundRect(ctx, PAD, photoY + photoSize + 226, 72, 6, 3);
    ctx.fill();

    const qrSize = 560;
    const qrY = photoY + photoSize + 278;
    drawQr(ctx, url, (W - qrSize) / 2, qrY, qrSize);

    ctx.textAlign = "center";
    ctx.fillStyle = C.text;
    ctx.font = `600 32px ${FONT}`;
    ctx.fillText("Scan to view my digital card", W / 2, qrY + qrSize + 72);
    ctx.fillStyle = C.faint;
    const shortUrl = fitText(ctx, Card.prettyUrl(url), W - PAD * 2, 24, 16, 400, MONO);
    ctx.fillText(shortUrl, W / 2, qrY + qrSize + 116);

    return new Promise((resolve, reject) => {
      try {
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Couldn't create the card image."))), "image/png");
      } catch {
        reject(new Error("Couldn't create the card image."));
      }
    });
  }

  return { render, WIDTH: W, HEIGHT: H };
})();
