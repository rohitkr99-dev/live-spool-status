/**
 * packing-charts.js
 * ---------------------------------------------------------
 * Builds every Chart.js chart on the page directly from
 * already-computed arrays in the JSON bundle (status_breakdown,
 * project_summary, packing_trend, dispatch_trend, shipments) - this
 * module only maps those numbers into Chart.js's data/options shape,
 * it never re-derives a business figure. Weight fields in the bundle
 * are already in MT, rounded to 2 decimals (src/packing/summary.py).
 */

const PackingCharts = {

  instances: {},
  store: null,
  packingGranularity: "Week",
  packingMetric: "count",
  dispatchGranularity: "Week",
  dispatchMetric: "count",

  chartFont: {
    family: "Inter, sans-serif",
    size: 11,
  },

  /**
   * Same two-line "Project Name" + "(Project Code)" y-axis label
   * technique as the Projects dashboard's Project Progress chart
   * (see website/js/charts.js -> twoPartYLabelsPlugin) - Chart.js
   * can't mix two font weights/sizes on one built-in tick label, so
   * this hides the default tick text (y.ticks.display: false below)
   * and draws the two-part label itself at the same tick position.
   */
  twoPartYLabelsPlugin: {
    id: "twoPartYLabels",
    afterDraw(chart) {
      const opts = chart.options.plugins && chart.options.plugins.twoPartYLabels;
      if (!opts || !opts.labels || !opts.labels.length) return;

      const { ctx, scales } = chart;
      const y = scales.y;
      if (!y) return;

      const cfg = SPOOL_STATUS_CONFIG;
      const xPos = y.right - 8;

      ctx.save();
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";

      opts.labels.forEach((label, index) => {
        if (!label) return;
        const yPos = y.getPixelForTick(index);
        if (yPos === undefined) return;

        if (label.code && label.name) {
          ctx.font = "700 11px Manrope, sans-serif";
          ctx.fillStyle = cfg.chartTextColorStrong;
          ctx.fillText(label.name, xPos, yPos - 6);

          ctx.font = "500 9.5px 'IBM Plex Mono', monospace";
          ctx.fillStyle = cfg.chartTextColor;
          ctx.fillText(`(${label.code})`, xPos, yPos + 7);
        } else {
          ctx.font = "600 10.5px 'IBM Plex Mono', monospace";
          ctx.fillStyle = cfg.chartTextColorStrong;
          ctx.fillText(label.code || label.name || "", xPos, yPos);
        }
      });

      ctx.restore();
    },
  },

  render(store) {
    this.store = store;
    this.renderStatusDonut();
    this.renderProjectStatusChart();
    this.setupTrendFilters();
    this.renderPackingTrend();
    this.renderDispatchTrend();
    this.renderShipmentBubble();
  },

  destroy(key) {
    if (this.instances[key]) {
      this.instances[key].destroy();
      delete this.instances[key];
    }
  },

  metricLabel(metric) {
    return metric === "weight_mt" ? "Weight (MT)" : metric === "qty" ? "Qty (pcs)" : "Spool count";
  },

  // ---------------------------------------------------------------
  // Status donut - Balance in Project / Packed / Dispatched spool
  // counts
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
                return ` ${row.status}: ${row.spool_count.toLocaleString("en-US")} spools · ${row.weight_mt.toFixed(2)} MT`;
              },
            },
          },
        },
      },
    });
  },

  // ---------------------------------------------------------------
  // Project Progress - horizontal stacked bar of Balance/Packed/
  // Dispatched spool counts per project. Mirrors the Projects
  // dashboard's Project Progress chart (website/js/charts.js ->
  // renderProjectChart) option-for-option - same two-part y labels,
  // legend style, grid, and font - for visual parity between the two
  // dashboards.
  // ---------------------------------------------------------------
  renderProjectStatusChart() {
    this.destroy("projectStatus");
    const ctx = document.getElementById("chart-project-status");
    if (!ctx) return;

    const projects = [...(this.store.projectSummary || [])]
      .sort((a, b) => (b.total_spools || 0) - (a.total_spools || 0));

    const labels = projects.map((p) => p.project_code);
    const twoPartLabels = projects.map((p) => ({ code: p.project_code, name: p.project_name || null }));

    const datasets = [
      { key: "spools_pending", label: "Balance in Project", color: PACKING_CONFIG.statusColor["Balance in Project"] },
      { key: "spools_packed", label: "Packed", color: PACKING_CONFIG.statusColor["Packed"] },
      { key: "spools_dispatched", label: "Dispatched", color: PACKING_CONFIG.statusColor["Dispatched"] },
    ].map((d) => ({
      label: d.label,
      data: projects.map((p) => p[d.key] || 0),
      backgroundColor: d.color,
      stack: "spools",
      borderRadius: 2,
    }));

    this.instances.projectStatus = new Chart(ctx, {
      type: "bar",
      data: { labels, datasets },
      plugins: [this.twoPartYLabelsPlugin],
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "top", align: "end", labels: { font: this.chartFont, boxWidth: 10, usePointStyle: true, pointStyle: "circle" } },
          tooltip: {
            titleFont: this.chartFont,
            bodyFont: this.chartFont,
            callbacks: {
              title(items) {
                const row = projects[items[0].dataIndex];
                return row.project_name ? `${row.project_name} (${row.project_code})` : row.project_code;
              },
            },
          },
          twoPartYLabels: { labels: twoPartLabels },
        },
        scales: {
          x: { stacked: true, beginAtZero: true, grid: { color: SPOOL_STATUS_CONFIG.chartGridColor }, ticks: { font: this.chartFont }, title: { display: true, text: "Spool count", font: this.chartFont } },
          y: {
            stacked: true,
            grid: { display: false },
            ticks: { display: false },
            // Reserves fixed room for the two-line labels drawn by
            // twoPartYLabelsPlugin - hiding the built-in ticks would
            // otherwise collapse this axis to ~0 width.
            afterFit: (scale) => { scale.width = 176; },
          },
        },
      },
    });
  },

  // ---------------------------------------------------------------
  // Packing / Dispatch trend charts, with Day/Week/Month +
  // count/qty/weight filters. Only plots dates within the current
  // fiscal year (Week 1 = 30-Mar-2025) - see
  // src/packing/summary.py -> FISCAL_YEAR_START / _in_fiscal_year().
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

  /** Short axis label - "2 Apr" (day/week start date) or "Apr 25" (month) - never the raw ISO/period key. */
  _formatPeriodLabel(raw, granularity) {
    if (granularity === "Month") {
      const [y, m] = raw.split("-").map(Number);
      const date = new Date(y, m - 1, 1);
      return date.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
    }
    const date = new Date(`${raw}T00:00:00`);
    if (isNaN(date.getTime())) return raw;
    return date.toLocaleDateString("en-US", { day: "numeric", month: "short" });
  },

  _renderTrendChart(key, canvasId, trend, granularity, metric, color, label) {
    this.destroy(key);
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;

    const rows = (trend && trend[this._granularityKey(granularity)]) || [];
    const rawKeys = rows.map((r) => r.period || r.date);
    const labels = rawKeys.map((raw) => this._formatPeriodLabel(raw, granularity));
    const data = rows.map((r) => r[metric] || 0);

    this.instances[key] = new Chart(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: [{ label, data, backgroundColor: color, borderRadius: 4, maxBarThickness: 40 }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { ticks: { autoSkip: true, maxRotation: 0, minRotation: 0 } },
          y: { beginAtZero: true, title: { display: true, text: this.metricLabel(metric) } },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title(items) {
                const raw = rawKeys[items[0].dataIndex];
                if (granularity === "Week") return `Week of ${raw}`;
                return raw;
              },
            },
          },
        },
      },
    });
  },

  renderPackingTrend() {
    document.getElementById("chart-packing-trend-hint").textContent =
      `${this.metricLabel(this.packingMetric)}, by ${this.packingGranularity.toLowerCase()}, by Packing Date · FY26 (from 30-Mar-2025)`;
    this._renderTrendChart(
      "packingTrend", "chart-packing-trend", this.store.packingTrend,
      this.packingGranularity, this.packingMetric, "#4333A5", "Packed",
    );
  },

  renderDispatchTrend() {
    document.getElementById("chart-dispatch-trend-hint").textContent =
      `${this.metricLabel(this.dispatchMetric)}, by ${this.dispatchGranularity.toLowerCase()}, by Dispatched Date · FY26 (from 30-Mar-2025)`;
    this._renderTrendChart(
      "dispatchTrend", "chart-dispatch-trend", this.store.dispatchTrend,
      this.dispatchGranularity, this.dispatchMetric, "#1F8A55", "Dispatched",
    );
  },

  // ---------------------------------------------------------------
  // Shipments bubble chart - replaces the old treemap (which had a
  // real bug: chartjs-chart-treemap's auto-aggregated "groups" cells
  // don't carry the original per-shipment fields, so the label
  // formatter rendered "undefined" on every group cell - and even
  // working, a treemap of only 3 project groups wasn't a useful
  // read). Every dispatched shipment is one bubble: x = how many
  // fiscal-year days after 30-Mar-2025 it dispatched, y = its weight
  // (MT), size = how many boxes it contained, colour = project - so
  // dispatch timing, weight, box count, and project all read in one
  // view without another bar/treemap.
  // ---------------------------------------------------------------
  renderShipmentBubble() {
    this.destroy("shipmentBubble");
    const ctx = document.getElementById("chart-shipment-bubble");
    if (!ctx) return;

    const hint = document.getElementById("chart-shipment-bubble-hint");
    const shipments = (this.store.shipments || []).filter((s) => s.dispatch_date && s.weight_mt);

    if (!shipments.length) {
      if (hint) hint.textContent = "No dispatched shipments yet";
      return;
    }
    if (hint) hint.textContent = `${shipments.length} dispatched shipment(s) · bubble size = box count · colour = project`;

    const FISCAL_YEAR_START = new Date("2025-03-30T00:00:00");
    const dayOf = (iso) => Math.round((new Date(`${iso}T00:00:00`) - FISCAL_YEAR_START) / 86400000);

    const boxCounts = shipments.map((s) => s.box_count || 1);
    const minBoxes = Math.min(...boxCounts);
    const maxBoxes = Math.max(...boxCounts);
    const radiusFor = (boxCount) => {
      if (maxBoxes === minBoxes) return 9;
      const t = (boxCount - minBoxes) / (maxBoxes - minBoxes);
      return 5 + t * 16;
    };

    const projects = [...new Set(shipments.map((s) => s.project_code))];
    const projectColor = {};
    projects.forEach((code, i) => { projectColor[code] = PACKING_CONFIG.projectPalette[i % PACKING_CONFIG.projectPalette.length]; });

    const datasets = projects.map((code) => {
      const rows = shipments.filter((s) => s.project_code === code);
      return {
        label: rows[0].project_name || code,
        data: rows.map((s) => ({ x: dayOf(s.dispatch_date), y: s.weight_mt, r: radiusFor(s.box_count || 1), _shipment: s })),
        backgroundColor: `${projectColor[code]}B3`,
        borderColor: projectColor[code],
        borderWidth: 1.5,
      };
    });

    this.instances.shipmentBubble = new Chart(ctx, {
      type: "bubble",
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            title: { display: true, text: "Dispatch date" },
            ticks: {
              callback: (value) => {
                const d = new Date(FISCAL_YEAR_START.getTime() + value * 86400000);
                return d.toLocaleDateString("en-US", { day: "numeric", month: "short" });
              },
            },
          },
          y: { beginAtZero: true, title: { display: true, text: "Weight (MT)" } },
        },
        plugins: {
          legend: { position: "bottom", labels: { usePointStyle: true, pointStyle: "circle", boxWidth: 8 } },
          tooltip: {
            callbacks: {
              title(items) {
                const s = items[0].raw._shipment;
                return s.container_no;
              },
              label(item) {
                const s = item.raw._shipment;
                return [
                  `${s.project_name || s.project_code}`,
                  `${s.box_count} box(es) · ${s.weight_mt.toFixed(2)} MT`,
                  `Dispatched ${s.dispatch_date}`,
                ];
              },
            },
          },
        },
      },
    });
  },
};
