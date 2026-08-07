/**
 * quality-kpi.js
 * ---------------------------------------------------------
 * Renders the KPI strip straight from `kpis` in the JSON bundle -
 * no arithmetic here beyond display formatting (src/quality/
 * summary.py -> build_kpis() does the counting).
 */

const QualityKPI = {

  render(kpis) {
    if (!kpis) return;

    this.setText("kpi-total-spools", this.formatNumber(kpis.total_spools));
    this.setText("kpi-total-events", this.formatNumber(kpis.total_offer_events));
    this.setText("kpi-rework-events", this.formatNumber(kpis.rework_events));
    this.setText("kpi-rework-rate", `${kpis.overall_rework_rate_pct}%`);
    this.setText("kpi-2plus", this.formatNumber(kpis.spools_needing_2plus_rework));
    this.setText("kpi-date-range", this.formatDateRange(kpis.date_range_start, kpis.date_range_end));
  },

  setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  },

  formatNumber(value) {
    if (value === null || value === undefined) return "—";
    return new Intl.NumberFormat("en-US").format(value);
  },

  formatDateRange(start, end) {
    if (!start || !end) return "—";
    const fmt = (iso) => {
      const d = new Date(iso);
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    };
    return `${fmt(start)} – ${fmt(end)}`;
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
