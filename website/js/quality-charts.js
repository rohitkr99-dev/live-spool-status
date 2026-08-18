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
 *
 * Plus (2026-08-16):
 *   - "Download Production Rework Data" button - raw rows + the
 *     Compare Rework Status Monthly / Rework Type Monthly summary
 *     blocks (src/quality/summary.py), exported client-side.
 *   - Welder Performance section (5 charts, hidden when that
 *     optional source wasn't part of this run's Drive sync) +
 *     its own "Download Welder Performance Record" button -
 *     numbers from src/quality/welder_performance.py.
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
    this.wireReworkExportButton(store.reworkExport);
    this.renderWelderPerformance(store.welderPerformance);
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
            grid: { display: false },
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
      projectCode: p.project_code,
      projectName: p.project_name,
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
              title(items) {
                const e = extra[items[0].dataIndex];
                return e.projectName ? `${e.projectName} (${e.projectCode})` : e.projectCode;
              },
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
          x: {
            grid: { display: false },
            ticks: {
              // Project Name leads, Code in brackets on its own
              // line (2026-08-08 site-wide convention - see
              // docs/ageing-and-project-naming-conventions.md - same
              // documented exception as Production's per-project
              // chart: multi-line same-size text, not a custom-drawn
              // two-size axis, since this axis can also need to
              // autoSkip/rotate for many projects).
              callback(value, index) {
                const e = extra[index];
                if (!e) return "";
                return e.projectName ? [e.projectName, `(${e.projectCode})`] : [e.projectCode];
              },
              font: this.chartFont,
            },
          },
          y: {
            beginAtZero: true,
            ticks: { font: this.chartFont, callback: (v) => `${v}%` },
            grid: { display: false },
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

    // Called on its own (not via render()/destroyAll()) every time
    // the Day/Week/Month dropdown changes - see quality-app.js ->
    // setupTrendGranularityControl(). Without this, Chart.js throws
    // "Canvas is already in use" on the 2nd+ call and silently
    // aborts, which is why switching the dropdown looked like it
    // did nothing (2026-08-08 bug report).
    if (this.instances.trend) {
      this.instances.trend.destroy();
    }

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
            grid: { display: false },
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
            grid: { display: false },
          },
        },
      },
    });
  },

  // ---- "Download Production Rework Data" ------------------------
  //
  // Client-side only, same pattern as the Production dashboard's
  // Backlog "Export to Excel" buttons (website/js/production-
  // charts.js -> wireBacklogExportButtons()): the raw rows and both
  // auto-computed summary blocks are already sitting in the bundle
  // (src/quality/pipeline.py -> "rework_export"), so the download
  // always matches exactly what's currently loaded - no second
  // Python pass at click time.

  wireReworkExportButton(reworkExport) {
    const button = document.getElementById("rework-export-btn");
    if (!button) return;

    const hasData = reworkExport && reworkExport.raw_rows && reworkExport.raw_rows.length;
    button.disabled = !hasData;

    button.onclick = () => {
      if (!hasData || typeof XLSX === "undefined") return;
      this.exportReworkWorkbook(reworkExport);
    };
  },

  exportReworkWorkbook(reworkExport) {
    const workbook = XLSX.utils.book_new();

    const rawSheet = XLSX.utils.json_to_sheet(reworkExport.raw_rows);
    XLSX.utils.book_append_sheet(workbook, rawSheet, "Production Rework Data");

    const rows = [];
    rows.push(["Compare Rework Status Monthly"]);
    rows.push(["Month", "Total Final Inspection Spool", "Acceptable", "Rework", "Rework %"]);
    (reworkExport.status_monthly || []).forEach((r) => {
      rows.push([r.month, r.total_final_inspection_spool, r.acceptable, r.rework, `${r.rework_pct}%`]);
    });

    rows.push([]);
    rows.push([]);
    rows.push(["Rework Type Monthly"]);
    const typeMonthly = reworkExport.type_monthly || { columns: [], rows: [] };
    rows.push(["Month", ...typeMonthly.columns]);
    typeMonthly.rows.forEach((r) => {
      rows.push([r.month, ...typeMonthly.columns.map((c) => r[c])]);
    });

    const summarySheet = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(workbook, summarySheet, "Summary");

    const dateStamp = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(workbook, `Production Rework Data - ${dateStamp}.xlsx`);
  },

  // ---- Welder Performance section --------------------------------
  //
  // All 5 charts + the section's own "Download Welder Performance
  // Record" button. The whole section stays hidden when the source
  // workbook wasn't part of this run's Drive sync (welderPerf is
  // null) - see src/quality/reader.py -> load_sources().

  renderWelderPerformance(welderPerf) {
    const section = document.getElementById("welder-performance-section");
    if (!section) return;

    if (!welderPerf) {
      section.hidden = true;
      this.wireWelderExportButton(null);
      return;
    }

    section.hidden = false;

    // Each chart wrapped individually (2026-08-17, diagnosing a
    // reported blank "Project Wise Reject %" chart that couldn't be
    // reproduced locally against realistic data) - so if one chart's
    // data ever hits an edge case Chart.js or a plugin doesn't like,
    // it logs a clear error to the console instead of silently
    // leaving that one canvas blank AND, worse, aborting every chart
    // queued after it in this same list (an uncaught exception in
    // one render call would otherwise stop the rest from running).
    const safeRender = (label, fn) => {
      try {
        fn();
      } catch (error) {
        console.error(`Quality dashboard: "${label}" chart failed to render.`, error);
      }
    };

    safeRender("Month Wise Joint Reject Rate", () => this.renderWelderMonthJoint(welderPerf.month_wise_joint));
    safeRender("Month Wise NDT Length Reject %", () => this.renderWelderMonthLength(welderPerf.month_wise_length));
    safeRender("Project Wise Reject %", () => this.renderWelderProject(welderPerf.project_wise));
    safeRender("Type of Defect", () => this.renderWelderDefectType(welderPerf.defect_type));
    safeRender("Rejected Joints by Welding Process", () => this.renderWelderProcess(welderPerf.process_wise));
    this.wireWelderExportButton(welderPerf);
  },

  renderWelderMonthJoint(rows) {
    const ctx = this._ctx("chart-welder-month-joint");
    if (!ctx || !rows || !rows.length) { console.warn("Month Wise Joint Reject Rate: no rows to chart.", { ctx: !!ctx, rows }); return; }

    const labels = rows.map((r) => r.month);
    const pcts = rows.map((r) => r.reject_pct);

    this.instances.welderMonthJoint = new Chart(ctx, {
      data: {
        labels,
        datasets: [
          {
            type: "bar",
            label: "Total NDT Joints",
            data: rows.map((r) => r.total_joint),
            backgroundColor: QUALITY_CONFIG.welderAcceptColor,
            yAxisID: "y",
            order: 2,
          },
          {
            type: "line",
            label: "Rejected Joints",
            data: rows.map((r) => r.reject_joint),
            borderColor: QUALITY_CONFIG.welderRejectColor,
            backgroundColor: QUALITY_CONFIG.welderRejectColor,
            yAxisID: "y1",
            tension: 0.3,
            pointRadius: 3,
            order: 1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "top", labels: { boxWidth: 12, boxHeight: 12, font: { size: 12, weight: "600" } } },
          tooltip: {
            callbacks: {
              afterBody(items) {
                return [`Reject %: ${pcts[items[0].dataIndex]}%`];
              },
            },
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: this.chartFont } },
          y: {
            beginAtZero: true,
            position: "left",
            title: { display: true, text: "Total NDT Joints", font: this.chartFont },
            grid: { display: false },
            ticks: { font: this.chartFont },
          },
          y1: {
            beginAtZero: true,
            position: "right",
            title: { display: true, text: "Rejected Joints", font: this.chartFont },
            grid: { display: false },
            ticks: { font: this.chartFont },
          },
        },
      },
    });
  },

  renderWelderMonthLength(rows) {
    const ctx = this._ctx("chart-welder-month-length");
    if (!ctx || !rows || !rows.length) { console.warn("Month Wise NDT Length Reject %: no rows to chart.", { ctx: !!ctx, rows }); return; }

    const labels = rows.map((r) => r.month);
    const pcts = rows.map((r) => r.reject_pct);

    this.instances.welderMonthLength = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [{
          label: "NDT Length Reject %",
          data: pcts,
          borderColor: QUALITY_CONFIG.welderRejectColor,
          backgroundColor: QUALITY_CONFIG.welderRejectColor,
          tension: 0.3,
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
                const r = rows[item.dataIndex];
                return [`Reject %: ${item.formattedValue}%`, `${r.reject_length_mm} mm / ${r.total_length_mm} mm`];
              },
            },
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: this.chartFont } },
          y: { beginAtZero: true, grid: { display: false }, ticks: { font: this.chartFont } },
        },
      },
    });
  },

  // Renders "Project Name" over "(Project Code)" on a chart's Y
  // axis, same technique as the main dashboard's Project Progress
  // chart (website/js/charts.js -> twoPartYLabelsPlugin) - Chart.js
  // draws tick text in one font, so getting two font weights/sizes
  // on one tick means hiding the built-in tick label and drawing it
  // ourselves. Duplicated here (not shared) since the Quality
  // dashboard doesn't load charts.js/config.js.
  twoPartYLabelsPlugin: {
    id: "twoPartYLabels",
    afterDraw(chart) {
      const opts = chart.options.plugins && chart.options.plugins.twoPartYLabels;
      if (!opts || !opts.labels || !opts.labels.length) return;

      const { ctx, scales } = chart;
      const y = scales.y;
      if (!y) return;

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
          ctx.fillStyle = QUALITY_CONFIG.chartTextColorStrong;
          ctx.fillText(label.name, xPos, yPos - 6);

          ctx.font = "500 9.5px 'IBM Plex Mono', monospace";
          ctx.fillStyle = QUALITY_CONFIG.chartTextColor;
          ctx.fillText(`(${label.code})`, xPos, yPos + 7);
        } else {
          ctx.font = "600 10.5px 'IBM Plex Mono', monospace";
          ctx.fillStyle = QUALITY_CONFIG.chartTextColorStrong;
          ctx.fillText(label.code || label.name || "", xPos, yPos);
        }
      });

      ctx.restore();
    },
  },

  renderWelderProject(rows) {
    const ctx = this._ctx("chart-welder-project");
    if (!ctx || !rows || !rows.length) { console.warn("Project Wise Reject %: no rows to chart.", { ctx: !!ctx, rows }); return; }

    const labels = rows.map((r) => r.project_code || r.project_name);
    const twoPartLabels = rows.map((r) => ({ code: r.project_code, name: r.project_name }));
    const pcts = rows.map((r) => r.reject_pct);

    this.instances.welderProject = new Chart(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: [{ label: "Reject %", data: pcts, backgroundColor: QUALITY_CONFIG.welderProjectBarColor }],
      },
      plugins: [this.twoPartYLabelsPlugin],
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          twoPartYLabels: { labels: twoPartLabels },
          tooltip: {
            callbacks: {
              title(items) {
                const r = rows[items[0].dataIndex];
                if (r.project_name && r.project_code) return `${r.project_name} (${r.project_code})`;
                return r.project_name || r.project_code;
              },
              afterBody(items) {
                const r = rows[items[0].dataIndex];
                return [`${r.reject_joint} rejected of ${r.total_joint} joint(s)`];
              },
            },
          },
        },
        scales: {
          x: { beginAtZero: true, grid: { display: false }, ticks: { font: this.chartFont } },
          y: {
            grid: { display: false },
            ticks: { display: false },
            // Reserves fixed room for the two-line labels drawn by
            // twoPartYLabelsPlugin above - hiding the built-in
            // ticks would otherwise collapse this axis to ~0 width.
            afterFit: (scale) => { scale.width = 168; },
          },
        },
      },
    });
  },

  renderWelderDefectType(rows) {
    const ctx = this._ctx("chart-welder-defect-type");
    if (!ctx || !rows || !rows.length) { console.warn("Type of Defect: no rows to chart.", { ctx: !!ctx, rows }); return; }

    const labels = rows.map((r) => r.defect);
    const palette = QUALITY_CONFIG.welderDefectPalette;
    const colors = rows.map((_, i) => palette[i % palette.length]);
    const pcts = rows.map((r) => r.pct);

    this.instances.welderDefect = new Chart(ctx, {
      type: "pie",
      data: {
        labels,
        datasets: [{ data: rows.map((r) => r.count), backgroundColor: colors }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "right", labels: { boxWidth: 12, boxHeight: 12, font: { size: 11 } } },
          tooltip: {
            callbacks: {
              label(item) {
                return ` ${item.label}: ${item.formattedValue} (${pcts[item.dataIndex]}%)`;
              },
            },
          },
        },
      },
    });
  },

  renderWelderProcess(rows) {
    const ctx = this._ctx("chart-welder-process");
    if (!ctx || !rows || !rows.length) { console.warn("Rejected Joints by Welding Process: no rows to chart.", { ctx: !!ctx, rows }); return; }

    const labels = rows.map((r) => r.process);

    this.instances.welderProcess = new Chart(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: [{ label: "Rejected Joints", data: rows.map((r) => r.rejected_joint), backgroundColor: QUALITY_CONFIG.welderProcessBarColor }],
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { beginAtZero: true, grid: { display: false }, ticks: { font: this.chartFont } },
          y: { grid: { display: false }, ticks: { font: this.chartFont } },
        },
      },
    });
  },

  // ---- "Download Welder Performance Record" ----------------------
  //
  // Same client-side, no-second-Python-pass pattern as
  // exportReworkWorkbook() above. Sheet 1 mirrors the person's raw
  // "Welder Performance - Pipe" sheet; Sheet 2 recreates his manual
  // "Weld Reject Rate - Pipe" summary sheet's 5 blocks from live
  // data (src/quality/welder_performance.py).

  wireWelderExportButton(welderPerf) {
    const button = document.getElementById("welder-export-btn");
    if (!button) return;

    const hasData = welderPerf && welderPerf.raw_rows && welderPerf.raw_rows.length;
    button.disabled = !hasData;

    button.onclick = () => {
      if (!hasData || typeof XLSX === "undefined") return;
      this.exportWelderWorkbook(welderPerf);
    };
  },

  exportWelderWorkbook(welderPerf) {
    const workbook = XLSX.utils.book_new();

    const rawSheet = XLSX.utils.json_to_sheet(welderPerf.raw_rows);
    XLSX.utils.book_append_sheet(workbook, rawSheet, "Welder Performance - Pipe");

    const rows = [];

    rows.push(["Month Wise NDT Length Summary (mm.)"]);
    rows.push(["Month", "Total Length", "Accept Length", "Reject Length", "% Reject"]);
    (welderPerf.month_wise_length || []).forEach((r) => {
      rows.push([r.month, r.total_length_mm, r.accept_length_mm, r.reject_length_mm, `${r.reject_pct}%`]);
    });

    rows.push([]);
    rows.push([]);
    rows.push(["Month Wise Joint Summary"]);
    rows.push(["Month", "Total Joint", "Accept Joint", "Reject Joint", "% Reject"]);
    (welderPerf.month_wise_joint || []).forEach((r) => {
      rows.push([r.month, r.total_joint, r.accept_joint, r.reject_joint, `${r.reject_pct}%`]);
    });

    rows.push([]);
    rows.push([]);
    rows.push(["Project Wise Summary"]);
    rows.push(["Project Code", "Project Name", "Total Joint", "Accept Joint", "Reject Joint", "% Reject"]);
    (welderPerf.project_wise || []).forEach((r) => {
      rows.push([r.project_code || "", r.project_name || "", r.total_joint, r.accept_joint, r.reject_joint, `${r.reject_pct}%`]);
    });

    rows.push([]);
    rows.push([]);
    rows.push(["Type of Defect Wise Summary"]);
    rows.push(["Defect name", "No of Joint", "% of Rejects"]);
    (welderPerf.defect_type || []).forEach((r) => {
      rows.push([r.defect, r.count, `${r.pct}%`]);
    });

    rows.push([]);
    rows.push([]);
    rows.push(["Welding Process Summary"]);
    rows.push(["Process Name", "Rejected Joint"]);
    (welderPerf.process_wise || []).forEach((r) => {
      rows.push([r.process, r.rejected_joint]);
    });

    const summarySheet = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(workbook, summarySheet, "Weld Reject Rate - Pipe");

    const dateStamp = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(workbook, `Welder Performance Record - ${dateStamp}.xlsx`);
  },
};
