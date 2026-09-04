/**
 * painting-chartExport.js
 * ---------------------------------------------------------
 * One small "Export" button per chart, each downloading the actual
 * spool-level rows behind that specific chart - not the chart's own
 * aggregated numbers - so a project engineer can open one chart's
 * spool list and check it for anomalies. Per the person (2026-09-04):
 * "What I asked was to put a download excel button with every chart
 * separately, which will have the spool details of the data in that
 * chart. So that people can download spool list and check for
 * anomalies." (Replaces an earlier, wrong first attempt - a single
 * combined multi-sheet workbook of aggregated chart data.)
 *
 * Same pattern already established on Production
 * (website/js/production-charts.js -> wireBacklogExportButtons() /
 * exportBacklogRows()): a small `.btn-export` button living inside
 * each `.chart-card__head`, wired via `[data-chart-export]`, using
 * `.onclick =` assignment (not addEventListener) so re-wiring on a
 * filter change simply replaces the handler instead of stacking
 * duplicate listeners.
 *
 * Every filter below re-derives its cohort from `PaintingData.store.
 * spools` - the same full per-spool record set the page's own DPR/
 * Painting spool tables already use (see painting-tables.js ->
 * byFlag(), whose own comment explains why this dashboard filters the
 * one already-computed spool list client-side rather than shipping a
 * second, denormalized copy from Python for every chart: see
 * src/painting/summary.py -> build_anomalies()). Nothing here
 * computes a NEW number - every field read below already exists on
 * each spool record, computed once in Python (src/painting/
 * summary.py -> _build_record()); this only re-filters/re-labels it
 * per chart, so an export always matches exactly what that chart is
 * showing.
 */

const PaintingChartExport = {

  CYCLE_BUCKETS: [
    [0, 4, "0–4 days (ideal)"],
    [5, 9, "5–9 days"],
    [10, 14, "10–14 days"],
    [15, 19, "15–19 days"],
    [20, 24, "20–24 days"],
    [25, 29, "25–29 days"],
    [30, null, "30+ days"],
  ],

  bucketOf(days) {
    for (const [low, high, label] of this.CYCLE_BUCKETS) {
      if (high === null) {
        if (days >= low) return label;
      } else if (days >= low && days <= high) {
        return label;
      }
    }
    return this.CYCLE_BUCKETS[this.CYCLE_BUCKETS.length - 1][2];
  },

  identity(s) {
    return {
      "Project": s.project_name || s.project_code,
      "Project Code": s.project_code,
      "Drawing No.": s.drawing_no,
      "Spool No.": s.spool_no,
    };
  },

  // ---------------------------------------------------------------
  // One cohort-builder per chart - filters PaintingData.store.spools
  // and shapes the export columns. Column sets intentionally include
  // only the fields relevant to that chart, on top of the shared
  // identity columns above.
  // ---------------------------------------------------------------

  funnelRows(spools) {
    return spools.map((s) => ({
      ...this.identity(s),
      "In Painting Plan": s.in_painting_plan ? "Yes" : "No",
      "Internal Blasting Reqd": s.internal_blasting_reqd,
      "Internal Blasting Date": s.internal_blasting_date,
      "Paint Applicable (Coats ≥ 1)": s.paint_applicable === null ? null : (s.paint_applicable ? "Yes" : "No"),
      "External Blasting Date": s.external_blasting_date,
      "Primer Date": s.primer_date,
      "Pickling Route": s.is_pickling_route ? "Yes" : "No",
      "Pickling Date": s.pickling_date,
      "PDI Offer Date": s.pdi_offer_date,
      "PDI Clearance Date": s.pdi_clearance_date,
      "Painting Status": s.painting_status,
    }));
  },

  bottleneckRows(spools) {
    // Every merged spool, every segment column - per the person
    // (2026-09-04): "every spool in that segment, not skipped". A
    // spool a given segment doesn't apply to just shows blank there,
    // rather than being dropped from the export outright.
    return spools.map((s) => ({
      ...this.identity(s),
      "RFP Date": s.rfp_date,
      "RFP → Internal Blasting (days)": s.rfp_to_internal_blasting_days,
      "RFP → External Blasting (days)": s.rfp_to_external_blasting_days,
      "Primer → Next Coat / PDI Offer (days)": s.primer_to_next_days,
      "PDI Offer → PDI Clearance (days)": s.pdi_offer_to_clearance_days,
      "RFP → PDI Clearance, total (days)": s.total_cycle_days,
    }));
  },

  histogramRows(spools) {
    return spools
      .filter((s) => s.is_complete && s.total_cycle_days !== null && s.total_cycle_days >= 0)
      .map((s) => ({
        ...this.identity(s),
        "RFP Date": s.rfp_date,
        "PDI Clearance Date": s.pdi_clearance_date,
        "Total Cycle Days": s.total_cycle_days,
        "Cycle Time Bucket": this.bucketOf(s.total_cycle_days),
      }));
  },

  agingRows(spools) {
    return spools
      .filter((s) => !s.is_complete && s.current_age_days !== null && s.current_age_days >= 0)
      .map((s) => ({
        ...this.identity(s),
        "RFP Date": s.rfp_date,
        "Current Age (days)": s.current_age_days,
        "Aging Bucket": this.bucketOf(s.current_age_days),
      }));
  },

  trendRows(spools) {
    return spools
      .filter((s) => s.is_complete && s.total_cycle_days !== null && s.total_cycle_days >= 0 && s.rfp_date)
      .map((s) => ({
        ...this.identity(s),
        "RFP Date": s.rfp_date,
        "PDI Clearance Date": s.pdi_clearance_date,
        "Total Cycle Days": s.total_cycle_days,
      }));
  },

  outputStageRows(spools, dateField, dateLabel) {
    return spools
      .filter((s) => s[dateField])
      .map((s) => ({
        ...this.identity(s),
        [dateLabel]: s[dateField],
        "Bay No.": s.bay_no,
        "Surface Area (m²)": s.surface_area,
      }));
  },

  blastingRows(spools) {
    return spools
      .filter((s) => s.internal_blasting_date || s.external_blasting_date)
      .map((s) => ({
        ...this.identity(s),
        "Internal Blasting Date": s.internal_blasting_date,
        "External Blasting Date": s.external_blasting_date,
        "Bay No.": s.bay_no,
        "Surface Area (m²)": s.surface_area,
      }));
  },

  bayOutputRows(spools, dateField, dateLabel) {
    return spools
      .filter((s) => s.bay_no && s[dateField])
      .map((s) => ({
        ...this.identity(s),
        "Bay No.": s.bay_no,
        [dateLabel]: s[dateField],
        "Surface Area (m²)": s.surface_area,
      }));
  },

  insightRows(spools, extraFields) {
    return spools.map((s) => ({
      ...this.identity(s),
      ...extraFields(s),
      "RFP Date": s.rfp_date,
      "PDI Clearance Date": s.pdi_clearance_date,
      "Total Cycle Days": s.total_cycle_days,
      "Completed?": s.is_complete ? "Yes" : "No",
      "Current Age (days, if open)": s.current_age_days,
    }));
  },

  // ---------------------------------------------------------------

  exportRows(rows, label) {
    if (!rows.length || typeof XLSX === "undefined") return;
    const sheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Spools");
    const dateStamp = new Date().toISOString().slice(0, 10);
    const safeLabel = label.replace(/[&/\\?%*:|"<>]/g, "-");
    XLSX.writeFile(workbook, `${safeLabel} - ${dateStamp}.xlsx`);
  },

  /** Wires every STATIC chart export button (cohort doesn't depend on any on-page filter) - called once, after the page's data has loaded. */
  wireStatic(store) {
    const spools = store.spools;

    const wire = (exportName, label, rows) => {
      const button = document.querySelector(`[data-chart-export="${exportName}"]`);
      if (!button) return;
      button.disabled = !rows.length;
      button.onclick = () => this.exportRows(rows, label);
    };

    wire("funnel", "Stage Completion Funnel", this.funnelRows(spools));
    wire("bottleneck", "Median Days per Stage Transition", this.bottleneckRows(spools));
    wire("histogram", "Completed Spools by Total Cycle Time", this.histogramRows(spools));
    wire("aging", "Open Spools by Age Since RFP", this.agingRows(spools));
    wire("trend", "Median Cycle Time by RFP Week", this.trendRows(spools));

    wire("output-primer", "Primer Output", this.outputStageRows(spools, "primer_date", "Primer Date"));
    wire("output-pickling", "Pickling Output", this.outputStageRows(spools, "pickling_date", "Pickling Date"));
    wire("output-pdi_offer", "PDI Offer Output", this.outputStageRows(spools, "pdi_offer_date", "PDI Offer Date"));
    wire("output-pdi_clearance", "PDI Clearance Output", this.outputStageRows(spools, "pdi_clearance_date", "PDI Clearance Date"));
    wire("output-blasting", "Internal vs External Blasting", this.blastingRows(spools));

    wire("project-insight", "Median Cycle Time by Project", this.insightRows(spools, (s) => ({})));
    wire("material-insight", "Median Cycle Time by Material", this.insightRows(spools, (s) => ({ "Material": s.material })));
  },

  /** Output by Bay's export button depends on whichever process is currently selected on screen (PaintingCharts.bayOutputStage), so it's re-wired every time that chart re-renders - called from painting-charts.js -> renderBayOutputTrend(). */
  wireBayOutput(store, stageKey, stageDateField, stageLabel) {
    const button = document.querySelector('[data-chart-export="bay-output"]');
    if (!button) return;
    const rows = this.bayOutputRows(store.spools, stageDateField, `${stageLabel} Date`);
    button.disabled = !rows.length;
    button.onclick = () => this.exportRows(rows, `Output by Bay - ${stageLabel}`);
  },
};
