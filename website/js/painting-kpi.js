/**
 * painting-kpi.js
 * ---------------------------------------------------------
 * Renders the KPI strip straight from kpi_summary in the JSON bundle
 * - no arithmetic here beyond display formatting, matching the
 * "Python calculates, JS only displays" rule (see website/js/kpi.js).
 */

const PaintingKPI = {

  render(kpis) {
    if (!kpis) return;

    this.setText("kpi-rfp-done", this.formatNumber(kpis.total_rfp_done));

    this.setText("kpi-missing-plan", this.formatNumber(kpis.missing_from_plan_count));
    const missingPct = kpis.total_rfp_done
      ? ((kpis.missing_from_plan_count / kpis.total_rfp_done) * 100).toFixed(0)
      : "0";
    this.setText("kpi-missing-plan-pct", `${missingPct}% of RFP-done spools`);

    this.setText("kpi-pdi-cleared", this.formatNumber(kpis.pdi_cleared_count));
    this.setText("kpi-open", this.formatNumber(kpis.open_count));
    this.setText("kpi-stuck", this.formatNumber(kpis.stuck_long_open_count));

    this.setText("kpi-median-cycle", this.formatDays(kpis.median_total_cycle_days));
    this.setText("kpi-avg-cycle", this.formatDays(kpis.avg_total_cycle_days));
    this.setText(
      "kpi-within-ideal",
      kpis.pct_within_ideal === null || kpis.pct_within_ideal === undefined
        ? "—"
        : `${kpis.pct_within_ideal.toFixed(1)}%`,
    );
  },

  setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  },

  formatNumber(value) {
    if (value === null || value === undefined) return "—";
    return new Intl.NumberFormat("en-US").format(value);
  },

  formatDays(value) {
    if (value === null || value === undefined) return "—";
    return value.toFixed(1);
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
