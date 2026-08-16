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

  acceptColor: "#1E8F86",
  reworkColor: "#A82E30",
  otherColor: "#8A8FA6",

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
  typeColor: "#4333A5",
  othersColor: "#8A8FA6",
  trendLineColor: "#4333A5",
  projectBarColor: "#4333A5",

  // Welder Performance section (src/quality/welder_performance.py)
  welderAcceptColor: "#1E8F86",
  welderRejectColor: "#A82E30",
  welderProjectBarColor: "#4333A5",
  welderProcessBarColor: "#4333A5",
  // Donut palette for Type of Defect - cycles if there are more
  // defect codes than colours.
  welderDefectPalette: [
    "#4333A5", "#A82E30", "#D9A22D", "#1E8F86", "#C9622B", "#8A8FA6", "#2B6CB0", "#7C3AED",
  ],
};
