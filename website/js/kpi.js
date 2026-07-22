/**
 * kpi.js
 * ---------------------------------------------------------
 * Renders the KPI strip. Every number comes directly from
 * dashboard_summary.json -> kpis. No arithmetic happens here beyond
 * formatting (rounding for display, adding a "+"/"-" sign) -
 * per Rule 2/3, the dashboard doesn't calculate.
 */

const SpoolKPI = {

  prefersReducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,

  render(dashboardSummary) {

    const kpis = dashboardSummary.kpis;

    this.setNumber("kpi-total", kpis.total_spools, (v) => this.formatNumber(v));
    this.setNumber("kpi-planned", kpis.planned, (v) => this.formatNumber(v));
    this.setNumber("kpi-unplanned", kpis.unplanned, (v) => this.formatNumber(v));
    this.setNumber("kpi-completed", kpis.completed, (v) => this.formatNumber(v));

    const completedPct = kpis.total_spools
      ? Math.round((kpis.completed / kpis.total_spools) * 100)
      : 0;
    this.setNumber("kpi-completed-pct", completedPct, (v) => `${Math.round(v)}% of total`);

    this.setNumber("kpi-avg-age", kpis.average_total_age_days, (v) => this.formatNumber(v));

    if (kpis.oldest_spool) {
      this.setNumber("kpi-oldest-age", kpis.oldest_spool.total_age, (v) => `${this.formatNumber(v)}d`);
      document.getElementById("kpi-oldest-key").textContent =
        `${kpis.oldest_spool.project_code} · ${kpis.oldest_spool.spool_no}`;
    } else {
      document.getElementById("kpi-oldest-age").textContent = "—";
      document.getElementById("kpi-oldest-key").textContent = "no data";
    }

    const varianceEl = document.getElementById("kpi-variance");
    if (kpis.planning_variance_days === null || kpis.planning_variance_days === undefined) {
      varianceEl.textContent = "n/a";
    } else {
      const value = kpis.planning_variance_days;
      const sign = value > 0 ? "+" : value < 0 ? "\u2212" : "";
      varianceEl.style.color = value > 0 ? "var(--status-critical)" : "var(--status-complete)";
      this.setNumber(
        "kpi-variance",
        Math.abs(value),
        (v) => `${sign}${this.formatNumber(v)}d`
      );
    }

    document.getElementById("footer-generated").textContent =
      `dashboard_summary.json generated ${this.formatTimestamp(dashboardSummary.generated_at)}`;
  },

  /**
   * Tweens an element's displayed text from 0 up to an already-final
   * value - pure presentation, the value itself never changes. Skips
   * straight to the final text under prefers-reduced-motion, or for
   * non-finite/zero values where a tween wouldn't read as motion
   * anyway.
   */
  setNumber(elementId, toValue, formatter) {
    const el = document.getElementById(elementId);
    if (!el) return;

    if (
      this.prefersReducedMotion ||
      typeof toValue !== "number" ||
      !Number.isFinite(toValue) ||
      toValue === 0
    ) {
      el.textContent = formatter(toValue ?? 0);
      return;
    }

    const duration = 900;
    const start = performance.now();
    const decimals = Number.isInteger(toValue) ? 0 : 1;
    const scale = 10 ** decimals;

    const step = (now) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      const rounded = Math.round(toValue * eased * scale) / scale;
      el.textContent = formatter(rounded);
      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        el.textContent = formatter(toValue);
      }
    };

    requestAnimationFrame(step);
  },

  formatNumber(value) {
    if (value === null || value === undefined) return "—";
    return new Intl.NumberFormat("en-US").format(value);
  },

  formatTimestamp(iso) {
    if (!iso) return "";
    try {
      const date = new Date(iso);
      return date.toLocaleString("en-US", {
        month: "short", day: "numeric", year: "numeric",
        hour: "2-digit", minute: "2-digit",
      });
    } catch (e) {
      return iso;
    }
  },
};
