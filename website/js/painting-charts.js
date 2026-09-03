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

  render(store) {
    this.store = store;
    this.renderFunnel();
    this.renderBottleneck();
    this.renderHistogram();
    this.renderAging();
    this.renderTrend();
  },

  destroy(key) {
    if (this.instances[key]) {
      this.instances[key].destroy();
      delete this.instances[key];
    }
  },

  // ---------------------------------------------------------------
  // Stage Completion Funnel - horizontal bar, one bar per stage,
  // count of RFP-done spools that have reached it.
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
          label: "Spools",
          data: rows.map((r) => r.count),
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
              return `${value.toLocaleString("en-US")} (${row.pct_of_rfp_done}%)`;
            },
          },
          tooltip: {
            titleFont: this.chartFont,
            bodyFont: this.chartFont,
            callbacks: {
              label(item) {
                const row = rows[item.dataIndex];
                return ` ${row.count.toLocaleString("en-US")} spools (${row.pct_of_rfp_done}% of RFP-done)`;
              },
            },
          },
        },
        scales: {
          x: { beginAtZero: true, grid: { display: false }, ticks: { font: this.chartFont }, title: { display: true, text: "Spool count", font: this.chartFont } },
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
};
