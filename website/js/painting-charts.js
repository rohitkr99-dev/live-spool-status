/**
 * painting-charts.js
 * ---------------------------------------------------------
 * Builds every Chart.js chart on the page directly from
 * already-computed arrays in the JSON bundle (stage_funnel,
 * stage_duration_stats, cycle_time_histogram, aging_buckets,
 * weekly_trend) - this module only maps those numbers into Chart.js's
 * data/options shape, it never re-derives a business figure.
 */

const PaintingCharts = {

  instances: {},
  store: null,

  chartFont: {
    family: "Inter, sans-serif",
    size: 11,
  },

  outputStage: "internal_blasting",
  outputMetric: "count",
  outputGranularity: "Week",

  render(store) {
    this.store = store;
    this.renderFunnel();
    this.renderBottleneck();
    this.renderHistogram();
    this.renderAging();
    this.renderTrend();
    this.setupOutputFilters();
    this.renderOutputTrend();
    this.renderProjectInsight();
    this.renderMaterialInsight();
  },

  destroy(key) {
    if (this.instances[key]) {
      this.instances[key].destroy();
      delete this.instances[key];
    }
  },

  // ---------------------------------------------------------------
  // Stage Completion Funnel - horizontal bar, one bar per stage, %
  // done OF THE SPOOLS THAT STAGE ACTUALLY APPLIES TO (applicable_
  // count) - not every spool needs internal blasting, external
  // blasting/primer, or pickling, so a raw count/pct-of-all-RFP-done
  // would understate how caught-up each stage really is.
  // ---------------------------------------------------------------
  renderFunnel() {
    this.destroy("funnel");
    const ctx = document.getElementById("chart-funnel");
    if (!ctx) return;

    const rows = this.store.stageFunnel || [];

    this.instances.funnel = new Chart(ctx, {
      type: "bar",
      data: {
        labels: rows.map((r) => r.stage),
        datasets: [{
          label: "% done",
          data: rows.map((r) => r.pct_of_applicable),
          backgroundColor: PAINTING_CONFIG.stageColor,
          maxBarThickness: 34,
        }],
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          datalabels: {
            display: "auto",
            formatter: (value, ctx) => {
              const row = rows[ctx.dataIndex];
              return value === null ? "n/a" : `${value}% (${row.done_count.toLocaleString("en-US")}/${row.applicable_count.toLocaleString("en-US")})`;
            },
          },
          tooltip: {
            titleFont: this.chartFont,
            bodyFont: this.chartFont,
            callbacks: {
              label(item) {
                const row = rows[item.dataIndex];
                if (row.pct_of_applicable === null) return " No spools this stage applies to";
                return ` ${row.done_count.toLocaleString("en-US")} of ${row.applicable_count.toLocaleString("en-US")} applicable spools (${row.pct_of_applicable}%)`;
              },
            },
          },
        },
        scales: {
          x: { beginAtZero: true, max: 100, grid: { display: false }, ticks: { font: this.chartFont, callback: (v) => `${v}%` }, title: { display: true, text: "% done, of applicable spools", font: this.chartFont } },
          y: { grid: { display: false }, ticks: { font: { ...this.chartFont, size: 12 } } },
        },
      },
    });
  },

  // ---------------------------------------------------------------
  // Bottleneck chart - median working days per stage transition, plus
  // a dashed reference line at the 4-day total ideal, so whichever
  // segment's bar reaches furthest past that line is where spools are
  // actually losing time.
  // ---------------------------------------------------------------
  idealLinePlugin: {
    id: "idealLine",
    afterDraw(chart) {
      const opts = chart.options.plugins && chart.options.plugins.idealLine;
      if (!opts || opts.value === undefined) return;
      const { ctx, scales, chartArea } = chart;
      const x = scales.x;
      if (!x) return;
      const xPos = x.getPixelForValue(opts.value);
      ctx.save();
      ctx.strokeStyle = PAINTING_CONFIG.idealLineColor;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(xPos, chartArea.top);
      ctx.lineTo(xPos, chartArea.bottom);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = "600 10.5px 'IBM Plex Mono', monospace";
      ctx.fillStyle = PAINTING_CONFIG.idealLineColor;
      ctx.textAlign = "left";
      ctx.fillText(`${opts.value}d ideal (total)`, xPos + 6, chartArea.top + 12);
      ctx.restore();
    },
  },

  renderBottleneck() {
    this.destroy("bottleneck");
    const ctx = document.getElementById("chart-bottleneck");
    if (!ctx) return;

    const rows = (this.store.stageDurationStats || []).filter((r) => r.applicable_count > 0);

    this.instances.bottleneck = new Chart(ctx, {
      type: "bar",
      data: {
        labels: rows.map((r) => r.segment),
        datasets: [{
          label: "Median working days",
          data: rows.map((r) => r.median_days),
          backgroundColor: rows.map((r) =>
            r.segment.includes("total") ? PAINTING_CONFIG.overIdealColor : PAINTING_CONFIG.stageColor
          ),
          maxBarThickness: 34,
        }],
      },
      plugins: [this.idealLinePlugin],
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          idealLine: { value: PAINTING_CONFIG.idealCycleDays },
          datalabels: {
            display: "auto",
            formatter: (value) => `${value}d`,
          },
          tooltip: {
            titleFont: this.chartFont,
            bodyFont: this.chartFont,
            callbacks: {
              label(item) {
                const row = rows[item.dataIndex];
                return [
                  ` Median: ${row.median_days}d · Average: ${row.avg_days}d · 90th pct: ${row.p90_days}d`,
                  ` Applicable to ${row.applicable_count.toLocaleString("en-US")} spool(s)${row.out_of_order_count ? ` · ${row.out_of_order_count} out-of-order` : ""}`,
                ];
              },
            },
          },
        },
        scales: {
          x: { beginAtZero: true, grid: { display: false }, ticks: { font: this.chartFont }, title: { display: true, text: "Working days", font: this.chartFont } },
          y: { grid: { display: false }, ticks: { font: { ...this.chartFont, size: 11.5 } } },
        },
      },
    });
  },

  // ---------------------------------------------------------------
  // Cycle time histogram - completed spools, bucketed
  // ---------------------------------------------------------------
  _bucketColors(rows) {
    return rows.map((r) => (r.bucket.includes("ideal") ? PAINTING_CONFIG.idealLineColor : PAINTING_CONFIG.overIdealColor));
  },

  renderHistogram() {
    this.destroy("histogram");
    const ctx = document.getElementById("chart-histogram");
    if (!ctx) return;

    const rows = this.store.cycleTimeHistogram || [];
    const total = rows.reduce((a, r) => a + r.count, 0);

    this.instances.histogram = new Chart(ctx, {
      type: "bar",
      data: {
        labels: rows.map((r) => r.bucket),
        datasets: [{ label: "Spools", data: rows.map((r) => r.count), backgroundColor: this._bucketColors(rows), maxBarThickness: 46 }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            titleFont: this.chartFont,
            bodyFont: this.chartFont,
            callbacks: {
              label(item) {
                const pct = total ? ((item.raw / total) * 100).toFixed(1) : "0.0";
                return ` ${item.raw.toLocaleString("en-US")} spools (${pct}%)`;
              },
            },
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: this.chartFont } },
          y: { beginAtZero: true, grid: { display: false }, ticks: { font: this.chartFont }, title: { display: true, text: "Spool count", font: this.chartFont } },
        },
      },
    });
  },

  // ---------------------------------------------------------------
  // Aging buckets - open spools, by days since RFP
  // ---------------------------------------------------------------
  renderAging() {
    this.destroy("aging");
    const ctx = document.getElementById("chart-aging");
    if (!ctx) return;

    const rows = this.store.agingBuckets || [];
    const total = rows.reduce((a, r) => a + r.count, 0);

    this.instances.aging = new Chart(ctx, {
      type: "bar",
      data: {
        labels: rows.map((r) => r.bucket),
        datasets: [{ label: "Open spools", data: rows.map((r) => r.count), backgroundColor: this._bucketColors(rows), maxBarThickness: 46 }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            titleFont: this.chartFont,
            bodyFont: this.chartFont,
            callbacks: {
              label(item) {
                const pct = total ? ((item.raw / total) * 100).toFixed(1) : "0.0";
                return ` ${item.raw.toLocaleString("en-US")} spools (${pct}%)`;
              },
            },
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: this.chartFont } },
          y: { beginAtZero: true, grid: { display: false }, ticks: { font: this.chartFont }, title: { display: true, text: "Open spool count", font: this.chartFont } },
        },
      },
    });
  },

  // ---------------------------------------------------------------
  // Weekly trend - median cycle time by RFP week
  // ---------------------------------------------------------------
  renderTrend() {
    this.destroy("trend");
    const ctx = document.getElementById("chart-trend");
    if (!ctx) return;

    const rows = this.store.weeklyTrend || [];

    this.instances.trend = new Chart(ctx, {
      type: "line",
      data: {
        labels: rows.map((r) => r.week),
        datasets: [
          {
            label: "Median cycle days",
            data: rows.map((r) => r.median_days),
            borderColor: PAINTING_CONFIG.overIdealColor,
            backgroundColor: `${PAINTING_CONFIG.overIdealColor}33`,
            fill: true,
            tension: 0.3,
            pointRadius: 3,
          },
          {
            label: "4-day ideal",
            data: rows.map(() => PAINTING_CONFIG.idealCycleDays),
            borderColor: PAINTING_CONFIG.idealLineColor,
            borderDash: [6, 4],
            pointRadius: 0,
            fill: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "top", align: "end", labels: { font: this.chartFont, boxWidth: 10, usePointStyle: true, pointStyle: "circle" } },
          datalabels: { display: false },
          tooltip: {
            titleFont: this.chartFont,
            bodyFont: this.chartFont,
            callbacks: {
              afterTitle(items) {
                const row = rows[items[0].dataIndex];
                return `${row.count} spool(s) RFP'd that week`;
              },
            },
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { family: "IBM Plex Mono, monospace", size: 10 }, autoSkip: true, maxRotation: 0 } },
          y: { beginAtZero: true, grid: { display: false }, ticks: { font: this.chartFont }, title: { display: true, text: "Working days", font: this.chartFont } },
        },
      },
    });
  },

  // ---------------------------------------------------------------
  // Process Output Over Time - how many spools (or how much surface
  // area) completed a given stage per day/week/month. Stage/metric/
  // granularity are simple client-side selectors over pre-computed
  // arrays (stage_output_trend in the bundle) - same filter pattern
  // as website/js/packing-charts.js -> renderPackingTrend().
  // ---------------------------------------------------------------
  stageLabel(stage) {
    return {
      internal_blasting: "Internal Blasting",
      external_blasting: "External Blasting",
      primer: "Primer",
      pickling: "Pickling",
      pdi_offer: "PDI Offer",
      pdi_clearance: "PDI Clearance",
    }[stage] || stage;
  },

  setupOutputFilters() {
    this._wireFilterGroup("output-stage-filter", "stage", (value) => {
      this.outputStage = value;
      this.renderOutputTrend();
    });
    this._wireFilterGroup("output-metric-filter", "metric", (value) => {
      this.outputMetric = value;
      this.renderOutputTrend();
    });
    this._wireFilterGroup("output-period-filter", "granularity", (value) => {
      this.outputGranularity = value;
      this.renderOutputTrend();
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

  _formatPeriodLabel(raw, granularity) {
    if (granularity === "Month") {
      const [y, m] = raw.split("-").map(Number);
      return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "short", year: "2-digit" });
    }
    if (granularity === "Week") return raw; // "2026-W14" reads fine as-is
    const date = new Date(`${raw}T00:00:00`);
    if (isNaN(date.getTime())) return raw;
    return date.toLocaleDateString("en-US", { day: "numeric", month: "short" });
  },

  renderOutputTrend() {
    this.destroy("output");
    const ctx = document.getElementById("chart-output");
    if (!ctx) return;

    const titleEl = document.getElementById("chart-output-title");
    const hintEl = document.getElementById("chart-output-hint");
    const label = this.stageLabel(this.outputStage);
    const metricLabel = this.outputMetric === "surface_area" ? "Surface area (m²)" : "Spool count";
    if (titleEl) titleEl.textContent = `${label} Output`;
    if (hintEl) hintEl.textContent = `${metricLabel}, by ${this.outputGranularity.toLowerCase()}`;

    const stageData = (this.store.stageOutputTrend || {})[this.outputStage] || {};
    const rows = stageData[this._granularityKey(this.outputGranularity)] || [];
    const rawKeys = rows.map((r) => r.period);
    const labels = rawKeys.map((raw) => this._formatPeriodLabel(raw, this.outputGranularity));
    const data = rows.map((r) => r[this.outputMetric] || 0);

    this.instances.output = new Chart(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: [{ label: metricLabel, data, backgroundColor: PAINTING_CONFIG.stageColor, borderRadius: 4, maxBarThickness: 34 }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { grid: { display: false }, ticks: { font: { family: "IBM Plex Mono, monospace", size: 10 }, autoSkip: true, maxRotation: 0 } },
          y: { beginAtZero: true, grid: { display: false }, ticks: { font: this.chartFont }, title: { display: true, text: metricLabel, font: this.chartFont } },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            titleFont: this.chartFont,
            bodyFont: this.chartFont,
            callbacks: {
              title(items) {
                const raw = rawKeys[items[0].dataIndex];
                return raw;
              },
            },
          },
        },
      },
    });
  },

  // ---------------------------------------------------------------
  // More insights - median cycle time by project / by material, so a
  // slow project or material doesn't get averaged away in the single
  // site-wide median.
  // ---------------------------------------------------------------
  renderProjectInsight() {
    this.destroy("projectInsight");
    const ctx = document.getElementById("chart-project-insight");
    if (!ctx) return;

    const rows = (this.store.projectInsight || []).filter((r) => r.median_cycle_days !== null);

    this.instances.projectInsight = new Chart(ctx, {
      type: "bar",
      data: {
        labels: rows.map((r) => r.project_code),
        datasets: [{
          label: "Median cycle days",
          data: rows.map((r) => r.median_cycle_days),
          backgroundColor: rows.map((r) => (r.median_cycle_days > PAINTING_CONFIG.idealCycleDays ? PAINTING_CONFIG.overIdealColor : PAINTING_CONFIG.idealLineColor)),
          maxBarThickness: 34,
        }],
      },
      plugins: [this.idealLinePlugin],
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          idealLine: { value: PAINTING_CONFIG.idealCycleDays },
          datalabels: { display: "auto", formatter: (v) => `${v}d` },
          tooltip: {
            titleFont: this.chartFont,
            bodyFont: this.chartFont,
            callbacks: {
              title(items) {
                const row = rows[items[0].dataIndex];
                return row.project_name ? `${row.project_name} (${row.project_code})` : row.project_code;
              },
              label(item) {
                const row = rows[item.dataIndex];
                return ` Median ${row.median_cycle_days}d · ${row.pdi_cleared_count} cleared · ${row.stuck_long_open_count} stuck open`;
              },
            },
          },
        },
        scales: {
          x: { beginAtZero: true, grid: { display: false }, ticks: { font: this.chartFont }, title: { display: true, text: "Working days", font: this.chartFont } },
          y: { grid: { display: false }, ticks: { font: { ...this.chartFont, size: 11 } } },
        },
      },
    });
  },

  renderMaterialInsight() {
    this.destroy("materialInsight");
    const ctx = document.getElementById("chart-material-insight");
    if (!ctx) return;

    const rows = (this.store.materialInsight || []).filter((r) => r.median_cycle_days !== null);

    this.instances.materialInsight = new Chart(ctx, {
      type: "bar",
      data: {
        labels: rows.map((r) => r.material),
        datasets: [{
          label: "Median cycle days",
          data: rows.map((r) => r.median_cycle_days),
          backgroundColor: rows.map((r) => (r.median_cycle_days > PAINTING_CONFIG.idealCycleDays ? PAINTING_CONFIG.overIdealColor : PAINTING_CONFIG.idealLineColor)),
          maxBarThickness: 34,
        }],
      },
      plugins: [this.idealLinePlugin],
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          idealLine: { value: PAINTING_CONFIG.idealCycleDays },
          datalabels: { display: "auto", formatter: (v) => `${v}d` },
          tooltip: {
            titleFont: this.chartFont,
            bodyFont: this.chartFont,
            callbacks: {
              label(item) {
                const row = rows[item.dataIndex];
                return ` Median ${row.median_cycle_days}d · ${row.spool_count} spool(s) · ${row.pdi_cleared_count} cleared`;
              },
            },
          },
        },
        scales: {
          x: { beginAtZero: true, grid: { display: false }, ticks: { font: this.chartFont }, title: { display: true, text: "Working days", font: this.chartFont } },
          y: { grid: { display: false }, ticks: { font: { ...this.chartFont, size: 12 } } },
        },
      },
    });
  },
};
