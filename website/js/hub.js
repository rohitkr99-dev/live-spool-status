// DEE Piping Systems — internal operations hub.
// Vanilla JS, no build step, no external dependencies.

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const body = document.body;

/* ---------------------------------------------------------
   Loader — counts 000 → 100, then reveals the page.
   Only present on the homepage (index.html).
--------------------------------------------------------- */
function initLoader() {
  const loader = document.getElementById("loader");
  if (!loader) return;

  const countEl = document.getElementById("loader-count");
  const barFill = document.getElementById("loader-bar-fill");
  const duration = reducedMotion ? 150 : 900;
  const start = performance.now();

  function tick(now) {
    const progress = Math.min(1, (now - start) / duration);
    const pct = Math.round(progress * 100);
    countEl.textContent = String(pct).padStart(3, "0");
    barFill.style.width = pct + "%";
    if (progress < 1) {
      requestAnimationFrame(tick);
    } else {
      finish();
    }
  }

  function finish() {
    loader.setAttribute("data-done", "true");
    body.setAttribute("data-loading", "false");
    body.style.overflow = "";
    body.style.height = "";
    window.setTimeout(() => loader.remove(), 600);
  }

  requestAnimationFrame(tick);
}

/* ---------------------------------------------------------
   Coming-soon pages have no loader — just fade in.
--------------------------------------------------------- */
function initComingSoon() {
  if (!document.querySelector(".coming-soon")) return;
  requestAnimationFrame(() => body.classList.add("is-ready"));
}

/* ---------------------------------------------------------
   Footer year
--------------------------------------------------------- */
function initFooterYear() {
  const el = document.getElementById("footer-year");
  if (el) el.textContent = "© " + new Date().getFullYear();
}

initLoader();
initComingSoon();
initFooterYear();
