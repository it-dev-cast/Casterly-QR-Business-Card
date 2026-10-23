// Shared card rendering, used by the admin app (index.html) and the public card page (card.html).
(() => {
  "use strict";

  const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const initials = (name = "") => name.trim().split(/\s+/).slice(0, 2).map((p) => p[0] || "").join("").toUpperCase() || "?";
  const prettyUrl = (u = "") => u.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const safeUrl = (u = "") => (/^(https?:|mailto:|tel:)/i.test(u) ? u : u ? "https://" + u : "");
  const safeImg = (u = "") => (/^(https?:|data:image\/|\/media\/(assets|photos)\/)/i.test(u) ? u : "");

  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  // Banner presets: calm, light gradients.
  const BANNER_PRESETS = {
    mist:  { label: "Mist",  css: "linear-gradient(135deg, #e9eef4 0%, #d3dce7 100%)" },
    sand:  { label: "Sand",  css: "linear-gradient(135deg, #f3ede5 0%, #e0d3c3 100%)" },
    sage:  { label: "Sage",  css: "linear-gradient(135deg, #e7eee8 0%, #c9d8cc 100%)" },
    blush: { label: "Blush", css: "linear-gradient(135deg, #f5ebea 0%, #e3cfcd 100%)" },
    slate: { label: "Slate", css: "linear-gradient(135deg, #d9dee6 0%, #a9b4c3 100%)" },
    lilac: { label: "Lilac", css: "linear-gradient(135deg, #eeebf4 0%, #d3cde3 100%)" },
  };

  // banner: "" (default, derived from accent) | "preset:<key>" | image URL / data URL
  function bannerCSS(banner, accent) {
    if (banner && banner.startsWith("preset:")) {
      const p = BANNER_PRESETS[banner.slice(7)];
      if (p) return p.css;
    }
    const img = safeImg(banner);
    if (img) return `url("${img.replace(/"/g, "%22")}") center / cover no-repeat`;
    return `linear-gradient(135deg, color-mix(in srgb, ${accent} 18%, var(--color-theme-surface)) 0%, color-mix(in srgb, ${accent} 38%, var(--color-theme-surface)) 100%)`;
  }

  const ICONS = {
    mail: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
    phone: '<svg viewBox="0 0 24 24"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/></svg>',
    pin: '<svg viewBox="0 0 24 24"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/></svg>',
    globe: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/></svg>',
    eye: '<svg viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    edit: '<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
    trash: '<svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>',
    download: '<svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>',
    upload: '<svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>',
    userPlus: '<svg viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/></svg>',
    link: '<svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>',
    copy: '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    qr: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20v.01M17 20h4v-3"/></svg>',
    image: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>',
  };
  const SOCIAL_ICONS = {
    linkedin: '<svg viewBox="0 0 24 24"><path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.34V9h3.42v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.56V9h3.56v11.45z"/></svg>',
    github: '<svg viewBox="0 0 24 24"><path d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2.2c-3.3.7-4-1.4-4-1.4-.6-1.4-1.4-1.8-1.4-1.8-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17.3 4.7 18.3 5 18.3 5c.7 1.7.3 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .3"/></svg>',
    instagram: '<svg viewBox="0 0 24 24"><path d="M12 2.2c3.2 0 3.6 0 4.8.1 1.2.1 1.8.2 2.2.4.6.2 1 .5 1.4.9.4.4.7.8.9 1.4.2.4.4 1 .4 2.2.1 1.3.1 1.6.1 4.8s0 3.6-.1 4.8c-.1 1.2-.2 1.8-.4 2.2-.2.6-.5 1-.9 1.4-.4.4-.8.7-1.4.9-.4.2-1 .4-2.2.4-1.3.1-1.6.1-4.8.1s-3.6 0-4.8-.1c-1.2-.1-1.8-.2-2.2-.4-.6-.2-1-.5-1.4-.9-.4-.4-.7-.8-.9-1.4-.2-.4-.4-1-.4-2.2-.1-1.3-.1-1.6-.1-4.8s0-3.6.1-4.8c.1-1.2.2-1.8.4-2.2.2-.6.5-1 .9-1.4.4-.4.8-.7 1.4-.9.4-.2 1-.4 2.2-.4 1.2-.1 1.6-.1 4.8-.1zm0 4.9a4.9 4.9 0 1 0 0 9.8 4.9 4.9 0 0 0 0-9.8zm0 8.1a3.2 3.2 0 1 1 0-6.4 3.2 3.2 0 0 1 0 6.4zm5.1-9.4a1.1 1.1 0 1 0 0 2.3 1.1 1.1 0 0 0 0-2.3z"/></svg>',
    x: '<svg viewBox="0 0 24 24"><path d="M18.9 1.2h3.7l-8 9.2 9.4 12.4h-7.4l-5.8-7.6-6.6 7.6H.5l8.6-9.8L.1 1.2h7.6l5.2 6.9 6-6.9zm-1.3 19.4h2L6.5 3.2H4.3l13.3 17.4z"/></svg>',
  };
  const SOCIAL_LABELS = { linkedin: "LinkedIn", github: "GitHub", instagram: "Instagram", x: "X" };

  function avatarHTML(emp, cls = "avatar") {
    const img = safeImg(emp.photo);
    if (img) return `<div class="${cls}" data-initials="${esc(initials(emp.name))}"><img src="${esc(img)}" alt="${esc(emp.name)}"></div>`;
    return `<div class="${cls} is-initials">${esc(initials(emp.name))}</div>`;
  }

  // A photo that fails to load (e.g. missing in nexusAuth) falls back to the person's initials.
  document.addEventListener("error", (ev) => {
    const img = ev.target;
    const box = img && img.tagName === "IMG" ? img.parentElement : null;
    if (!box || !box.dataset.initials) return;
    box.classList.add("is-initials");
    box.textContent = box.dataset.initials;
  }, true);

  function logoHTML(emp) {
    const img = safeImg(emp.logo);
    const accent = esc(emp.accent || "#678b27");
    const inner = img
      ? `<img src="${esc(img)}" alt="">`
      : `<svg viewBox="0 0 24 24" style="width:72%;height:72%"><path fill="${accent}" d="M12 2 21 7v10l-9 5-9-5V7z"/><text x="12" y="15.5" text-anchor="middle" font-size="9" font-weight="700" fill="#fff" font-family="Poppins,sans-serif">${esc(initials(emp.company).slice(0, 1))}</text></svg>`;
    return `<div class="bc-logo"><span class="bc-logo-img">${inner}</span><span>${esc(emp.company || "")}</span></div>`;
  }

  // The digital card: a physical-style card sitting on a soft backdrop.
  function cardHTML(e, banner = "") {
    const accent = e.accent || "#678b27";
    const lines = [
      e.phone && { icon: "phone", text: e.phone, href: `tel:${e.phone.replace(/\s/g, "")}` },
      e.email && { icon: "mail", text: e.email, href: `mailto:${e.email}` },
      e.website && { icon: "globe", text: prettyUrl(e.website), href: safeUrl(e.website) },
      e.address && { icon: "pin", text: e.address, href: `https://maps.google.com/?q=${encodeURIComponent(e.address)}` },
    ].filter(Boolean);
    const socials = Object.keys(SOCIAL_ICONS).filter((k) => e[k]);
    return `
      <article class="bcard" style="--accent:${esc(accent)}">
        <div class="bc-sheet">
          <header class="bc-banner" style="background:${esc(bannerCSS(banner, accent))}">
            ${logoHTML(e)}
          </header>
          ${avatarHTML(e, "bc-photo")}
          <div class="bc-id">
            <h3 class="bc-name">${esc(e.name)}</h3>
            <p class="bc-role">${esc(e.designation)}</p>
            <p class="bc-company">${esc([e.department, e.company].filter(Boolean).join(" · "))}</p>
          </div>
          <div class="bc-rule"></div>
          <ul class="bc-lines">
            ${lines.map((l) => `<li><a href="${esc(l.href)}" target="_blank" rel="noopener">${ICONS[l.icon]}<span>${esc(l.text)}</span></a></li>`).join("")}
          </ul>
          <div class="bc-spacer"></div>
          <footer class="bc-foot">
            <div class="bc-socials">
              ${socials.map((k) => `<a class="bc-social" href="${esc(safeUrl(e[k]))}" target="_blank" rel="noopener" data-tooltip="${SOCIAL_LABELS[k]}" data-tooltip-pos="top" aria-label="${SOCIAL_LABELS[k]}">${SOCIAL_ICONS[k]}</a>`).join("")}
            </div>
            <button type="button" class="bc-save" data-save-contact>${ICONS.userPlus}<span>Save</span></button>
          </footer>
        </div>
      </article>`;
  }

  function vCard(emp) {
    const [first, ...rest] = (emp.name || "").split(" ");
    return [
      "BEGIN:VCARD", "VERSION:3.0",
      `N:${rest.join(" ")};${first};;;`, `FN:${emp.name}`,
      emp.company && `ORG:${emp.company}`, emp.designation && `TITLE:${emp.designation}`,
      emp.phone && `TEL;TYPE=CELL:${emp.phone}`, emp.email && `EMAIL:${emp.email}`,
      emp.website && `URL:${emp.website}`, emp.address && `ADR;TYPE=WORK:;;${emp.address};;;;`,
      ...Object.keys(SOCIAL_LABELS).filter((k) => emp[k]).map((k) => `X-SOCIALPROFILE;TYPE=${k}:${emp[k]}`),
      "END:VCARD",
    ].filter(Boolean).join("\n");
  }

  function downloadVCard(e) {
    const blob = new Blob([vCard(e)], { type: "text/vcard" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${(e.name || "contact").replace(/\s+/g, "_")}.vcf`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // Returns an SVG string. Uses a real QR encoder when available, otherwise a QR-style placeholder.
  function qrSVG(text, color = "#1f2430") {
    let n, isDark;
    if (typeof window.qrcode === "function") {
      try {
        const qr = window.qrcode(0, "M");
        qr.addData(unescape(encodeURIComponent(text)));
        qr.make();
        n = qr.getModuleCount();
        isDark = (r, c) => qr.isDark(r, c);
      } catch { n = 0; }
    }
    if (!n) {
      n = 29;
      let seed = hash(text);
      const rnd = () => ((seed = Math.imul(seed ^ (seed >>> 15), 2246822507) >>> 0) / 4294967296);
      const grid = Array.from({ length: n }, () => Array.from({ length: n }, () => rnd() > 0.52));
      const finder = (r0, c0) => {
        for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) {
          const rr = r0 + r, cc = c0 + c;
          if (rr < 0 || cc < 0 || rr >= n || cc >= n) continue;
          const ring = Math.max(Math.abs(r - 3), Math.abs(c - 3));
          grid[rr][cc] = ring !== 2 && ring !== 4;
        }
      };
      finder(0, 0); finder(0, n - 7); finder(n - 7, 0);
      isDark = (r, c) => grid[r][c];
    }
    let path = "";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (isDark(r, c)) path += `M${c} ${r}h1v1h-1z`;
    return `<svg viewBox="-2 -2 ${n + 4} ${n + 4}" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg"><rect x="-2" y="-2" width="${n + 4}" height="${n + 4}" fill="#fff"/><path d="${path}" fill="${color}"/></svg>`;
  }

  window.Card = {
    esc, initials, prettyUrl, safeUrl, safeImg, avatarHTML, cardHTML, vCard, downloadVCard,
    qrSVG, bannerCSS, BANNER_PRESETS, ICONS, SOCIAL_LABELS,
  };
})();
