// NEXUS One theme registry + persistence (single source of truth for named themes).
// Loaded synchronously in <head> so the saved theme applies before first paint.
// Applies data-theme on <html> and toggles .dark for dark-family themes.
(() => {
  "use strict";

  // swatch = [primary-600, background, accent-500]: only used to preview themes in the picker.
  const THEMES = [
    { id: "casterly-light", label: "Casterly Light", dark: false, swatch: ["#678b27", "#f9faf9", "#06b6d4"] },
    { id: "executive-white", label: "Executive White", dark: false, swatch: ["#3f3f46", "#fafafa", "#0ea5e9"] },
    { id: "ocean-blue", label: "Ocean Blue", dark: false, swatch: ["#2563eb", "#f8fafc", "#14b8a6"] },
    { id: "slate-professional", label: "Slate Professional", dark: false, swatch: ["#475569", "#f8fafc", "#0ea5e9"] },
    { id: "graphite-dark", label: "Graphite Dark", dark: true, swatch: ["#516d21", "#111412", "#22d3ee"] },
    { id: "midnight-blue", label: "Midnight Blue", dark: true, swatch: ["#4f46e5", "#0b1020", "#38bdf8"] },
    { id: "emerald", label: "Emerald", dark: false, swatch: ["#047857", "#f7fbf9", "#06b6d4"] },
    { id: "purple-enterprise", label: "Purple Enterprise", dark: false, swatch: ["#7c3aed", "#faf9fc", "#6366f1"] },
    { id: "casterly-erp-green", label: "Casterly ERP Green", dark: false, sidebarStyle: "light", swatch: ["#15803d", "#f8f9f8", "#84cc16"] },
  ];
  const DEFAULT_THEME = "casterly-light";
  const SYSTEM_LIGHT = "casterly-light";
  const SYSTEM_DARK = "graphite-dark";
  const THEME_KEY = "nexusone.theme";
  const MODE_KEY = "nexusone.theme.mode";
  const MODES = ["light", "dark", "system"];

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable: theme still applies for this visit */ } },
  };
  const byId = (id) => THEMES.find((t) => t.id === id);
  const media = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  const listeners = new Set();

  const getMode = () => (MODES.includes(store.get(MODE_KEY)) ? store.get(MODE_KEY) : "light");
  const getChosenTheme = () => (byId(store.get(THEME_KEY)) ? store.get(THEME_KEY) : DEFAULT_THEME);

  function resolveTheme() {
    if (getMode() === "system") return media && media.matches ? SYSTEM_DARK : SYSTEM_LIGHT;
    return getChosenTheme();
  }

  let switchTimer;
  function apply() {
    const theme = byId(resolveTheme());
    const root = document.documentElement;
    // Swap all colours at once instead of letting every element fade separately.
    root.classList.add("theme-switching");
    clearTimeout(switchTimer);
    switchTimer = setTimeout(() => root.classList.remove("theme-switching"), 50);
    root.dataset.theme = theme.id;
    root.classList.toggle("dark", theme.dark);
    root.style.colorScheme = theme.dark ? "dark" : "light";
    void root.offsetWidth; // compute the new colours now, while transitions are suppressed
    listeners.forEach((fn) => fn(theme, getMode()));
  }

  if (media) {
    const onSystemChange = () => { if (getMode() === "system") apply(); };
    if (media.addEventListener) media.addEventListener("change", onSystemChange);
    else if (media.addListener) media.addListener(onSystemChange);
  }

  window.NexusTheme = {
    THEMES,
    current: () => byId(resolveTheme()),
    mode: getMode,
    // Picking a named theme also sets the matching Light/Dark mode.
    setTheme(id) {
      const theme = byId(id);
      if (!theme) return;
      store.set(THEME_KEY, theme.id);
      store.set(MODE_KEY, theme.dark ? "dark" : "light");
      apply();
    },
    // Switching mode keeps the chosen theme when it already fits that mode.
    setMode(mode) {
      if (!MODES.includes(mode)) return;
      store.set(MODE_KEY, mode);
      const chosen = byId(getChosenTheme());
      if (mode === "light" && chosen.dark) store.set(THEME_KEY, DEFAULT_THEME);
      if (mode === "dark" && !chosen.dark) store.set(THEME_KEY, SYSTEM_DARK);
      apply();
    },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };

  apply();
})();
