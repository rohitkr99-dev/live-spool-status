/**
 * quality-charts.js
 * ---------------------------------------------------------
 * Every chart on the Quality Assurance/Control dashboard. All
 * aggregation (top-10 rework types, per-project rework rate, first-
 * offer split, day/week/month trend, rework-cycle distribution) is
 * pre-computed in Python - see src/quality/summary.py. This file
 * only shapes those numbers into Chart.js datasets.
 *
 * Charts:
 *   1. chart-top-rework-types   Top 10 rework defect types + Others
 *                              (horizontal bar, count + %)
 *   2. chart-rework-by-project  Reworked-spool % and rework-event %
 *                              per project (grouped bar)
 *   3. chart-first-offer-split  Accepted on first offer vs. needed
 *                              rework vs. other (donut)
 *   4. chart-rework-trend       Rework rate over time, toggled
 *                              between day / week / month (line)
 *   5. chart-rework-cycles      How many rework cycles spools
 *                              needed before acceptance (bar)
 */

const QualityCharts = {

  instances: {},

  chartFont: {
    family: "Inter, sans-serif",
    size: 11,
  },

  trendGranularity: "week",

  render(store) {
    this.destroyAll();

    this.renderTopReworkTypes(store.topReworkTypes);
    this.renderReworkByProject(store.reworkByProject);
    this.renderFirstOfferSplit(store.firstOfferSplit);
    this.renderReworkTrend(store.reworkTrend, this.trendGranularity);
    this.renderReworkCycles(store.reworkCycles);
  },

  destroyAll() {
    Object.values(this.instances).forEach((chart) => chart && chart.destroy());
    this.instances = {};
  },

  _ctx(id) {
    const canvas = document.getElementById(id);
    return canvas ? canvas.getContext("2d") : null;
  },

  // ---- 1. Top Rework Types ----------------------------------

  renderTopReworkTypes(topReworkTypes) {
    const ctx = this._ctx("chart-top-rework-types");
    if (!ctx || !topReworkTypes || !topReworkTypes.items.length) return;

    const items = topReworkTypes.items;
    const labels = items.map((i) => i.label);
    const counts = items.map((i) => i.count);
    const colors = items.map((i) =>
      i.label === "Others" ? QUALITY_CONFIG.othersColor : QUALITY_CONFIG.typeColor
    );
    const pctById = items.map((i) => i.pct);

    this.instances.topTypes = new Chart(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: [{
          label: "Rework events",
          data: counts,
          backgroundColor: colors,
        }],
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label(item) {
                const pct = pctById[item.dataIndex];
                return `${item.formattedValue} event(s) (${pct}%)`;
              },
            },
          },
        },
        scales: {
          x: {
            beginAtZero: true,
            grid: { color: "rgba(23, 21, 43, 0.06)" },
            ticks: { font: this.chartFont },
          },
          y: {
            grid: { display: false },
            ticks: { font: this.chartFont },
          },
        },
      },
    });
  },

  // ---- 2. Rework by Project -----------------------------------

  renderReworkByProject(reworkByProject) {
    const ctx = this._ctx("chart-rework-by-project");
    if (!ctx || !reworkByProject || !reworkByProject.length) return;

    const labels = reworkByProject.map((p) => p.project_name || p.project_code);
    const spoolPct = reworkByProject.map((p) => p.reworked_spool_pct);
    const eventPct = reworkByProject.map((p) => p.rework_event_pct);
    const extra = reworkByProject.map((p) => ({
      reworkedSpools: p.reworked_spools,
      totalSpools: p.total_spools,
      reworkEvents: p.rework_events,
      totalEvents: p.total_events,
    }));

    this.instances.byProject = new Chart(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "Reworked Spools %",
            data: spoolPct,
            backgroundColor: QUALITY_CONFIG.projectBarColor,
          },
          {
            label: "Rework Events %",
            data: eventPct,
            backgroundColor: QUALITY_CONFIG.otherColor,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: "top",
            labels: { boxWidth: 12, boxHeight: 12, font: { size: 12, weight: "600" } },
          },
          tooltip: {
            callbacks: {
              afterBody(items) {
                const i = items[0].dataIndex;
                const e = extra[i];
                return [
                  `${e.reworkedSpools} of ${e.totalSpools} spool(s) reworked`,
                  `${e.reworkEvents} of ${e.totalEvents} offer event(s) were rework`,
                ];
              },
            },
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: this.chartFont } },
          y: {
            beginAtZero: true,
            ticks: { font: this.chartFont, callback: (v) => `${v}%` },
            grid: { color: "rgba(23, 21, 43, 0.06)" },
          },
        },
      },
    });
  },

  // ---- 3. First Offer Split -----------------------------------

  renderFirstOfferSplit(split) {
    const ctx = this._ctx("chart-first-offer-split");
    if (!ctx || !split) return;

    const labels = ["Accepted First Offer", "Needed Rework", "Other"];
    const data = [split.accepted_first_offer, split.needed_rework, split.other];
    const pcts = [split.accepted_first_offer_pct, split.needed_rework_pct, split.other_pct];
    const colors = [QUALITY_CONFIG.acceptColor, QUALITY_CONFIG.reworkColor, QUALITY_CONFIG.otherColor];

    this.instances.firstOffer = new Chart(ctx, {
      type: "doughnut",
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: colors,
          borderColor: "#FFFFFF",
          borderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "62%",
        plugins: {
          legend: {
            position: window.innerWidth < 640 ? "bottom" : "right",
            align: "center",
            labels: {
              boxWidth: 13,
              boxHeight: 13,
              padding: 14,
              font: { size: 12.5, weight: "600" },
              generateLabels(chart) {
                return chart.data.labels.map((label, i) => ({
                  text: `${label} — ${pcts[i]}%`,
                  fillStyle: colors[i],
                  strokeStyle: colors[i],
                  index: i,
                }));
              },
            },
          },
          tooltip: {
            callbacks: {
              label(item) {
                return `${item.label}: ${item.formattedValue} spool(s) (${pcts[item.dataIndex]}%)`;
              },
            },
          },
        },
      },
    });
  },

  // ---- 4. Rework Trend ------------------------------------------

  renderReworkTrend(trend, granularity) {
    const ctx = this._ctx("chart-rework-trend");
    if (!ctx || !trend) return;

    const series = trend[granularity] || [];
    const labels = series.map((p) => p.period);
    const pcts = series.map((p) => p.pct);
    const extra = series.map((p) => ({ rework: p.rework, total: p.total }));

    this.instances.trend = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [{
          label: "Rework rate",
          data: pcts,
          borderColor: QUALITY_CONFIG.trendLineColor,
          backgroundColor: QUALITY_CONFIG.trendLineColor,
          tension: 0.3,
          pointRadius: labels.length > 40 ? 0 : 3,
          fill: false,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label(item) {
                const e = extra[item.dataIndex];
                return `${item.formattedValue}% (${e.rework} of ${e.total} offer event(s))`;
              },
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { font: this.chartFont, maxRotation: 45, minRotation: labels.length > 15 ? 45 : 0 },
          },
          y: {
            beginAtZero: true,
            ticks: { font: this.chartFont, callback: (v) => `${v}%` },
            grid: { color: "rgba(23, 21, 43, 0.06)" },
          },
        },
      },
    });
  },

  // ---- 5. Rework Cycles ------------------------------------------

  renderReworkCycles(cycles) {
    const ctx = this._ctx("chart-rework-cycles");
    if (!ctx || !cycles || !cycles.length) return;

    const labelFor = {
      "0": "Accepted first try (0 reworks)",
      "1": "1 rework",
      "2": "2 reworks",
      "3+": "3+ reworks",
    };

    const labels = cycles.map((c) => labelFor[c.bucket] || c.bucket);
    const counts = cycles.map((c) => c.count);
    const pcts = cycles.map((c) => c.pct);
    const colors = cycles.map((c) => QUALITY_CONFIG.cycleColor[c.bucket] || QUALITY_CONFIG.otherColor);

    this.instances.cycles = new Chart(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: [{
          label: "Spools",
          data: counts,
          backgroundColor: colors,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label(item) {
                return `${item.formattedValue} spool(s) (${pcts[item.dataIndex]}%)`;
              },
            },
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: this.chartFont } },
          y: {
            beginAtZero: true,
            ticks: { font: this.chartFont },
            grid: { color: "rgba(23, 21, 43, 0.06)" },
          },
        },
      },
    });
  },
};
