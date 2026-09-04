/**
 * painting-excelExport.js
 * ---------------------------------------------------------
 * "Export Excel" - bundles every chart's underlying data on this
 * page into one multi-sheet workbook (KPIs, funnel, bottleneck,
 * histogram, aging, weekly trend, all 5 Process Output Over Time
 * charts, all 6 Output by Bay processes, project/material insight).
 * Per the person (2026-09-04): "I want you to add excel download
 * button with all charts possible in this painting page. If the data
 * volume seems big, then you may add filter options as well."
 *
 * Deliberately does NOT re-fetch or recompute anything - every sheet
 * is built straight from PaintingData.store / PaintingCharts's own
 * already-computed state, the same objects the charts themselves
 * render from, so the export always matches what's on screen. Uses
 * the vendored SheetJS build (website/vendor/xlsx.core.min.js) - same
 * technique as production-charts.js -> exportBacklogRows().
 *
 * "Filter options" for the time-series sheets (Process Output, Output
 * by Bay): rather than build a second, separate filter UI just for
 * the export, each of those sheets honours whatever Day/Week/Month
 * granularity is CURRENTLY selected in that section's own on-page
 * toggle (PaintingCharts.outputGranularity / .bayOutputGranularity) -
 * switch to Day before exporting for the finest-grained cut, Month
 * for the coarsest. Every time-series sheet includes both metrics
 * (spool count AND surface area) as separate columns regardless of
 * which one is currently selected on screen - unlike a chart, a
 * spreadsheet has no clutter cost to showing both, so there's no
 * reason to force a choice the way the chart's own toggle does. The
 * Blasting/Bay charts' own "last 20 periods" on-screen range picker
 * is NOT applied here - the export always covers the FULL period
 * range, since narrowing that was only ever a chart-legibility
 * affordance, not a meaningful data filter.
 */

const PaintingExcelExport = {

  // ---------------------------------------------------------------
  // Sheet builders - each returns an array of plain objects, one per
  // row, with human-readable column names (these become the actual
  // Excel column headers via XLSX.utils.json_to_sheet()).
  // ---------------------------------------------------------------

  buildSummarySheet() {
    const k = PaintingData.store.kpiSummary || {};
    return [
      { Metric: "RFP Done (DPR)", Value: k.total_rfp_done },
      { Metric: "Missing From Painting Plan", Value: k.missing_from_plan_count },
      { Metric: "Excluded (Already Packed)", Value: k.excluded_already_packed_count },
      { Metric: "PDI Cleared", Value: k.pdi_cleared_count },
      { Metric: "Still Open", Value: k.open_count },
      { Metric: "Stuck > 8 Working Days", Value: k.stuck_long_open_count },
      { Metric: "Pickling Done", Value: k.pickling_done_count },
      { Metric: "Pickling Eligible", Value: k.pickling_eligible_count },
      { Metric: "Median RFP → PDI Clearance (working days)", Value: k.median_total_cycle_days },
      { Metric: "Average RFP → PDI Clearance (working days)", Value: k.avg_total_cycle_days },
      { Metric: "Within the 4-Day Ideal (%)", Value: k.pct_within_ideal },
      { Metric: "Data Generated At", Value: PaintingData.store.generatedAt },
    ];
  },

  buildFunnelSheet() {
    return (PaintingData.store.stageFunnel || []).map((r) => ({
      Stage: r.stage,
      "Done Count": r.done_count,
      "Applicable Count": r.applicable_count,
      "% of Applicable": r.pct_of_applicable,
    }));
  },

  buildBottleneckSheet() {
    return (PaintingData.store.stageDurationStats || []).map((r) => ({
      Segment: r.segment,
      "Applicable Count": r.applicable_count,
      "Out of Order Count": r.out_of_order_count,
      "Median Days": r.median_days,
      "Average Days": r.avg_days,
      "90th Percentile Days": r.p90_days,
      "Max Days": r.max_days,
    }));
  },

  buildHistogramSheet() {
    return (PaintingData.store.cycleTimeHistogram || []).map((r) => ({
      Bucket: r.bucket,
      "Spool Count": r.count,
    }));
  },

  buildAgingSheet() {
    return (PaintingData.store.agingBuckets || []).map((r) => ({
      Bucket: r.bucket,
      "Open Spool Count": r.count,
    }));
  },

  buildWeeklyTrendSheet() {
    return (PaintingData.store.weeklyTrend || []).map((r) => ({
      "RFP Week": r.week,
      "Median Cycle Days": r.median_days,
      "Spool Count": r.count,
    }));
  },

  /** Shared by every Process Output Over Time sheet - both metrics, whatever granularity is currently selected on screen. */
  buildStageOutputSheet(stageKey) {
    const stageData = (PaintingData.store.stageOutputTrend || {})[stageKey] || {};
    const granularity = PaintingCharts.outputGranularity;
    const rows = stageData[PaintingCharts._granularityKey(granularity)] || [];
    return rows.map((r) => ({
      Period: PaintingCharts._formatPeriodLabel(r.period, granularity),
      "Spool Count": r.count,
      "Surface Area (m²)": r.surface_area,
    }));
  },

  buildBlastingSheet() {
    const granularity = PaintingCharts.outputGranularity;
    const rows = (PaintingData.store.blastingOutputTrend || {})[PaintingCharts._granularityKey(granularity)] || [];
    return rows.map((r) => ({
      Period: PaintingCharts._formatPeriodLabel(r.period, granularity),
      "Internal Blasting - Spool Count": r.internal_blasting.count,
      "Internal Blasting - Surface Area (m²)": r.internal_blasting.surface_area,
      "External Blasting - Spool Count": r.external_blasting.count,
      "External Blasting - Surface Area (m²)": r.external_blasting.surface_area,
      "Combined Total - Spool Count": r.total.count,
      "Combined Total - Surface Area (m²)": r.total.surface_area,
    }));
  },

  /** One sheet per bay-comparison process - dynamic bay columns (Bay-4/Bay-6/Bay-6 Auto), both metrics. */
  buildBayStageSheet(stageKey) {
    const bayData = PaintingData.store.bayOutputTrend || {};
    const bays = bayData.bays || [];
    const granularity = PaintingCharts.bayOutputGranularity;
    const stageData = (bayData.stages || {})[stageKey] || {};
    const rows = stageData[PaintingCharts._granularityKey(granularity)] || [];
    return rows.map((r) => {
      const row = { Period: PaintingCharts._formatPeriodLabel(r.period, granularity) };
      bays.forEach((bay) => {
        const v = r[bay] || { count: 0, surface_area: 0 };
        row[`${bay} - Spool Count`] = v.count;
        row[`${bay} - Surface Area (m²)`] = v.surface_area;
      });
      return row;
    });
  },

  buildProjectInsightSheet() {
    return (PaintingData.store.projectInsight || []).map((r) => ({
      "Project Code": r.project_code,
      "Project Name": r.project_name,
      "Spool Count": r.spool_count,
      "PDI Cleared Count": r.pdi_cleared_count,
      "Stuck > 8 Working Days": r.stuck_long_open_count,
      "Median Cycle Days": r.median_cycle_days,
      "% Within Ideal": r.pct_within_ideal,
    }));
  },

  buildMaterialInsightSheet() {
    return (PaintingData.store.materialInsight || []).map((r) => ({
      Material: r.material,
      "Spool Count": r.spool_count,
      "PDI Cleared Count": r.pdi_cleared_count,
      "Stuck > 8 Working Days": r.stuck_long_open_count,
      "Median Cycle Days": r.median_cycle_days,
      "% Within Ideal": r.pct_within_ideal,
    }));
  },

  // ---------------------------------------------------------------

  processSheets: [
    ["primer", "Output - Primer"],
    ["pickling", "Output - Pickling"],
    ["pdi_offer", "Output - PDI Offer"],
    ["pdi_clearance", "Output - PDI Clearance"],
  ],

  baySheets: [
    ["internal_blasting", "Bay - Internal Blasting"],
    ["external_blasting", "Bay - External Blasting"],
    ["primer", "Bay - Primer"],
    ["pickling", "Bay - Pickling"],
    ["pdi_offer", "Bay - PDI Offer"],
    ["pdi_clearance", "Bay - PDI Clearance"],
  ],

  /** Excel sheet names are capped at 31 characters and can't repeat - every name above is already well within that. */
  addSheet(workbook, rows, name) {
    if (!rows.length) return;
    const sheet = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(workbook, sheet, name);
  },

  export() {
    if (typeof PaintingData === "undefined" || !PaintingData.hasData) {
      PaintingApp.showToast("No data loaded yet - nothing to export", true);
      return;
    }
    if (typeof XLSX === "undefined") {
      PaintingApp.showToast("Couldn't build the Excel file - see console for details", true);
      console.error("XLSX (SheetJS) is not loaded");
      return;
    }

    const workbook = XLSX.utils.book_new();

    this.addSheet(workbook, this.buildSummarySheet(), "Summary");
    this.addSheet(workbook, this.buildFunnelSheet(), "Stage Completion Funnel");
    this.addSheet(workbook, this.buildBottleneckSheet(), "Median Days per Stage");
    this.addSheet(workbook, this.buildHistogramSheet(), "Cycle Time Histogram");
    this.addSheet(workbook, this.buildAgingSheet(), "Aging Buckets");
    this.addSheet(workbook, this.buildWeeklyTrendSheet(), "Median Cycle Time by Week");
    this.addSheet(workbook, this.buildBlastingSheet(), "Output - Blasting (Int vs Ext)");

    this.processSheets.forEach(([key, name]) => {
      this.addSheet(workbook, this.buildStageOutputSheet(key), name);
    });

    this.baySheets.forEach(([key, name]) => {
      this.addSheet(workbook, this.buildBayStageSheet(key), name);
    });

    this.addSheet(workbook, this.buildProjectInsightSheet(), "Insight - By Project");
    this.addSheet(workbook, this.buildMaterialInsightSheet(), "Insight - By Material");

    const stamp = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(workbook, `painting-charts-${stamp}.xlsx`);
  },

  init() {
    const btn = document.getElementById("export-excel-btn");
    if (!btn) return;
    btn.addEventListener("click", () => {
      btn.classList.add("is-loading");
      try {
        this.export();
      } catch (error) {
        console.error(error);
        PaintingApp.showToast("Couldn't build the Excel file - see console for details", true);
      } finally {
        btn.classList.remove("is-loading");
      }
    });
  },
};

document.addEventListener("DOMContentLoaded", () => PaintingExcelExport.init());
