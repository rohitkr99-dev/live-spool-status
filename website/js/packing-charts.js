/**
 * packing-charts.js
 * ---------------------------------------------------------
 * Builds every Chart.js chart on the page directly from
 * already-computed arrays in the JSON bundle (status_breakdown,
 * project_summary, packing_trend, dispatch_trend, shipments) - this
 * module only maps those numbers into Chart.js's data/options shape,
 * it never re-derives a business figure.
 */

const PackingCharts = {

  instances: {},
  store: null,
  packingGranularity: "Week",
  packingMetric: "count",
  dispatchGranularity: "Week",
  dispatchMetric: "count",

  render(store) {
    this.store = store;
    this.renderStatusDonut();
    this.renderProjectStatusChart();
    this.setupTrendFilters();
    this.renderPackingTrend();
    this.renderDispatchTrend();
    this.renderShipmentWeightChart();
  },

  destroy(key) {
    if (this.instances[key]) {
      this.instances[key].destroy();
      delete this.instances[key];
    }
  },

  metricLabel(metric) {
    return metric === "weight_kg" ? "Weight (kg)" : metric === "qty" ? "Qty (pcs)" : "Spool count";
  },

  // ---------------------------------------------------------------
  // Status donut - Pending / Packed / Dispatched spool counts
  // ---------------------------------------------------------------
  renderStatusDonut() {
    this.destroy("status");
    const ctx = document.getElementById("chart-status");
    if (!ctx) return;

    const breakdown = this.store.statusBreakdown || [];
    const order = PACKING_CONFIG.statusOrder;
    const rows = order
      .map((status) => breakdown.find((b) => b.status === status))
      .filter(Boolean);

    this.instances.status = new Chart(ctx, {
      type: "doughnut",
      data: {
        labels: rows.map((r) => `${r.status} (${r.spool_count.toLocaleString("en-US")})`),
        datasets: [{
          data: rows.map((r) => r.spool_count),
          backgroundColor: rows.map((r) => PACKING_CONFIG.statusColor[r.status]),
          borderColor: "#FFFFFF",
          borderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "62%",
        plugins: {
          legend: { position: "bottom" },
          tooltip: {
            callbacks: {
              label(item) {
                const row = rows[item.dataIndex];
                return ` ${row.status}: ${row.spool_count.toLocaleString("en-US")} spools · ${row.weight_kg.toLocaleString("en-US")} kg`;
              },
            },
          },
        },
      },
    });
  },

  // ---------------------------------------------------------------
  // Project Progress - stacked bar of Pending/Packed/Dispatched
  // spool counts per project
  // ---------------------------------------------------------------
  renderProjectStatusChart() {
    this.destroy("projectStatus");
    const ctx = document.getElementById("chart-project-status");
    if (!ctx) return;

    const projects = this.store.projectSummary || [];
    const labels = projects.map((p) => p.project_name ? `${p.project_name}\n(${p.project_code})` : p.project_code);

    const datasets = [
      { key: "spools_pending", label: "Pending / Under Packing", color: PACKING_CONFIG.statusColor["Pending / Under Packing"] },
      { key: "spools_packed", label: "Packed", color: PACKING_CONFIG.statusColor["Packed"] },
      { key: "spools_dispatched", label: "Dispatched", color: PACKING_CONFIG.statusColor["Dispatched"] },
    ].map((d) => ({
      label: d.label,
      data: projects.map((p) => p[d.key] || 0),
      backgroundColor: d.color,
      stack: "spools",
    }));

    this.instances.projectStatus = new Chart(ctx, {
      type: "bar",
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { stacked: true, ticks: { autoSkip: false } },
          y: { stacked: true, beginAtZero: true, title: { display: true, text: "Spool count" } },
        },
        plugins: { legend: { position: "bottom" } },
      },
    });
  },

  // ---------------------------------------------------------------
  // Packing / Dispatch trend charts, with Day/Week/Month +
  // count/qty/weight filters
  // ---------------------------------------------------------------
  setupTrendFilters() {
    this._wireFilterGroup("packing-period-filter", "granularity", (value) => {
      this.packingGranularity = value;
      this.renderPackingTrend();
    });
    this._wireFilterGroup("packing-metric-filter", "metric", (value) => {
      this.packingMetric = value;
      this.renderPackingTrend();
    });
    this._wireFilterGroup("dispatch-period-filter", "granularity", (value) => {
      this.dispatchGranularity = value;
      this.renderDispatchTrend();
    });
    this._wireFilterGroup("dispatch-metric-filter", "metric", (value) => {
      this.dispatchMetric = value;
      this.renderDispatchTrend();
    });
  },

  _wireFilterGroup(containerId, dataAttr, onChange) {
    const container = document.getElementById(containerId);
    if (!container || container.dataset.wired) return;
    container.dataset.wired = "true";
    container.querySelectorAll(".activity-filter__btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        container.querySelectorAll(".activity-filter__btn").forEach((b) => b.classList.remove("is-active"));
        btn.classList.add("is-active");
        onChange(btn.dataset[dataAttr]);
      });
    });
  },

  _granularityKey(g) {
    return g === "Day" ? "daily" : g === "Month" ? "monthly" : "weekly";
  },

  _renderTrendChart(key, canvasId, trend, granularity, metric, color, label) {
    this.destroy(key);
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;

    const rows = (trend && trend[this._granularityKey(granularity)]) || [];
    const labels = rows.map((r) => r.period || r.date);
    const data = rows.map((r) => r[metric] || 0);

    this.instances[key] = new Chart(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: [{ label, data, backgroundColor: color }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { ticks: { autoSkip: true, maxRotation: 45, minRotation: 0 } },
          y: { beginAtZero: true, title: { display: true, text: this.metricLabel(metric) } },
        },
        plugins: { legend: { display: false } },
      },
    });
  },

  renderPackingTrend() {
    document.getElementById("chart-packing-trend-hint").textContent =
      `${this.metricLabel(this.packingMetric)}, by ${this.packingGranularity.toLowerCase()}, by Packing Date`;
    this._renderTrendChart(
      "packingTrend", "chart-packing-trend", this.store.packingTrend,
      this.packingGranularity, this.packingMetric, "#4333A5", "Packed",
    );
  },

  renderDispatchTrend() {
    document.getElementById("chart-dispatch-trend-hint").textContent =
      `${this.metricLabel(this.dispatchMetric)}, by ${this.dispatchGranularity.toLowerCase()}, by Dispatched Date`;
    this._renderTrendChart(
      "dispatchTrend", "chart-dispatch-trend", this.store.dispatchTrend,
      this.dispatchGranularity, this.dispatchMetric, "#1F8A55", "Dispatched",
    );
  },

  // ---------------------------------------------------------------
  // Heaviest shipments (top 15 by weight)
  // ---------------------------------------------------------------
  renderShipmentWeightChart() {
    this.destroy("shipmentWeight");
    const ctx = document.getElementById("chart-shipment-weight");
    if (!ctx) return;

    const shipments = [...(this.store.shipments || [])]
      .sort((a, b) => (b.weight_kg || 0) - (a.weight_kg || 0))
      .slice(0, 15);

    this.instances.shipmentWeight = new Chart(ctx, {
      type: "bar",
      data: {
        labels: shipments.map((s) => s.container_no),
        datasets: [{
          label: "Weight (kg)",
          data: shipments.map((s) => s.weight_kg || 0),
          backgroundColor: "#D9A22D",
        }],
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        scales: { x: { beginAtZero: true, title: { display: true, text: "Weight (kg)" } } },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label(item) {
                const s = shipments[item.dataIndex];
                return ` ${s.project_name || s.project_code} · ${s.box_count} box(es) · ${item.formattedValue} kg`;
              },
            },
          },
        },
      },
    });
  },
};
