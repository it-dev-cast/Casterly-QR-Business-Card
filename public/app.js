(() => {
  "use strict";

  const { esc, safeUrl, prettyUrl, avatarHTML, cardHTML, bannerCSS, BANNER_PRESETS, ICONS } = window.Card;
  const $ = (sel, root = document) => root.querySelector(sel);

  // Employee details come from nexusAuth (Nexus core) through the server; CardDesk only reads them.
  const state = {
    user: null,
    employees: [],
    total: 0,
    sync: { lastSyncedAt: null, lastError: null },
    settings: { banner: "", logo: "", website: "", accent: "#678b27", publicUrl: "", cardBaseUrl: location.origin, lanUrls: [] },
    selectedId: null,
    query: "",
  };

  // ---------------- helpers ----------------
  const isLocalHost = () => /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/.test(location.hostname);
  const cardUrl = (e) => `${state.settings.cardBaseUrl.replace(/\/+$/, "")}/c/${e.slug}`;
  const selected = () => state.employees.find((e) => e.id === state.selectedId) || null;

  let toastTimer;
  function toast(msg, isError = false) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.toggle("error", isError);
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), isError ? 4000 : 2400);
  }
  const toastError = (err) => toast(err && err.message ? err.message : "Something went wrong", true);

  // Disables a button while an async action runs.
  async function busy(btn, fn) {
    if (btn) btn.disabled = true;
    try { return await fn(); } finally { if (btn) btn.disabled = false; }
  }

  function download(url) {
    const a = document.createElement("a");
    a.href = url;
    a.download = "";
    document.body.appendChild(a); a.click(); a.remove();
  }

  function compressImage(file, maxW, quality, keepPng = false) {
    return new Promise((resolve, reject) => {
      if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) { reject(new Error("Please choose a PNG, JPG, WEBP or GIF image.")); return; }
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const scale = Math.min(1, maxW / img.width);
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(img.width * scale));
        c.height = Math.max(1, Math.round(img.height * scale));
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        // Logos keep transparency (PNG); photos and banners become JPEG.
        const type = keepPng && file.type === "image/png" ? "image/png" : "image/jpeg";
        c.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Couldn't process that image."))), type, quality);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Couldn't read that image.")); };
      img.src = url;
    });
  }

  async function uploadImage(file, maxW, keepPng = false) {
    const blob = await compressImage(file, maxW, 0.85, keepPng);
    const { url } = await Api.upload(blob);
    return url;
  }

  function timeAgo(iso) {
    if (!iso) return "";
    const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  // ---------------- data ----------------
  function applyList(list) {
    state.employees = list.employees;
    state.total = list.total;
    state.sync = { lastSyncedAt: list.lastSyncedAt, lastError: list.lastError };
    if (!state.employees.some((e) => e.id === state.selectedId)) state.selectedId = state.employees[0] ? state.employees[0].id : null;
  }

  async function loadAll() {
    const [list, settings] = await Promise.all([Api.listEmployees(), Api.getSettings()]);
    applyList(list);
    state.settings = settings;
  }

  // ---------------- rendering ----------------
  function filteredEmployees() {
    const q = state.query.trim().toLowerCase();
    if (!q) return state.employees;
    return state.employees.filter((e) =>
      [e.name, e.designation, e.department, e.company, e.email, e.phone, e.employeeCode].some((v) => (v || "").toLowerCase().includes(q))
    );
  }

  function renderSyncStatus() {
    const el = $("#syncStatus");
    if (!el) return;
    const { lastSyncedAt, lastError } = state.sync;
    el.classList.toggle("is-error", !!lastError);
    el.textContent = lastError
      ? `Can't reach nexusAuth right now; showing details from ${timeAgo(lastSyncedAt) || "earlier"}.`
      : lastSyncedAt ? `Synced ${timeAgo(lastSyncedAt)}.` : "";
  }

  function renderList() {
    const list = $("#employeeList");
    const items = filteredEmployees();
    $("#empCount").textContent = state.employees.length;
    if (!items.length) {
      list.innerHTML = `<li class="empty">${state.employees.length ? "No employees match your search." : "No employees in nexusAuth yet. Add them there and they appear here."}</li>`;
      return;
    }
    list.innerHTML = items.map((e, i) => `
      <li class="emp-item ${e.id === state.selectedId ? "active" : ""}" data-id="${esc(e.id)}" tabindex="0" style="animation-delay:${Math.min(i, 12) * 25}ms">
        ${avatarHTML(e)}
        <div class="meta"><strong>${esc(e.name)}</strong><span>${esc(e.designation || "No designation")} · ${esc(e.company)}</span></div>
      </li>`).join("");
  }

  function renderDetails() {
    const panel = $("#detailsPanel");
    const e = selected();
    if (!e) {
      panel.innerHTML = `<div class="placeholder"><div><h2>No employee selected</h2><p>${state.employees.length ? "Pick someone from the list to see their details and card." : "Employees added in nexusAuth appear here automatically."}</p></div></div>`;
      return;
    }
    const link = (url) => (url ? `<a href="${esc(safeUrl(url))}" target="_blank" rel="noopener">${esc(prettyUrl(url))}</a>` : "—");
    panel.innerHTML = `
      <div class="details-inner">
        <div class="details-hero">
          ${avatarHTML(e)}
          <div><h2>${esc(e.name)} <span class="badge badge-success" tabindex="0" data-tooltip="Public card and QR code are active">Card live</span></h2><p>${esc(e.designation || "No designation")} at ${esc(e.company)}</p></div>
        </div>
        <div class="details-actions">
          <button class="btn btn-primary" data-action="qrcode">${ICONS.qr} QR code</button>
          <button class="btn btn-ghost" data-action="view">${ICONS.eye} View card</button>
          <button class="btn btn-ghost" data-action="download">${ICONS.download} vCard</button>
        </div>
        <p class="managed-note">Details are managed in nexusAuth. To change them, edit this employee in nexusAuth; the card updates automatically.</p>

        <h3 class="text-eyebrow section-title">Contact details</h3>
        <div class="details-grid">
          <div class="detail"><label>Email</label><div>${e.email ? `<a href="mailto:${esc(e.email)}">${esc(e.email)}</a>` : "—"}</div></div>
          <div class="detail"><label>Phone</label><div>${e.phone ? `<a href="tel:${esc(e.phone.replace(/\s/g, ""))}">${esc(e.phone)}</a>` : "—"}</div></div>
          <div class="detail wide"><label>Address</label><div>${esc(e.address) || "—"}</div></div>
          <div class="detail"><label>Department</label><div>${esc(e.department) || "—"}</div></div>
          <div class="detail"><label>Company</label><div>${esc(e.company) || "—"}</div></div>
          <div class="detail"><label>Employee ID</label><div>${esc(e.employeeCode) || "—"}</div></div>
          <div class="detail"><label>LinkedIn</label><div>${link(e.linkedin)}</div></div>
          <div class="detail"><label>Website</label><div>${link(e.website)}</div></div>
          <div class="detail wide"><label>Card link</label><div><a class="text-mono-id" href="${esc(cardUrl(e))}" target="_blank" rel="noopener">${esc(prettyUrl(cardUrl(e)))}</a></div></div>
        </div>
      </div>`;
  }

  function renderCard() {
    const e = selected();
    $("#cardMount").innerHTML = e ? cardHTML(e, state.settings.banner) : `<div class="placeholder">Select an employee to preview their card</div>`;
  }

  function renderAll() { renderSyncStatus(); renderList(); renderDetails(); renderCard(); }

  function select(id) {
    if (state.selectedId === id) return;
    state.selectedId = id;
    renderList(); renderDetails(); renderCard();
    if (window.matchMedia("(max-width: 760px)").matches) $("#detailsPanel").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function syncNow(btn) {
    await busy(btn, async () => {
      try {
        applyList(await Api.listEmployees({ refresh: true }));
        renderAll();
        toast(`${state.employees.length} employees synced from nexusAuth`);
      } catch (err) { toastError(err); }
    });
  }

  // ---------------- modals ----------------
  function openModal(html, size = "") {
    const dlg = $("#modalDialog");
    dlg.className = "modal-dialog surface" + (size ? " " + size : "");
    dlg.onclick = null;
    dlg.innerHTML = html;
    $("#modal").hidden = false;
    const first = dlg.querySelector("input:not([type=file]):not([type=color]), button:not([data-close])");
    if (first) first.focus();
  }
  function closeModal() { $("#modal").hidden = true; $("#modalDialog").innerHTML = ""; }

  function openViewModal(e) {
    openModal(`
      <h3>${esc(e.name)}'s card</h3>
      <p class="sub">This is what people see after scanning the QR code.</p>
      <div class="view-card-stage">
        <div class="phone phone-modal"><div class="phone-notch"></div><div class="phone-screen">${cardHTML(e, state.settings.banner)}</div></div>
      </div>
      <div class="modal-actions"><button class="btn" data-close>Close</button></div>`, "small");
  }

  // ---- QR code modal: previews the shareable card image (details + QR) that "Download card" saves ----
  let cardImageUrl = null;
  let cardRenderId = 0;

  function cardImageName(e) {
    return `${(e.name || "card").replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "") || "card"}_business_card.png`;
  }

  function openQRModal(e) {
    const url = cardUrl(e);
    const mode = state.settings.publicUrlMode || (state.settings.publicUrl ? "custom" : "site");
    const usingLocal = isLocalHost() && mode === "site";
    const lan = state.settings.lanUrls || [];
    openModal(`
      <div class="qr-modal">
        <h3>${esc(e.name)}</h3>
        <p class="sub">Download this card to print or share. Scanning its QR opens ${esc(e.name.split(" ")[0])}'s digital business card.</p>
        <div class="qr-card-frame" id="qrCardFrame" aria-busy="true">
          <span class="spinner" aria-hidden="true"></span><span class="sr-only">Preparing card…</span>
        </div>
        <p class="qr-url"><a href="${esc(url)}" target="_blank" rel="noopener">${esc(prettyUrl(url))}</a></p>
        <div class="qr-actions">
          <button class="btn btn-sm btn-primary" data-qr="download" id="qrDownload" disabled>${ICONS.download} Download card</button>
          <button class="btn btn-sm" data-qr="copy">${ICONS.copy} Copy link</button>
          <a class="btn btn-sm" href="${esc(url)}" target="_blank" rel="noopener">${ICONS.link} Open card</a>
        </div>
        ${usingLocal ? `<div class="notice">
          Phones can't open <strong>${esc(location.host)}</strong>.
          ${lan.length ? `To test on a phone connected to the same Wi-Fi, use this computer's network address. It updates automatically if the address changes.
            <div class="row lan-row"><button class="btn btn-sm" data-qr="use-url" data-url="lan">Use this computer's network address (${esc(prettyUrl(lan[0]))})</button></div>
            For everyone else, enter the address where CardDesk is hosted:` : "Enter the address where CardDesk is hosted so the QR works when scanned:"}
          <div class="row"><input id="publicUrlInput" type="url" placeholder="https://cards.yourcompany.com"><button class="btn btn-sm" data-qr="public-url">Save</button></div>
        </div>` : mode === "lan" ? `<p class="sub qr-public-url">QR links use this computer's network address <strong>${esc(prettyUrl(state.settings.cardBaseUrl))}</strong> (phones on the same Wi-Fi). It follows address changes, but printed QR codes stop working if it changes. Host CardDesk at a fixed address for permanent cards. · <a href="#" data-qr="clear-url">change</a></p>`
          : mode === "custom" ? `<p class="sub qr-public-url">QR links point to <strong>${esc(prettyUrl(state.settings.publicUrl))}</strong> · <a href="#" data-qr="clear-url">change</a></p>` : ""}
        <div class="modal-actions is-centered"><button class="btn btn-ghost" data-close>Close</button></div>
      </div>`, "small");

    renderCardImage(e, url);

    Api.getSettings().then((fresh) => {
      if (fresh.cardBaseUrl === state.settings.cardBaseUrl && fresh.publicUrlMode === state.settings.publicUrlMode) return;
      state.settings = fresh;
      renderDetails();
      if (!$("#modal").hidden && $(".qr-modal")) openQRModal(e);
    }).catch(() => { /* keep showing the last known address */ });

    const savePublicUrl = async (btn, value) => {
      await busy(btn, async () => {
        try {
          state.settings = await Api.updateSettings({ publicUrl: value });
          renderDetails();
          openQRModal(e);
          toast(value === "lan" ? `QR codes now use this computer's network address (${prettyUrl(state.settings.cardBaseUrl)})`
            : value ? `QR codes now point to ${prettyUrl(value)}` : "QR codes use this site's address");
        } catch (err) { toastError(err); }
      });
    };

    $("#modalDialog").onclick = async (ev) => {
      const btn = ev.target.closest("[data-qr]");
      if (!btn) return;
      const action = btn.dataset.qr;
      if (action === "download" && cardImageUrl) {
        const a = document.createElement("a");
        a.href = cardImageUrl;
        a.download = cardImageName(e);
        document.body.appendChild(a); a.click(); a.remove();
        toast("Card downloaded");
      }
      if (action === "copy") copyText(url);
      if (action === "use-url") savePublicUrl(btn, btn.dataset.url);
      if (action === "public-url") {
        const v = $("#publicUrlInput").value.trim();
        if (!/^https?:\/\/\S+$/i.test(v)) { toast("Enter a full address, e.g. https://cards.yourcompany.com", true); return; }
        savePublicUrl(btn, v);
      }
      if (action === "clear-url") { ev.preventDefault(); savePublicUrl(null, ""); }
    };
  }

  async function renderCardImage(e, url) {
    const id = ++cardRenderId;
    if (cardImageUrl) { URL.revokeObjectURL(cardImageUrl); cardImageUrl = null; }
    try {
      const blob = await CardImage.render(e, state.settings.banner, url);
      if (id !== cardRenderId) return; // a newer render replaced this one
      cardImageUrl = URL.createObjectURL(blob);
      const frame = $("#qrCardFrame");
      if (!frame) return;
      frame.removeAttribute("aria-busy");
      frame.innerHTML = `<img src="${cardImageUrl}" width="${CardImage.WIDTH}" height="${CardImage.HEIGHT}" alt="Business card for ${esc(e.name)} with QR code">`;
      const dl = $("#qrDownload");
      if (dl) dl.disabled = false;
    } catch (err) {
      if (id !== cardRenderId) return;
      const frame = $("#qrCardFrame");
      if (frame) {
        frame.removeAttribute("aria-busy");
        frame.innerHTML = `<p class="card-image-error">${esc(err.message || "Couldn't create the card image.")}</p>`;
      }
    }
  }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); toast("Card link copied"); }
    catch { window.prompt("Copy this card link:", text); }
  }

  // ---- Card branding: banner, logo, website and colour, the same on every employee's card ----
  async function saveSettings(values, errorEl) {
    try {
      state.settings = await Api.updateSettings(values);
    } catch (err) {
      if (errorEl) errorEl.textContent = err.message; else toastError(err);
      return false;
    }
    // Branding is part of every card: reload the cards so they pick it up.
    try { applyList(await Api.listEmployees()); } catch { /* cards refresh on the next load */ }
    renderAll();
    return true;
  }

  function openBrandingModal() {
    const s = state.settings;
    const cur = s.banner || "";
    const isCustom = cur && !cur.startsWith("preset:");
    const tile = (value, label, css) =>
      `<button type="button" class="banner-opt ${cur === value ? "selected" : ""}" data-banner="${esc(value)}" style="background:${esc(css)}"><span class="tag">${esc(label)}</span></button>`;

    openModal(`
      <h3>Card branding</h3>
      <p class="sub">Applied to <strong>all ${state.employees.length} employee cards</strong> instantly, including cards opened from a QR code. Employee details themselves come from nexusAuth.</p>

      <h4 class="form-section">Banner</h4>
      <div class="banner-grid">
        ${tile("", "Default", bannerCSS("", s.accent || "#678b27"))}
        ${Object.entries(BANNER_PRESETS).map(([k, p]) => tile("preset:" + k, p.label, p.css)).join("")}
        ${isCustom ? tile(cur, "Your banner", bannerCSS(cur)) : ""}
        <label class="banner-opt upload" id="bannerUploadTile">
          <span>${ICONS.upload}Upload image</span>
          <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" id="bannerFile">
        </label>
      </div>
      <div class="field banner-url-field">
        <span>Or use an image URL</span>
        <div class="upload-row">
          <input type="text" id="bannerUrl" placeholder="https://…/banner.jpg" value="${isCustom && /^https?:/.test(cur) ? esc(cur) : ""}">
          <button type="button" class="btn" id="bannerUrlApply">Apply</button>
        </div>
      </div>
      <p class="form-error" id="bannerError"></p>

      <h4 class="form-section">Company logo, website and colour</h4>
      <div class="branding-row">
        <div class="branding-logo" id="logoPreview">${s.logo ? `<img src="${esc(s.logo)}" alt="Company logo">` : `<span class="text-muted">No logo</span>`}</div>
        <div class="upload-row">
          <label class="btn">${ICONS.upload} Upload logo<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" id="logoFile" hidden></label>
          ${s.logo ? `<button type="button" class="btn btn-ghost" id="logoRemove">Remove</button>` : ""}
        </div>
      </div>
      <form id="brandForm" class="form-grid" novalidate>
        <label class="field"><span>Website</span><input name="website" type="text" inputmode="url" placeholder="casterly.com" value="${esc(s.website)}"></label>
        <label class="field"><span>Accent colour</span><input name="accent" type="color" value="${esc(s.accent || "#678b27")}"></label>
        <p class="form-error full" id="brandError"></p>
        <div class="modal-actions full">
          <button type="button" class="btn btn-ghost" data-close>Close</button>
          <button type="submit" class="btn btn-primary" id="brandSave">Save website and colour</button>
        </div>
      </form>`);

    $("#modalDialog").onclick = async (ev) => {
      const opt = ev.target.closest("[data-banner]");
      if (opt && await saveSettings({ banner: opt.dataset.banner }, $("#bannerError"))) {
        markBanner();
        toast(`Banner applied to all ${state.employees.length} cards`);
      }
    };
    const markBanner = () => {
      const v = state.settings.banner;
      const opts = [...document.querySelectorAll("#modalDialog [data-banner]")];
      if (opts.some((o) => o.dataset.banner === v)) opts.forEach((o) => o.classList.toggle("selected", o.dataset.banner === v));
      else openBrandingModal();
      const err = $("#bannerError"); if (err) err.textContent = "";
    };
    $("#bannerUrlApply").addEventListener("click", (ev) => {
      const v = $("#bannerUrl").value.trim();
      if (!/^https?:\/\/\S+$/i.test(v)) { $("#bannerError").textContent = "Enter a full image URL starting with http(s)://"; return; }
      busy(ev.currentTarget, async () => { if (await saveSettings({ banner: v }, $("#bannerError"))) { markBanner(); toast("Banner applied"); } });
    });
    $("#bannerFile").addEventListener("change", async (ev) => {
      const file = ev.target.files[0];
      if (!file) return;
      const tileEl = $("#bannerUploadTile");
      tileEl.classList.add("loading");
      try {
        if (await saveSettings({ banner: await uploadImage(file, 1600) }, $("#bannerError"))) { markBanner(); toast("Banner applied"); }
      } catch (err) { const el = $("#bannerError"); if (el) el.textContent = err.message; }
      finally { if (tileEl.isConnected) tileEl.classList.remove("loading"); }
    });
    $("#logoFile").addEventListener("change", async (ev) => {
      const file = ev.target.files[0];
      if (!file) return;
      try {
        if (await saveSettings({ logo: await uploadImage(file, 400, true) }, $("#brandError"))) { openBrandingModal(); toast("Logo applied to all cards"); }
      } catch (err) { $("#brandError").textContent = err.message; }
    });
    const removeBtn = $("#logoRemove");
    if (removeBtn) removeBtn.addEventListener("click", async () => {
      if (await saveSettings({ logo: "" }, $("#brandError"))) { openBrandingModal(); toast("Logo removed"); }
    });
    $("#brandForm").addEventListener("submit", (ev) => {
      ev.preventDefault();
      const f = ev.currentTarget.elements;
      busy($("#brandSave"), async () => {
        if (await saveSettings({ website: f.website.value.trim(), accent: f.accent.value }, $("#brandError"))) {
          $("#brandError").textContent = "";
          toast("Website and colour applied to all cards");
        }
      });
    });
  }

  // ---------------- auth ----------------
  function showView(name) {
    $("#bootView").hidden = name !== "boot";
    $("#loginView").hidden = name !== "login";
    $("#appView").hidden = name !== "app";
  }

  async function showApp() {
    try {
      await loadAll();
    } catch (err) {
      if (err.status === 401) return showLogin();
      // nexusAuth unreachable on the very first load: say so instead of an empty list.
      showView("app");
      $("#userEmail").textContent = state.user ? state.user.email : "";
      renderAll();
      $("#employeeList").innerHTML = `<li class="empty">${esc(err.message)}</li>`;
      return;
    }
    $("#userEmail").textContent = state.user ? state.user.email : "";
    showView("app");
    renderAll();
  }

  function showLogin(message = "") {
    state.user = null;
    closeModal();
    showView("login");
    $("#loginForm").reset();
    $("#loginError").textContent = message;
  }

  $("#loginForm").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const email = $("#loginEmail").value.trim();
    const pw = $("#loginPassword").value;
    $("#loginError").textContent = "";
    if (!email || !pw) { $("#loginError").textContent = "Enter your email and password."; return; }
    busy($("#loginBtn"), async () => {
      try {
        const { user } = await Api.login(email, pw);
        state.user = user;
        await showApp();
      } catch (err) {
        $("#loginError").textContent = err.message;
        const card = $("#loginForm");
        card.classList.remove("shake"); void card.offsetWidth; card.classList.add("shake");
      }
    });
  });

  $("#logoutBtn").addEventListener("click", async () => {
    try { await Api.logout(); } catch { /* sign out locally regardless */ }
    showLogin();
  });

  Api.setUnauthorizedHandler(() => {
    if (!$("#appView").hidden) showLogin("Your session has ended. Please sign in again.");
  });

  // ---------------- events ----------------
  $("#employeeList").addEventListener("click", (ev) => {
    const li = ev.target.closest(".emp-item");
    if (li) select(li.dataset.id);
  });
  $("#employeeList").addEventListener("keydown", (ev) => {
    const li = ev.target.closest(".emp-item");
    if (!li) return;
    if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); select(li.dataset.id); }
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      const sib = ev.key === "ArrowDown" ? li.nextElementSibling : li.previousElementSibling;
      if (sib && sib.dataset.id) { select(sib.dataset.id); $(`.emp-item[data-id="${sib.dataset.id}"]`).focus(); }
    }
  });
  $("#searchInput").addEventListener("input", (ev) => { state.query = ev.target.value; renderList(); });

  $("#detailsPanel").addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-action]");
    const e = selected();
    if (!btn || !e) return;
    const actions = {
      qrcode: openQRModal, view: openViewModal,
      download: (emp) => download(Api.employeeVCardUrl(emp.id)),
    };
    if (actions[btn.dataset.action]) actions[btn.dataset.action](e);
  });

  // "Save" button on the preview card
  document.addEventListener("click", (ev) => {
    if (ev.target.closest("#appView [data-save-contact], #modal [data-save-contact]") && selected()) download(Api.employeeVCardUrl(selected().id));
  });

  $("#bannerBtn").addEventListener("click", openBrandingModal);
  $("#syncBtn").addEventListener("click", (ev) => syncNow(ev.currentTarget));

  $("#modal").addEventListener("click", (ev) => { if (ev.target.closest("[data-close]")) closeModal(); });
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && !$("#modal").hidden) closeModal(); });

  // Keep the list fresh while the page is open (the server caches nexusAuth for ~30 seconds).
  setInterval(async () => {
    if ($("#appView").hidden || !$("#modal").hidden || document.hidden) return;
    try { applyList(await Api.listEmployees()); renderAll(); } catch { renderSyncStatus(); }
  }, 60000);

  // ---------------- boot ----------------
  (async () => {
    try {
      const { user } = await Api.me();
      if (!user) { showLogin(); return; }
      state.user = user;
      await showApp();
    } catch (err) {
      showLogin(err.status !== 401 ? err.message : "");
    }
  })();
})();
