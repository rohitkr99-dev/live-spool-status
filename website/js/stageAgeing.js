/**
 * stageAgeing.js
 * ---------------------------------------------------------
 * "Stage Ageing Summary" dashboard: how long spools typically spend
 * AT each stage (Fit-Up through Packing - the gap between reaching
 * one stage and reaching the next), project by project. Includes
 * every spool regardless of Completed status, since a finished
 * project's historical per-stage dwell time is exactly what this
 * answers.
 *
 * Three charts, all driven by the same records and the same project
 * filter:
 *   - Average Time per Stage (bar)
 *   - Stage Dwell Time Distribution (stacked bar, by age bracket)
 *   - Average Age by Stage (treemap) - box size is average
 *     age only; spool count is hover-only, per spec.
 *
 * Every number plotted comes straight from stage_ageing_summary.json
 * (src/summary.py -> generate_stage_ageing_summary()) - one
 * pre-computed record per (Project Code, Stage) with its
 * average_days and bucket_counts already final. This module only
 * reshapes those records for Chart.js and, for the "All Projects"
 * view, re-combines each stage's numbers across projects (a straight
 * re-sum for bucket_counts/spool_count, a spool_count-weighted mean
 * for average_days) - the same "combine already-final numbers"
 * pattern used elsewhere on this dashboard (see charts.js ->
 * aggregateActivity(), stageThroughput.js -> aggregate()). It never
 * derives a new PER-SPOOL figure itself.
 */

const SpoolStageAgeing = {

  instances: {},
  selectedProject: "__all__",
  records: [],

  chartFont: {
    family: "Inter, sans-serif",
    size: 11,
  },

  render(store) {
    this.records = (store && store.stageAgeingSummary) || [];
    this.populateProjectOptions();
    this.setupControl();
    this.renderCharts();
  },

  // -----------------------------------------------------
  // Helpers
  // -----------------------------------------------------

  stageOrder() {
    return SPOOL_STATUS_CONFIG.stageSequence
      .filter((stage) => stage.name !== "Dispatch")
      .map((stage) => stage.name);
  },

  distinctProjects() {
    const projects = new Set(this.records.map((r) => r["Project Code"]));
    return [...projects].sort((a, b) => String(a).localeCompare(String(b)));
  },

  findRecord(project, stage) {
    return this.records.find(
      (r) => r["Project Code"] === project && r["Stage"] === stage
    );
  },

  /**
   * { average, count } for one stage, respecting the current project
   * filter. "All Projects" combines each project's already-final
   * average_days into one number weighted by spool_count (not a
   * plain average-of-averages, since projects can have very
   * different spool counts) - spool_count itself is a plain sum,
   * same "re-sum already-final numbers" pattern used for
   * bucket_counts elsewhere in this file. Returns null if there's
   * nothing to plot for that stage (no spools reached it yet).
   */
  statsForStage(stage) {

    if (this.selectedProject === "__all__") {

      const rows = this.records.filter((r) => r["Stage"] === stage);
      const totalSpools = rows.reduce((sum, r) => sum + (r.spool_count || 0), 0);

      if (!totalSpools) return null;

      const weightedSum = rows.reduce(
        (sum, r) => sum + (r.average_days || 0) * (r.spool_count || 0),
        0
      );

      return { average: weightedSum / totalSpools, count: totalSpools };
    }

    const record = this.findRecord(this.selectedProject, stage);

    return record ? { average: record.average_days, count: record.spool_count } : null;
  },

  // -----------------------------------------------------
  // Controls
  // -----------------------------------------------------

  populateProjectOptions() {
    const select = document.getElementById("stage-ageing-project");
    if (!select) return;

    const previous = select.value || "__all__";

    select.innerHTML = '<option value="__all__">All Projects</option>';
    this.distinctProjects().forEach((project) => {
      const option = document.createElement("option");
      option.value = project;
      option.textContent = SpoolData.projectLabel(project);
      select.appendChild(option);
    });

    // Keep the previous selection if it's still valid, else fall
    // back to "All Projects" rather than silently picking something
    // else after a fresh upload.
    const stillValid = [...select.options].some((o) => o.value === previous);
    select.value = stillValid ? previous : "__all__";
    this.selectedProject = select.value;
  },

  setupControl() {
    const select = document.getElementById("stage-ageing-project");
    if (!select || select.dataset.wired) return;
    select.dataset.wired = "true";

    select.addEventListener("change", () => {
      this.selectedProject = select.value;
      this.renderCharts();
    });
  },

  // -----------------------------------------------------
  // Render
  // -----------------------------------------------------

  destroy(key) {
    if (this.instances[key]) {
      this.instances[key].destroy();
      delete this.instances[key];
    }
  },

  renderCharts() {
    this.renderAverageChart();
    this.renderDistributionChart();
    this.renderTreemapChart();
  },

  renderAverageChart() {

    const stages = this.stageOrder();
    const allProjects = this.selectedProject === "__all__";

    let datasets;

    if (allProjects) {
      const projects = this.distinctProjects();
      datasets = projects.map((project, index) => ({
        label: SpoolData.projectLabel(project),
        data: stages.map((stage) => {
          const record = this.findRecord(project, stage);
          return record ? record.average_days : null;
        }),
        backgroundColor: SPOOL_STATUS_CONFIG.projectPalette[
          index % SPOOL_STATUS_CONFIG.projectPalette.length
        ],
        borderRadius: 2,
      }));
    } else {
      datasets = [{
        label: SpoolData.projectLabel(this.selectedProject),
        data: stages.map((stage) => {
          const record = this.findRecord(this.selectedProject, stage);
          return record ? record.average_days : null;
        }),
        backgroundColor: stages.map(
          (stage) => SPOOL_STATUS_CONFIG.stageColor[stage] || SPOOL_STATUS_CONFIG.defaultStageColor
        ),
        borderRadius: 2,
      }];
    }

    const hint = document.getElementById("stage-ageing-avg-hint");
    if (hint) {
      hint.textContent = allProjects
        ? "Average days spent at each stage, all projects"
        : `Average days spent at each stage — ${SpoolData.projectLabel(this.selectedProject)}`;
    }

    this.destroy("avg");

    const canvas = document.getElementById("chart-stage-ageing-avg");
    if (!canvas) return;

    this.instances.avg = new Chart(canvas.getContext("2d"), {
      type: "bar",
      data: { labels: stages, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: allProjects,
            position: "top",
            align: "end",
            labels: { font: this.chartFont, boxWidth: 10, usePointStyle: true, pointStyle: "circle" },
          },
          tooltip: {
            titleFont: this.chartFont,
            bodyFont: this.chartFont,
            callbacks: {
              label: (context) => `${context.dataset.label}: ${context.formattedValue} day(s)`,
            },
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { family: "IBM Plex Mono, monospace", size: 10 }, maxRotation: 0, autoSkip: false } },
          y: { grid: { color: SPOOL_STATUS_CONFIG.chartGridColor }, ticks: { font: this.chartFont }, title: { display: true, text: "Average days", font: this.chartFont } },
        },
      },
    });
  },

  renderDistributionChart() {

    const stages = this.stageOrder();
    const buckets = SPOOL_STATUS_CONFIG.ageingBuckets;
    const allProjects = this.selectedProject === "__all__";

    const bucketCountForStage = (stage, bucketLabel) => {
      if (allProjects) {
        // Re-sum each project's already-final bucket_counts for this
        // stage - not a new calculation, just adding up numbers
        // Python already produced per project.
        return this.records
          .filter((r) => r["Stage"] === stage)
          .reduce((total, r) => total + ((r.bucket_counts || {})[bucketLabel] || 0), 0);
      }
      const record = this.findRecord(this.selectedProject, stage);
      return record ? (record.bucket_counts || {})[bucketLabel] || 0 : 0;
    };

    const datasets = buckets.map((bucket) => ({
      label: bucket.label,
      data: stages.map((stage) => bucketCountForStage(stage, bucket.label)),
      backgroundColor: bucket.color,
      stack: "s",
      borderRadius: 2,
    }));

    const hint = document.getElementById("stage-ageing-dist-hint");
    if (hint) {
      hint.textContent = allProjects
        ? "Spools per age bracket, at each stage, all projects"
        : `Spools per age bracket, at each stage — ${SpoolData.projectLabel(this.selectedProject)}`;
    }

    this.destroy("dist");

    const canvas = document.getElementById("chart-stage-ageing-dist");
    if (!canvas) return;

    this.instances.dist = new Chart(canvas.getContext("2d"), {
      type: "bar",
      data: { labels: stages, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "top", align: "end", labels: { font: this.chartFont, boxWidth: 10, usePointStyle: true, pointStyle: "circle" } },
          tooltip: { titleFont: this.chartFont, bodyFont: this.chartFont },
        },
        scales: {
          x: { stacked: true, grid: { display: false }, ticks: { font: { family: "IBM Plex Mono, monospace", size: 10 }, maxRotation: 0, autoSkip: false } },
          y: { stacked: true, grid: { color: SPOOL_STATUS_CONFIG.chartGridColor }, ticks: { font: this.chartFont, precision: 0 }, title: { display: true, text: "Spool count", font: this.chartFont } },
        },
      },
    });
  },

  /**
   * "Average Age by Stage" - one box per stage, sized purely by
   * average age via chartjs-chart-treemap (self-registers a
   * "treemap" chart type onto the global Chart object - see
   * vendor/chartjs-chart-treemap.min.js). Same records, same
   * project filter as the other two charts in this section. Spool
   * count is deliberately NOT shown on the chart itself - it only
   * surfaces in the hover tooltip, per spec.
   */
  renderTreemapChart() {

    const stages = this.stageOrder();
    const allProjects = this.selectedProject === "__all__";

    const items = stages
      .map((stage) => {
        const stats = this.statsForStage(stage);
        if (!stats) return null;
        return { stage, value: stats.average, spoolCount: stats.count };
      })
      .filter(Boolean);

    const hint = document.getElementById("stage-ageing-treemap-hint");
    if (hint) {
      hint.textContent = allProjects
        ? "Box size = average age, all projects — hover a box for spool count"
        : `Box size = average age — ${SpoolData.projectLabel(this.selectedProject)} — hover a box for spool count`;
    }

    this.destroy("treemap");

    const canvas = document.getElementById("chart-stage-ageing-treemap");
    if (!canvas) return;

    this.instances.treemap = new Chart(canvas.getContext("2d"), {
      type: "treemap",
      data: {
        datasets: [{
          label: allProjects ? "All Projects" : SpoolData.projectLabel(this.selectedProject),
          tree: items,
          key: "value",
          spacing: 1.5,
          borderWidth: 2,
          borderColor: (ctx) => {
            if (ctx.type !== "data") return "transparent";
            return SPOOL_STATUS_CONFIG.stageColor[ctx.raw._data.stage] || SPOOL_STATUS_CONFIG.defaultStageColor;
          },
          backgroundColor: (ctx) => {
            if (ctx.type !== "data") return "transparent";
            return this.stageColorWithAlpha(ctx.raw._data.stage);
          },
          labels: {
            display: true,
            align: "center",
            position: "middle",
            color: "#fff",
            font: { family: "IBM Plex Mono, monospace", size: 12, weight: "600" },
            formatter: (ctx) => [
              ctx.raw._data.stage,
              `${ctx.raw.v.toFixed(1)}d`,
            ],
          },
        }],
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
              title: (items) => items[0]?.raw?._data?.stage || "",
              label: (context) => {
                const item = context.raw._data;
                return [
                  `Average age: ${context.raw.v.toFixed(1)} day(s)`,
                  `Spools: ${Number(item.spoolCount).toLocaleString("en-US")}`,
                ];
              },
            },
          },
        },
      },
    });
  },

  /** A stage's colour with reduced opacity, for treemap box fills
   * (the solid colour is kept for the box's border). Every
   * stageColor value is a 6-digit hex string, so this is just
   * appending an alpha channel - "CC" \u2248 80% opacity. */
  stageColorWithAlpha(stage) {
    const hex = SPOOL_STATUS_CONFIG.stageColor[stage] || SPOOL_STATUS_CONFIG.defaultStageColor;
    return `${hex}CC`;
  },
};
