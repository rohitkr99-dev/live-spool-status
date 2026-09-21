/*
 * theme.js
 * ---------------------------------------------------------
 * Three-way Light / Dark / System theme toggle. "System" (the
 * default) follows the OS/browser's prefers-color-scheme, exactly
 * as before this file existed - see css/styles.css's
 * @media (prefers-color-scheme: dark) block. Light/Dark override it
 * explicitly via a `data-theme` attribute on <html>, which styles.css
 * also has rules for.
 *
 * Deliberately PER-PAGE, not one site-wide setting: the storage key
 * is the page's own path, so choosing Dark on the Quality dashboard
 * has no effect on Production or the hub. Each page keeps its own
 * choice in localStorage (per browser, like the session-activity
 * timestamp in auth-guard.js - there's no server-side account
 * storage in this app to put a shared preference in).
 *
 * Two parts, both in this one file:
 *   1. Applied synchronously, the instant this script runs (top of
 *      <head>, before css/styles.css and before <body> paints) - so
 *      a page saved as Dark never flashes Light first. Mirrors the
 *      "hidden until ready" trick auth-guard.js already uses for the
 *      login redirect.
 *   2. The visible toggle widget, mounted into
 *      <div class="theme-toggle" id="theme-toggle"></div> on
 *      DOMContentLoaded - same mount-point pattern as user-menu.js.
 */
(function () {

  const KEY = "theme:" + location.pathname;

  function stored() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }

  function apply(theme) {
    const html = document.documentElement;
    if (theme === "dark" || theme === "light") {
      html.setAttribute("data-theme", theme);
    } else {
      html.removeAttribute("data-theme");
    }
  }

  function setTheme(theme) {
    const previous = stored() === "dark" || stored() === "light" ? stored() : "system";
    if (theme === previous) return;

    try {
      if (theme === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, theme);
    } catch (e) {
      // Storage blocked (private mode, etc.) - still apply it for
      // this page view, it just won't persist across reloads.
    }
    apply(theme);

    // Every chart on this page (Chart.js) reads its colours once at
    // load time (see js/chartTheme.js) - there's no live re-theme
    // path across the 5 different chart files without a lot of
    // per-chart plumbing. A reload is the simple way to guarantee
    // charts and the rest of the UI end up in sync, at the cost of a
    // brief flash - acceptable for a rare, deliberate action like
    // this, not something that happens on every page visit.
    location.reload();
  }

  // ---- Part 1: apply immediately, before first paint -------------
  const initial = stored() === "dark" || stored() === "light" ? stored() : "system";
  apply(initial);

  window.Theme = { get: () => (stored() === "dark" || stored() === "light" ? stored() : "system"), set: setTheme };

  // ---- Part 2: build the visible widget ---------------------------
  const ICONS = {
    light: '<svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true"><circle cx="10" cy="10" r="4" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10 2v2M10 16v2M18 10h-2M4 10H2M15.5 4.5l-1.4 1.4M5.9 14.1l-1.4 1.4M15.5 15.5l-1.4-1.4M5.9 5.9 4.5 4.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    dark: '<svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true"><path d="M17 12.1A7 7 0 0 1 7.9 3 7 7 0 1 0 17 12.1Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
    system: '<svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true"><rect x="2.5" y="4" width="15" height="10" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M7 17h6M10 14v3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  };
  const LABELS = { light: "Light", dark: "Dark", system: "System" };

  function buildWidget(mount) {
    mount.classList.add("theme-toggle");
    mount.setAttribute("role", "group");
    mount.setAttribute("aria-label", "Theme");

    mount.innerHTML = ["light", "dark", "system"].map((mode) => (
      '<button type="button" class="theme-toggle__btn" data-theme-option="' + mode + '" title="' + LABELS[mode] + '" aria-pressed="false">'
      + ICONS[mode]
      + "</button>"
    )).join("");

    const buttons = mount.querySelectorAll(".theme-toggle__btn");

    function sync() {
      const current = window.Theme.get();
      buttons.forEach((btn) => {
        const isActive = btn.dataset.themeOption === current;
        btn.classList.toggle("is-active", isActive);
        btn.setAttribute("aria-pressed", String(isActive));
      });
    }

    buttons.forEach((btn) => {
      btn.addEventListener("click", () => {
        window.Theme.set(btn.dataset.themeOption);
        sync();
      });
    });

    sync();
  }

  document.addEventListener("DOMContentLoaded", function () {
    const mount = document.getElementById("theme-toggle");
    if (mount) buildWidget(mount);
  });

})();
