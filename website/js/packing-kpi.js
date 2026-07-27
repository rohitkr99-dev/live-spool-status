/**
 * packing-kpi.js
 * ---------------------------------------------------------
 * Renders the KPI strip straight from kpi_summary in the JSON bundle
 * - no arithmetic here beyond display formatting, matching the
 * "Python calculates, JS only displays" rule the Projects dashboard
 * follows (see website/js/kpi.js).
 */

const PackingKPI = {

  render(kpis) {
    if (!kpis) return;

    this.setText("kpi-total-spools", this.formatNumber(kpis.total_spools));
    this.setText("kpi-total-weight", this.formatWeight(kpis.total_weight_kg));
    this.setText("kpi-total-qty", this.formatNumber(kpis.total_qty_pieces));

    this.setText("kpi-pending", this.formatNumber(kpis.spools_pending));
    this.setText("kpi-packed", this.formatNumber(kpis.spools_packed));
    this.setText("kpi-dispatched", this.formatNumber(kpis.spools_dispatched));

    this.setText("kpi-total-boxes", this.formatNumber(kpis.total_boxes));
    this.setText("kpi-boxes-packed", this.formatNumber(kpis.boxes_packed));
    this.setText("kpi-boxes-dispatched", this.formatNumber(kpis.boxes_dispatched));

    this.setText("kpi-total-shipments", this.formatNumber(kpis.total_shipments));
    this.setText("kpi-avg-weight-box", this.formatWeight(kpis.avg_weight_per_box_kg));
    this.setText("kpi-avg-weight-shipment", this.formatWeight(kpis.avg_weight_per_shipment_kg));
    this.setText("kpi-weight-dispatched", this.formatWeight(kpis.weight_dispatched_kg));
  },

  setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  },

  formatNumber(value) {
    if (value === null || value === undefined) return "—";
    return new Intl.NumberFormat("en-US").format(value);
  },

  formatWeight(kg) {
    if (kg === null || kg === undefined) return "—";
    return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(kg)} kg`;
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
