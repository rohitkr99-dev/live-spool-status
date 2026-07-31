/**
 * production-config.js
 * ---------------------------------------------------------
 * Central configuration for the Production department dashboard -
 * mirrors website/js/packing-config.js's role for Packing &
 * Dispatch. Only paths, labels, and display colours live here -
 * every number on this page is pre-calculated in Python by
 * src/production/pipeline.py.
 */

const PRODUCTION_CONFIG = {

  bundleFilename: "production_data.json",

  // See config/production_settings.json -> paths.website_data_folder
  // / publishing.publish_to_website, and src/production/pipeline.py
  // -> run(). Every page load tries to fetch this first
  // (production-data.js -> fetchPublished()).
  publishedDataUrl: "data/production_data.json",

  // One colour per category, used consistently across every chart
  // on this page (pie slice, "target" bar, "actual" bar tint).
  categoryColor: {
    le8_cs_ss: "#4333A5",
    gt8_cs_ss: "#6E5FD1",
    le8_as: "#1E8F86",
    gt8_as: "#D9A22D",
    sb: "#A82E30",
  },

  targetColor: "#8A8FA6",
  actualColor: "#4333A5",
  actualDelayedColor: "#A82E30",
};
