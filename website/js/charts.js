/**
 * charts.js
 * ---------------------------------------------------------
 * Renders Project Progress, Weekly Progress, and the Ageing
 * Distribution chart using Chart.js, plus the shared metric
 * selector (Spools / Inch Dia / Surface Area / Total Wt.) above
 * them. All three are built directly from master_spools.json's
 * already-computed per-spool fields (Current Stage, Total Age,
 * Inch Dia, Surface Area Out, Total Wt.) - this module only groups
 * and sums those existing numbers for Chart.js's API (the same
 * "re-sum already-final numbers" pattern used by stageThroughput.js
 * and stageAgeing.js), it doesn't derive new business figures.
 */

const SpoolCharts = {

  instances: {},
  activityGranularity: "Week",
  activityMetrics: [],
  overviewMetric: "count",
  masterSpools: [],

  chartFont: {
    family: "Inter, sans-serif",
    size: 11,
  },

  /**
   * Chart.js renders axis ticks straight onto the canvas, so getting
   * a bold Project Name + smaller "(Project Code)" onto one tick (two
   * different font weights/sizes on one label) isn't something the
   * built-in `ticks` options can do - it draws whatever text you give
   * it in a single font. This plugin instead hides the default tick
   * text for a chart's y-axis (see `y.ticks.display: false` +
   * `y.afterFit` in renderProjectChart()) and draws the two-part
   * label itself, once per tick, at the same position Chart.js would
   * have placed the default one.
   *
   * Enabled per-chart via `options.plugins.twoPartYLabels = { labels: [...] }`
   * where `labels[i] = { name, code }` lines up with data index i.
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
          // No name on record - just show the code, single line.
          ctx.font = "600 10.5px 'IBM Plex Mono', monospace";
          ctx.fillStyle = cfg.chartTextColorStrong;
          ctx.fillText(label.code || label.name || "", xPos, yPos);
        }
      });

      ctx.restore();
    },
  },

  render(store) {
    this.masterSpools = store.masterSpools || [];

    this.setupOverviewMetricFilter();
    this.renderOverviewCharts();

    this.activityMetrics = store.activityMetrics || [];
    this.setupActivityFilter();
    this.renderActivityCharts();
  },

  destroy(key) {
    if (this.instances[key]) {
      this.instances[key].destroy();
      delete this.instances[key];
    }
  },

  // -----------------------------------------------------
  // Overview metric selector (shared by all 3 charts below)
  // -----------------------------------------------------

  setupOverviewMetricFilter() {
    const container = document.getElementById("overview-metric-filter");
    if (!container || container.dataset.wired) return;
    container.dataset.wired = "true";

    container.querySelectorAll(".activity-filter__btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        container.querySelectorAll(".activity-filter__btn").forEach((b) => b.classList.remove("is-active"));
        btn.classList.add("is-active");
        this.overviewMetric = btn.dataset.metric;
        this.renderOverviewCharts();
      });
    });
  },

  overviewMetricConfig() {
    return SPOOL_STATUS_CONFIG.overviewMetrics.find((m) => m.key === this.overviewMetric)
      || SPOOL_STATUS_CONFIG.overviewMetrics[0];
  },

  renderOverviewCharts() {
    this.renderProjectChart();
    this.renderWeeklyChart();
    this.renderAgeingDistributionChart();
  },

  /**
   * Group masterSpools by `groupField` (e.g. "Project Code" or
   * "Week"), then within each group by Current Stage, summing the
   * selected overview metric (or counting spools if metric ===
   * "count"). Blank/missing group values fall under "Unassigned".
   * Returns [{ key, total, values: {stage: amount} }], sorted by
   * spool COUNT descending regardless of the selected metric, so
   * switching metrics doesn't reshuffle which row is on top.
   */
  buildStageBreakdown(groupField, excludeGroupValues = []) {

    const metric = this.overviewMetric;
    const groups = new Map();

    for (const row of this.masterSpools) {

      const groupValue = row[groupField] || "Unassigned";
      if (excludeGroupValues.includes(groupValue)) continue;

      if (!groups.has(groupValue)) {
        groups.set(groupValue, { count: 0, values: {} });
      }

      const group = groups.get(groupValue);
      group.count += 1;

      const stage = row["Current Stage"];
      const amount = metric === "count" ? 1 : (Number(row[metric]) || 0);
      group.values[stage] = (group.values[stage] || 0) + amount;
    }

    return [...groups.entries()]
      .map(([key, g]) => ({ key, total: g.count, values: g.values }))
      .sort((a, b) => b.total - a.total);
  },

  /**
   * Build one Chart.js dataset per fabrication stage, coloured per
   * SPOOL_STATUS_CONFIG.stageColor, from buildStageBreakdown()
   * records. Stages with zero across every record are skipped.
   */
  stageDatasets(records) {

    const stagesPresent = SPOOL_STATUS_CONFIG.stageOrder.filter(
      (stage) => records.some((r) => (r.values || {})[stage] > 0)
    );

    return stagesPresent.map((stage) => ({
      label: stage,
      data: records.map((r) => Math.round(((r.values || {})[stage] || 0) * 100) / 100),
      backgroundColor: SPOOL_STATUS_CONFIG.stageColor[stage] || SPOOL_STATUS_CONFIG.defaultStageColor,
      stack: "s",
      borderRadius: 2,
    }));
  },

  renderProjectChart() {

    this.destroy("project");

    const records = this.buildStageBreakdown("Project Code");
    const labels = records.map((r) => r.key);
    const twoPartLabels = records.map((r) => ({
      code: r.key,
      name: r.key === "Unassigned" ? null : SpoolData.projectNameByCode()[r.key],
    }));
    const datasets = this.stageDatasets(records);

    const metricConfig = this.overviewMetricConfig();
    const hint = document.getElementById("chart-project-hint");
    if (hint) hint.textContent = `${metricConfig.unitLabel} by current stage, per project`;

    const ctx = document.getElementById("chart-project").getContext("2d");

    this.instances.project = new Chart(ctx, {
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
            callbacks: { title: (items) => SpoolData.projectLabel(items[0].label) },
          },
          twoPartYLabels: { labels: twoPartLabels },
        },
        scales: {
          x: { stacked: true, grid: { color: SPOOL_STATUS_CONFIG.chartGridColor }, ticks: { font: this.chartFont } },
          y: {
            stacked: true,
            grid: { display: false },
            ticks: { display: false },
            // Reserves fixed room for the custom two-line labels
            // drawn by twoPartYLabelsPlugin above, since hiding the
            // built-in ticks would otherwise collapse this axis to
            // ~0 width.
            afterFit: (scale) => { scale.width = 176; },
          },
        },
      },
    });
  },

  renderWeeklyChart() {

    this.destroy("weekly");

    const records = this.buildStageBreakdown("Week", ["Unassigned"])
      .sort((a, b) => {
        const numA = parseInt(String(a.key).match(/\d+/), 10);
        const numB = parseInt(String(b.key).match(/\d+/), 10);
        return (isNaN(numA) ? Infinity : numA) - (isNaN(numB) ? Infinity : numB);
      });

    const labels = records.map((r) => r.key);
    const datasets = this.stageDatasets(records);

    const metricConfig = this.overviewMetricConfig();
    const hint = document.getElementById("chart-weekly-hint");
    if (hint) hint.textContent = `${metricConfig.unitLabel} by current stage, per planned week`;

    const ctx = document.getElementById("chart-weekly").getContext("2d");

    this.instances.weekly = new Chart(ctx, {
      type: "bar",
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "top", align: "end", labels: { font: this.chartFont, boxWidth: 10, usePointStyle: true, pointStyle: "circle" } },
          tooltip: { titleFont: this.chartFont, bodyFont: this.chartFont },
        },
        scales: {
          x: { stacked: true, grid: { display: false }, ticks: { font: { family: "IBM Plex Mono, monospace", size: 10 }, maxRotation: 0, autoSkip: true } },
          y: { stacked: true, grid: { color: SPOOL_STATUS_CONFIG.chartGridColor }, ticks: { font: this.chartFont } },
        },
      },
    });
  },

  /**
   * Ageing Distribution — every spool EXCEPT ones whose Production
   * Order hasn't been released yet (they have no anchor date and
   * always show Total Age 0, which would otherwise flood the 0-7d
   * bucket), bucketed by the already-computed Total Age field, and
   * summed by the selected overview metric (or counted, for
   * "Spools"). Buckets defined once in SPOOL_STATUS_CONFIG.ageingBuckets.
   */
  renderAgeingDistributionChart() {

    this.destroy("group");

    const buckets = SPOOL_STATUS_CONFIG.ageingBuckets;
    const metric = this.overviewMetric;

    const ageable = (this.masterSpools || []).filter(
      (row) => row["Current Stage"] !== SPOOL_STATUS_CONFIG.notReleasedLabel
    );

    const amounts = buckets.map((bucket) => {
      const inBucket = ageable.filter((row) => {
        const age = row["Total Age"] || 0;
        return age >= bucket.min && age <= bucket.max;
      });

      if (metric === "count") return inBucket.length;

      return Math.round(
        inBucket.reduce((total, row) => total + (Number(row[metric]) || 0), 0) * 100
      ) / 100;
    });

    const labels = buckets.map((b) => b.label);
    const colors = buckets.map((b) => b.color);

    const metricConfig = this.overviewMetricConfig();
    const hint = document.getElementById("chart-group-hint");
    if (hint) {
      hint.textContent =
        `${metricConfig.unitLabel} (excl. Production Order Not Released) by Total Age bracket`;
    }

    const ctx = document.getElementById("chart-group").getContext("2d");

    this.instances.group = new Chart(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: [{
          label: metricConfig.unitLabel,
          data: amounts,
          backgroundColor: colors,
          borderRadius: 3,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { titleFont: this.chartFont, bodyFont: this.chartFont },
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { family: "IBM Plex Mono, monospace", size: 10 }, maxRotation: 0 } },
          y: { grid: { color: SPOOL_STATUS_CONFIG.chartGridColor }, ticks: { font: this.chartFont, precision: 0 } },
        },
      },
    });
  },

  // -----------------------------------------------------
  // Activity metrics: Fit-Up DB / Welding DB (Inch Dia) and
  // Painting (Surface Area Out), from activity_metrics.json.
  // Re-aggregates the already-final daily numbers by Day, Week, or
  // Month - it only re-sums, it never derives a new figure.
  // -----------------------------------------------------

  setupActivityFilter() {

    const container = document.getElementById("activity-filter");
    if (!container || container.dataset.wired) return;
    container.dataset.wired = "true";

    container.querySelectorAll(".activity-filter__btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        container.querySelectorAll(".activity-filter__btn").forEach((b) => b.classList.remove("is-active"));
        btn.classList.add("is-active");
        this.activityGranularity = btn.dataset.granularity;
        this.renderActivityCharts();
      });
    });
  },

  /**
   * Group daily activity_metrics.json records into Day / Week /
   * Month buckets and sum each metric per bucket. Returns the last
   * `limit` buckets, oldest first, ready to plot.
   */
  aggregateActivity(granularity, limit = 12) {

    const records = this.activityMetrics;
    const buckets = new Map(); // key -> { label, sortKey, fitup, welding, painting }

    for (const r of records) {

      let key, label, sortKey;

      if (granularity === "Day") {
        key = r.date;
        label = r.date;
        sortKey = r.date;
      } else if (granularity === "Month") {
        key = r.month_label;
        label = r.month_label;
        sortKey = r.month_label; // "Mon YYYY" strings from the same field sort chronologically once parsed below
      } else {
        key = r.week_start;
        label = r.week_label;
        sortKey = r.week_start;
      }

      if (!buckets.has(key)) {
        buckets.set(key, { label, sortKey, fitup: 0, welding: 0, painting: 0 });
      }

      const bucket = buckets.get(key);
      bucket.fitup += r.fitup_inch_dia || 0;
      bucket.welding += r.welding_inch_dia || 0;
      bucket.painting += r.painting_surface_area_out || 0;
    }

    const sorted = [...buckets.values()].sort((a, b) => {
      if (granularity === "Month") {
        return new Date(`1 ${a.sortKey}`) - new Date(`1 ${b.sortKey}`);
      }
      return String(a.sortKey).localeCompare(String(b.sortKey));
    });

    return sorted.slice(-limit);
  },

  renderActivityCharts() {

    const granularity = this.activityGranularity;
    const bucketed = this.aggregateActivity(granularity);
    const granularityWord = { Day: "day", Week: "week", Month: "month" }[granularity];

    ["fitup", "welding", "painting"].forEach((key) => {
      const hint = document.getElementById(`activity-hint-${key}`);
      if (hint) hint.textContent = granularityWord;
    });

    const labels = bucketed.map((b) => b.label);

    this.renderSingleActivityChart(
      "chart-activity-fitup", "activity-fitup",
      labels, bucketed.map((b) => b.fitup),
      "Inch Dia", SPOOL_STATUS_CONFIG.stageColor["Fit-Up"],
    );

    this.renderSingleActivityChart(
      "chart-activity-welding", "activity-welding",
      labels, bucketed.map((b) => b.welding),
      "Inch Dia", SPOOL_STATUS_CONFIG.stageColor["Welding"],
    );

    this.renderSingleActivityChart(
      "chart-activity-painting", "activity-painting",
      labels, bucketed.map((b) => b.painting),
      "Surface Area Out", SPOOL_STATUS_CONFIG.stageColor["Under Painting"],
    );
  },

  renderSingleActivityChart(canvasId, instanceKey, labels, data, metricLabel, color) {

    this.destroy(instanceKey);

    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    this.instances[instanceKey] = new Chart(canvas.getContext("2d"), {
      type: "bar",
      data: {
        labels,
        datasets: [{
          label: metricLabel,
          data,
          backgroundColor: color,
          borderRadius: 3,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { titleFont: this.chartFont, bodyFont: this.chartFont },
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { family: "IBM Plex Mono, monospace", size: 10 }, maxRotation: 0, autoSkip: true } },
          y: { grid: { color: SPOOL_STATUS_CONFIG.chartGridColor }, ticks: { font: this.chartFont } },
        },
      },
    });
  },
};
