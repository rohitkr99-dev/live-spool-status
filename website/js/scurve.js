/**
 * scurve.js
 * ---------------------------------------------------------
 * Renders the "Project S-Curve" chart: cumulative Planned vs. Actual
 * progress over time, straight from s_curve_summary.json (see
 * src/summary.py -> SummaryEngine.generate_s_curve_summary()). Per
 * the Master Specification's Rule 2/3, this module does no
 * arithmetic beyond formatting - every percentage, count, and week
 * bucket already arrives fully computed, for "All Projects" AND for
 * each individual Project Code.
 *
 * Lives inside the Stage Ageing Summary section and deliberately
 * shares THAT section's Project selector (#stage-ageing-project -
 * see stageAgeing.js) rather than having a filter of its own, so
 * picking a project there filters this chart too.
 */

const SpoolSCurve = {

  instance: null,
  data: null, // raw s_curve_summary.json: { as_of, overall, projects }

  chartFont: {
    family: "Inter, sans-serif",
    size: 11,
  },

  render(store) {

    this.data = store.sCurveSummary;

    const card = document.getElementById("scurve-card");
    if (!card) return;

    const hasData = this.data
      && this.data.overall
      && Array.isArray(this.data.overall.points)
      && this.data.overall.points.length > 0;

    card.hidden = !hasData;
    if (!hasData) return;

    this.setupControl();
    this.renderForCurrentSelection();
  },

  /**
   * Reuses the Stage Ageing Summary section's own Project dropdown
   * (populated by stageAgeing.js -> populateProjectOptions()) rather
   * than adding a second one - just adds ONE extra "also re-render
   * the S-Curve" listener alongside stageAgeing.js's own listener.
   */
  setupControl() {
    const select = document.getElementById("stage-ageing-project");
    if (!select || select.dataset.scurveWired) return;
    select.dataset.scurveWired = "true";

    select.addEventListener("change", () => this.renderForCurrentSelection());
  },

  selectedProject() {
    const select = document.getElementById("stage-ageing-project");
    return select ? select.value : "__all__";
  },

  /**
   * The already-computed curve for the current dropdown selection -
   * "All Projects" -> data.overall, otherwise data.projects[code].
   * Falls back to an empty curve (not "All Projects") if a selected
   * project has no S-Curve data of its own, so the chart clears
   * instead of silently showing the wrong project's numbers.
   */
  currentCurve() {

    const project = this.selectedProject();

    if (project === "__all__") {
      return { label: "All Projects", curve: this.data.overall };
    }

    const curve = (this.data.projects || {})[project];

    return {
      label: SpoolData.projectLabel(project),
      curve: curve || { total_scope: 0, points: [], cumulative_planned_pct_to_date: null, cumulative_actual_pct_to_date: null, schedule_variance_pct: null },
    };
  },

  renderForCurrentSelection() {
    if (!this.data) return;
    const { label, curve } = this.currentCurve();
    this.renderHint(label);
    this.renderStats(curve);
    this.renderChart(curve);
  },

  renderHint(label) {
    const hint = document.getElementById("scurve-hint");
    if (!hint) return;

    const asOf = this.data.as_of
      ? new Date(this.data.as_of).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
      : "today";

    hint.textContent = label === "All Projects"
      ? `Cumulative Planned vs. Actual %, all projects — dashed = plan, solid = actual, up to ${asOf}`
      : `Cumulative Planned vs. Actual % — ${label} — dashed = plan, solid = actual, up to ${asOf}`;
  },

  renderStats(curve) {

    const plannedEl = document.getElementById("scurve-planned-to-date");
    const actualEl = document.getElementById("scurve-actual-to-date");
    const varianceEl = document.getElementById("scurve-variance");

    if (plannedEl) plannedEl.textContent = this.formatPct(curve.cumulative_planned_pct_to_date);
    if (actualEl) actualEl.textContent = this.formatPct(curve.cumulative_actual_pct_to_date);

    if (varianceEl) {
      const value = curve.schedule_variance_pct;
      if (value === null || value === undefined) {
        varianceEl.textContent = "n/a";
        varianceEl.style.color = "";
      } else {
        const sign = value > 0 ? "+" : value < 0 ? "\u2212" : "";
        varianceEl.textContent = `${sign}${Math.abs(value).toFixed(1)}%`;
        varianceEl.style.color = value < 0 ? "var(--status-critical)" : "var(--status-complete)";
      }
    }
  },

  formatPct(value) {
    if (value === null || value === undefined) return "—";
    return `${value.toFixed(1)}%`;
  },

  renderChart(curve) {

    if (this.instance) {
      this.instance.destroy();
      this.instance = null;
    }

    const canvas = document.getElementById("chart-scurve");
    if (!canvas) return;

    const points = curve.points || [];
    const labels = points.map((p) => p.week_label);
    const plannedData = points.map((p) => p.cumulative_planned_pct);
    const actualData = points.map((p) => p.cumulative_actual_pct);

    const colors = SPOOL_STATUS_CONFIG.sCurve;

    this.instance = new Chart(canvas.getContext("2d"), {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Planned (cumulative %)",
            data: plannedData,
            borderColor: colors.plannedColor,
            backgroundColor: colors.plannedColor,
            borderDash: [6, 4],
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 4,
            tension: 0.15,
            spanGaps: true,
          },
          {
            label: "Actual (cumulative %)",
            data: actualData,
            borderColor: colors.actualColor,
            backgroundColor: colors.actualColor,
            borderWidth: 2.5,
            pointRadius: 0,
            pointHoverRadius: 4,
            tension: 0.15,
            spanGaps: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: {
            position: "top", align: "end",
            labels: { font: this.chartFont, boxWidth: 10, usePointStyle: true, pointStyle: "circle" },
          },
          tooltip: {
            titleFont: this.chartFont,
            bodyFont: this.chartFont,
            callbacks: {
              label(ctx) {
                const value = ctx.parsed.y;
                if (value === null || value === undefined) return `${ctx.dataset.label}: —`;
                return `${ctx.dataset.label}: ${value.toFixed(1)}%`;
              },
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { font: { family: "IBM Plex Mono, monospace", size: 10 }, maxRotation: 0, autoSkip: true },
          },
          y: {
            min: 0,
            max: 100,
            grid: { color: SPOOL_STATUS_CONFIG.chartGridColor },
            ticks: { font: this.chartFont, callback: (v) => `${v}%` },
          },
        },
      },
    });
  },
};
