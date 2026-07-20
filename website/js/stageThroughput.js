/**
 * stageThroughput.js
 * ---------------------------------------------------------
 * "Stage Throughput" dashboard: all 7 fabrication stages, in
 * sequence, plotted daily / weekly / monthly, for a metric the
 * person picks above the chart (Spool Count, Inch Dia, Surface
 * Area, or Total Wt.).
 *
 * Every number plotted is already final on each master_spools.json
 * record (Inch Dia, Surface Area Out, Total Wt., or "1 spool") - a
 * spool's presence in a stage's date field (e.g. PDQC) already means
 * Python decided it completed that stage on that date. This module
 * only re-groups those existing per-spool numbers into Day/Week/
 * Month buckets per stage, the same pattern SpoolCharts uses for the
 * Stage Activity charts (see charts.js -> aggregateActivity()) -
 * it never derives a new business figure.
 */

const SpoolStageThroughput = {

  instance: null,
  metric: "count",
  granularity: "Week",
  masterSpools: [],

  chartFont: {
    family: "Inter, sans-serif",
    size: 11,
  },

  metricField: {
    count: null,
    "Inch Dia": "Inch Dia",
    "Surface Area Out": "Surface Area Out",
    "Total Wt.": "Total Wt.",
  },

  metricLabel: {
    count: "Spool count",
    "Inch Dia": "Inch Dia",
    "Surface Area Out": "Surface area",
    "Total Wt.": "Total weight",
  },

  render(store) {
    this.masterSpools = (store && store.masterSpools) || [];
    this.setupControls();
    this.renderChart();
  },

  // -----------------------------------------------------
  // Controls (metric + period selectors above the chart)
  // -----------------------------------------------------

  setupControls() {

    const metricGroup = document.getElementById("throughput-metric-filter");
    if (metricGroup && !metricGroup.dataset.wired) {
      metricGroup.dataset.wired = "true";
      metricGroup.querySelectorAll(".activity-filter__btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          metricGroup.querySelectorAll(".activity-filter__btn").forEach((b) => b.classList.remove("is-active"));
          btn.classList.add("is-active");
          this.metric = btn.dataset.metric;
          this.renderChart();
        });
      });
    }

    const periodGroup = document.getElementById("throughput-period-filter");
    if (periodGroup && !periodGroup.dataset.wired) {
      periodGroup.dataset.wired = "true";
      periodGroup.querySelectorAll(".activity-filter__btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          periodGroup.querySelectorAll(".activity-filter__btn").forEach((b) => b.classList.remove("is-active"));
          btn.classList.add("is-active");
          this.granularity = btn.dataset.granularity;
          this.renderChart();
        });
      });
    }
  },

  // -----------------------------------------------------
  // Fiscal week helper - mirrors src/utils.py -> fiscal_week_info()
  // (30 March Week-1 anchor, 52-week cycle) so "Week" grouping here
  // lines up with the Week labels used everywhere else in Python.
  // -----------------------------------------------------

  fiscalWeekInfo(d) {
    const year = d.getFullYear();
    let anchor = new Date(year, 2, 30); // month index 2 = March
    if (d < anchor) {
      anchor = new Date(year - 1, 2, 30);
    }
    const daysSinceAnchor = Math.floor((d - anchor) / 86400000);
    const weekNumber = Math.min(Math.floor(daysSinceAnchor / 7) + 1, 52);
    const weekStart = new Date(anchor);
    weekStart.setDate(weekStart.getDate() + (weekNumber - 1) * 7);
    return {
      weekLabel: `Week ${weekNumber}`,
      weekStartKey: weekStart.toISOString().slice(0, 10),
    };
  },

  // -----------------------------------------------------
  // Aggregation
  // -----------------------------------------------------

  /**
   * Walk every spool once per stage date field it has, and add the
   * selected metric's value into that stage's Day/Week/Month bucket.
   * Returns buckets sorted oldest -> newest, one record per bucket:
   *   { label, sortKey, "Fit-Up": n, "Welding": n, ... }
   */
  aggregate() {

    const buckets = new Map();
    const stages = SPOOL_STATUS_CONFIG.stageSequence;
    const metricField = this.metricField[this.metric];

    for (const row of this.masterSpools) {
      for (const stage of stages) {

        const raw = row[stage.dateField];
        if (!raw) continue;

        const parsed = new Date(raw);
        if (isNaN(parsed.getTime())) continue;

        let key, label, sortKey;

        if (this.granularity === "Day") {
          key = String(raw).slice(0, 10);
          label = key;
          sortKey = key;
        } else if (this.granularity === "Month") {
          label = parsed.toLocaleDateString("en-US", { month: "short", year: "numeric" });
          key = label;
          sortKey = `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}`;
        } else {
          const week = this.fiscalWeekInfo(parsed);
          key = week.weekStartKey;
          label = week.weekLabel;
          sortKey = week.weekStartKey;
        }

        if (!buckets.has(key)) {
          const record = { label, sortKey };
          stages.forEach((s) => { record[s.name] = 0; });
          buckets.set(key, record);
        }

        const value = metricField ? (Number(row[metricField]) || 0) : 1;
        buckets.get(key)[stage.name] += value;
      }
    }

    return [...buckets.values()].sort((a, b) => String(a.sortKey).localeCompare(String(b.sortKey)));
  },

  // -----------------------------------------------------
  // Render
  // -----------------------------------------------------

  renderChart(limit = 16) {

    const stages = SPOOL_STATUS_CONFIG.stageSequence;
    const bucketed = this.aggregate().slice(-limit);
    const labels = bucketed.map((b) => b.label);

    const datasets = stages.map((stage) => ({
      label: stage.name,
      data: bucketed.map((b) => Math.round((b[stage.name] || 0) * 100) / 100),
      backgroundColor: SPOOL_STATUS_CONFIG.stageColor[stage.name] || SPOOL_STATUS_CONFIG.defaultStageColor,
      stack: "s",
      borderRadius: 2,
    }));

    const granularityWord = { Day: "day", Week: "week", Month: "month" }[this.granularity];
    const hint = document.getElementById("throughput-hint");
    if (hint) {
      hint.textContent = `${this.metricLabel[this.metric]}, by ${granularityWord}, per stage completion date`;
    }

    if (this.instance) {
      this.instance.destroy();
      this.instance = null;
    }

    const canvas = document.getElementById("chart-stage-throughput");
    if (!canvas) return;

    this.instance = new Chart(canvas.getContext("2d"), {
      type: "bar",
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: "top",
            align: "end",
            labels: { font: this.chartFont, boxWidth: 10, usePointStyle: true, pointStyle: "circle" },
          },
          tooltip: { titleFont: this.chartFont, bodyFont: this.chartFont },
        },
        scales: {
          x: {
            stacked: true,
            grid: { display: false },
            ticks: { font: { family: "IBM Plex Mono, monospace", size: 10 }, maxRotation: 0, autoSkip: true },
          },
          y: {
            stacked: true,
            grid: { color: SPOOL_STATUS_CONFIG.chartGridColor },
            ticks: { font: this.chartFont },
          },
        },
      },
    });
  },
};
