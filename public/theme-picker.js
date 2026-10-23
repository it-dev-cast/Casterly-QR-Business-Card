// Theme selector for the top bar. Reads the same registry as theme.js (window.NexusTheme),
// so there is no second list of themes. Mounts into any element with [data-theme-picker].
(() => {
  "use strict";
  const T = window.NexusTheme;
  if (!T) return;

  const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.8-.8 1.8-1.8 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3z"/><circle cx="7.5" cy="10.5" r="1.2"/><circle cx="10.5" cy="7" r="1.2"/><circle cx="15" cy="7.5" r="1.2"/></svg>';
  const MODES = [
    { id: "light", label: "Light" },
    { id: "dark", label: "Dark" },
    { id: "system", label: "System" },
  ];
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function mount(host) {
    host.classList.add("theme-picker");
    host.innerHTML = `
      <button type="button" class="btn btn-ghost btn-icon theme-trigger" aria-haspopup="dialog" aria-expanded="false" aria-label="Change theme" data-tooltip="Theme" data-tooltip-align="end">${ICON}</button>
      <div class="theme-menu" role="dialog" aria-label="Theme" hidden>
        <p class="text-eyebrow theme-menu-title">Appearance</p>
        <div class="segmented" role="radiogroup" aria-label="Mode">
          ${MODES.map((m) => `<button type="button" role="radio" data-mode="${m.id}">${m.label}</button>`).join("")}
        </div>
        <p class="text-eyebrow theme-menu-title">Theme</p>
        <div class="theme-list" role="radiogroup" aria-label="Theme">
          ${T.THEMES.map((t) => `
            <button type="button" role="radio" class="theme-option" data-theme-id="${esc(t.id)}">
              <span class="theme-swatch" aria-hidden="true">${t.swatch.map((c) => `<i style="background:${esc(c)}"></i>`).join("")}</span>
              <span class="theme-name">${esc(t.label)}</span>
              <span class="theme-family">${t.dark ? "Dark" : "Light"}</span>
              <svg class="theme-check" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>
            </button>`).join("")}
        </div>
      </div>`;

    const trigger = host.querySelector(".theme-trigger");
    const menu = host.querySelector(".theme-menu");
    const options = [...host.querySelectorAll(".theme-option")];

    function sync() {
      const current = T.current().id;
      const mode = T.mode();
      host.querySelectorAll("[data-mode]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.mode === mode)));
      options.forEach((b) => {
        const on = b.dataset.themeId === current;
        b.setAttribute("aria-checked", String(on));
        b.tabIndex = on ? 0 : -1;
      });
    }

    function open() {
      menu.hidden = false;
      trigger.setAttribute("aria-expanded", "true");
      sync();
      (options.find((b) => b.getAttribute("aria-checked") === "true") || options[0]).focus();
      document.addEventListener("pointerdown", onOutside, true);
    }
    function close(restoreFocus = true) {
      if (menu.hidden) return;
      menu.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
      document.removeEventListener("pointerdown", onOutside, true);
      if (restoreFocus) trigger.focus();
    }
    function onOutside(ev) { if (!host.contains(ev.target)) close(false); }

    trigger.addEventListener("click", () => (menu.hidden ? open() : close()));
    menu.addEventListener("click", (ev) => {
      const modeBtn = ev.target.closest("[data-mode]");
      if (modeBtn) { T.setMode(modeBtn.dataset.mode); return; }
      const opt = ev.target.closest(".theme-option");
      if (opt) T.setTheme(opt.dataset.themeId);
    });
    menu.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") { ev.stopPropagation(); close(); return; }
      const i = options.indexOf(document.activeElement);
      if (i < 0) return;
      if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
        ev.preventDefault();
        options[(i + (ev.key === "ArrowDown" ? 1 : options.length - 1)) % options.length].focus();
      }
    });
    T.onChange(sync);
    sync();
  }

  document.querySelectorAll("[data-theme-picker]").forEach(mount);
})();
