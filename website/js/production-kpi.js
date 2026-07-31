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
    this.setText("kpi-with-start", this.formatNumber(kpis.spools_with_planned_start));
    this.setText("kpi-missing-start", this.formatNumber(kpis.spools_missing_planned_start));
    this.setText("kpi-packed", this.formatNumber(kpis.completed_packed));
    this.setText("kpi-delayed", this.formatNumber(kpis.delayed));
    this.setText("kpi-welding-progress", this.formatNumber(kpis.welding_in_progress));
    this.setText("kpi-welding-not-started", this.formatNumber(kpis.welding_not_started));
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
