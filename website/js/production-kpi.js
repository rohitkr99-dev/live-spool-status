/**
 * production-kpi.js
 * ---------------------------------------------------------
 * Renders the KPI strip straight from `kpis` in the JSON bundle -
 * no arithmetic here beyond display formatting (src/production/
 * summary.py -> build_kpis() does the counting).
 */

const ProductionKPI = {

  render(kpis) {
    if (!kpis) return;

    this.setText("kpi-total-spools", this.formatNumber(kpis.total_spools));
    this.setText("kpi-not-released", this.formatNumber(kpis.excluded_not_released));
    this.setText("kpi-with-start", this.formatNumber(kpis.spools_with_planned_start));
    this.setSiopSub(kpis);
    this.setText("kpi-missing-start", this.formatNumber(kpis.spools_missing_planned_start));
    this.setText("kpi-packed", this.formatNumber(kpis.completed_packed));
    this.setText("kpi-delayed", this.formatNumber(kpis.delayed));
    this.setText("kpi-welding-progress", this.formatNumber(kpis.welding_in_progress));
    this.setText("kpi-welding-not-started", this.formatNumber(kpis.welding_not_started));
  },

  setSiopSub(kpis) {
    const el = document.getElementById("kpi-with-start-sub");
    if (!el) return;
    const fromSiop = kpis.spools_planned_start_from_siop || 0;
    el.textContent = fromSiop > 0
      ? `ageing tracked (${this.formatNumber(fromSiop)} via SIOP fallback)`
      : "ageing tracked";
  },

  setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
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
