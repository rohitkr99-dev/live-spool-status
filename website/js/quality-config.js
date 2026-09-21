/**
 * quality-config.js
 * ---------------------------------------------------------
 * Central configuration for the Quality Assurance/Control dashboard -
 * mirrors website/js/production-config.js's role for Production.
 * Only paths, labels, and display colours live here - every number
 * on this page is pre-calculated in Python by src/quality/pipeline.py.
 */

const QUALITY_CONFIG = {

  bundleFilename: "c20a675d03.json",

  // See config/quality_settings.json -> paths.website_data_folder /
  // publishing.publish_to_website, and src/quality/pipeline.py ->
  // run(). Every page load tries to fetch this first
  // (quality-data.js -> fetchPublished()).
  publishedDataUrl: "data/c20a675d03.json",

  // Re-stepped 2026-09-20 (dataviz skill validator) - see
  // js/config.js's stageColor comment for the failures these values
  // shared (chroma floor / lightness band), fixed identically here.
  acceptColor: "#00948a",
  reworkColor: "#A82E30",
  otherColor: "#7b88d8",

  // One colour per rework-cycle bucket (chart 5) - green -> amber ->
  // red as repeat count climbs, so "3+" reads as the worst case at a
  // glance without needing the legend.
  cycleColor: {
    "0": "#1E8F86",
    "1": "#D9A22D",
    "2": "#C9622B",
    "3+": "#A82E30",
  },

  // Rework-type bar / trend line - one brand accent, "Others" tinted
  // neutral so it doesn't visually compete with the real top-10.
  typeColor: "#0c2dd5",
  othersColor: "#7b88d8",
  trendLineColor: "#0c2dd5",
  projectBarColor: "#0c2dd5",

  // Welder Performance section (src/quality/welder_performance.py)
  welderAcceptColor: "#00948a",
  welderRejectColor: "#A82E30",
  welderProjectBarColor: "#0c2dd5",
  welderProcessBarColor: "#0c2dd5",
  // Donut palette for Type of Defect. Cycling fixed 2026-09-20: past
  // 8 defect codes this used to repeat colours (a real collision, not
  // just a style nit - see renderWelderDefectType in
  // quality-charts.js, which now folds anything past slot 7 into an
  // "Others" bucket the same way renderTopReworkTypes already does).
  welderDefectPalette: [
    "#0c2dd5", "#A82E30", "#b78612", "#00948a", "#C9622B", "#2B6CB0", "#7C3AED",
  ],
  welderDefectOthersColor: "#7b88d8",

  // Two-part Y-axis labels (Project Name over "(Project Code)") -
  // same colours as website/js/config.js's SPOOL_STATUS_CONFIG,
  // duplicated here since the Quality dashboard doesn't load that
  // file/store.
  chartTextColor: "#55566E",
  chartTextColorStrong: "#1B1A2E",
};
