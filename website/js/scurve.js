/**
 * scurve.js
 * ---------------------------------------------------------
 * Renders the S-Curve: cumulative Planned vs. Actual progress over
 * time, straight from s_curve_summary.json (see src/summary.py ->
 * SummaryEngine.generate_s_curve_summary()). Per the Master
 * Specification's Rule 2/3, this module does no arithmetic beyond
 * formatting - every percentage, count, and week bucket already
 * arrives fully computed.
 */

const SpoolSCurve = {

  instance: null,

  render(store) {

    const summary = store.sCurveSummary;
    const section = document.getElementById("scurve-section");
    if (!section) return;

    if (!summary || !Array.isArray(summary.points) || summary.points.length === 0) {
      section.hidden = true;
      return;
    }

    section.hidden = false;

    this.renderStats(summary);
    this.renderChart(summary);
  },

  renderStats(summary) {

    const plannedEl = document.getElementById("scurve-planned-to-date");
    const actualEl = document.getElementById("scurve-actual-to-date");
    const varianceEl = document.getElementById("scurve-variance");
    const asOfEl = document.getElementById("scurve-as-of");

    if (plannedEl) {
      plannedEl.textContent = this.formatPct(summary.cumulative_planned_pct_to_date);
    }
    if (actualEl) {
      actualEl.textContent = this.formatPct(summary.cumulative_actual_pct_to_date);
    }

    if (varianceEl) {
      const value = summary.schedule_variance_pct;
      if (value === null || value === undefined) {
        varianceEl.textContent = "n/a";
        varianceEl.style.color = "";
      } else {
        const sign = value > 0 ? "+" : value < 0 ? "\u2212" : "";
        varianceEl.textContent = `${sign}${Math.abs(value).toFixed(1)}%`;
        varianceEl.style.color = value < 0 ? "var(--status-critical)" : "var(--status-complete)";
      }
    }

    if (asOfEl) {
      asOfEl.textContent = summary.as_of
        ? `as of ${new Date(summary.as_of).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
        : "";
    }
  },

  formatPct(value) {
    if (value === null || value === undefined) return "—";
    return `${value.toFixed(1)}%`;
  },

  renderChart(summary) {

    if (this.instance) {
      this.instance.destroy();
      this.instance = null;
    }

    const canvas = document.getElementById("chart-scurve");
    if (!canvas) return;

    const points = summary.points;
    const labels = points.map((p) => p.week_label);
    const plannedData = points.map((p) => p.cumulative_planned_pct);
    const actualData = points.map((p) => p.cumulative_actual_pct);

    const colors = SPOOL_STATUS_CONFIG.sCurve;
    const chartFont = { family: "Inter, sans-serif", size: 11 };

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
            labels: { font: chartFont, boxWidth: 10, usePointStyle: true, pointStyle: "circle" },
          },
          tooltip: {
            titleFont: chartFont,
            bodyFont: chartFont,
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
            ticks: { font: chartFont, callback: (v) => `${v}%` },
          },
        },
      },
    });
  },
};
