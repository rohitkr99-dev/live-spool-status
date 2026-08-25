/**
 * materialHold.js
 * ---------------------------------------------------------
 * Renders the "Hold & MNA by Project" chart (2026-08-26, given by
 * the person: "add 1 chart in Projects page below S-curve chart
 * showing this Hold & MNA data project wise"). Source:
 * dashboard_summary.json -> material_hold_by_project, a
 * {project: {"Hold": count, "MNA": count}} cross-tab
 * (src/summary.py -> generate_dashboard_summary()), built from the
 * Weekly Production Planning workbook's Material/Hold Status column
 * (src/merge.py -> apply_material_hold_status()) - a SEPARATE signal
 * from the Rework Data workbook's Hold status shown elsewhere on
 * this dashboard (rework_quantum / Exceptions tab). A spool can be
 * flagged here without ever appearing in the Rework workbook at
 * all, since this reflects Production's own material/scheduling
 * status, not QC's inspection status.
 *
 * Purely a rendering of already-computed data - no counting happens
 * here, same principle as fabline.js.
 */

const SpoolMaterialHold = {

  instance: null,

  render(dashboardSummary) {

    const ctx = document.getElementById("chart-material-hold");
    const card = document.getElementById("material-hold-card");
    const emptyNote = document.getElementById("material-hold-empty");
    if (!ctx) return;

    if (this.instance) {
      this.instance.destroy();
      this.instance = null;
    }

    const data = (dashboardSummary && dashboardSummary.material_hold_by_project) || {};
    const projects = Object.keys(data);

    if (!projects.length) {
      if (card) card.hidden = true;
      if (emptyNote) emptyNote.hidden = false;
      return;
    }
    if (card) card.hidden = false;
    if (emptyNote) emptyNote.hidden = true;

    // Sort projects by total flagged count, busiest first - same
    // convention as the Delayed by Project chart on Production.
    const sorted = projects
      .map((project) => ({
        project,
        hold: data[project].Hold || 0,
        mna: data[project].MNA || 0,
      }))
      .sort((a, b) => (b.hold + b.mna) - (a.hold + a.mna));

    this.instance = new Chart(ctx, {
      type: "bar",
      data: {
        labels: sorted.map((row) => row.project),
        datasets: [
          {
            label: "Hold",
            data: sorted.map((row) => row.hold),
            // Matches --status-critical / --status-warning from
            // website/css/styles.css - Chart.js draws onto a canvas
            // 2D context, whose fillStyle can't resolve a raw CSS
            // var(...) string (it silently fails and canvas falls
            // back to black) - unlike DOM/CSS properties, canvas
            // needs the color pre-resolved to a literal value. Fixed
            // 2026-08-26 after the person reported both bars
            // rendering solid black.
            backgroundColor: "#A82E30",
            borderRadius: 2,
          },
          {
            label: "MNA",
            data: sorted.map((row) => row.mna),
            backgroundColor: "#B87A12",
            borderRadius: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          datalabels: { display: false },
          legend: { position: "top", align: "end", labels: { boxWidth: 10, usePointStyle: true, pointStyle: "circle" } },
        },
        scales: {
          x: { stacked: true, grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true } },
          y: {
            stacked: true, beginAtZero: true, grid: { display: false },
            ticks: { precision: 0 },
            title: { display: true, text: "Spool count" },
          },
        },
      },
    });
  },
};
