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

  bundleFilename: "9c94afa0a9.json",

  // See config/production_settings.json -> paths.website_data_folder
  // / publishing.publish_to_website, and src/production/pipeline.py
  // -> run(). Every page load tries to fetch this first
  // (production-data.js -> fetchPublished()).
  publishedDataUrl: "data/9c94afa0a9.json",

  // One colour per category, used consistently across every chart
  // on this page (pie slice, "target" bar, "actual" bar tint).
  // Re-stepped 2026-09-20 (dataviz skill validator) - see
  // js/config.js's stageColor comment for the failures this fixes;
  // same base hues, same fix, shared across every dashboard that
  // reused these values.
  categoryColor: {
    le8_cs_ss: "#0c2dd5",
    gt8_cs_ss: "#6E5FD1",
    le8_as: "#00948a",
    gt8_as: "#b78612",
    sb: "#A82E30",
    loose: "#3E7CB1",
  },

  targetColor: "#7b88d8",
  actualColor: "#0c2dd5",
  actualDelayedColor: "#A82E30",

  // Matches css/production.css -> .production-table td.cell-delayed
  // / .cell-on-time, so the Delayed vs. In Time by Project chart uses
  // the exact same two colours as the spool table's own delay flag.
  delayedColor: "#A82E30",
  onTimeColor: "#00948a",

  // Material Handover section (src/production/material_handover.py).
  // Pending/On Hold reuses delayedColor's red family so "something's
  // not resolved" reads the same way it does everywhere else on this
  // page; department/material bars use a neutral tone since they're
  // not good/bad splits.
  mhPendingColor: "#A82E30",
  mhNeutralColor: "#6E5FD1",
  mhCleanColor: "#00948a",
  mhIssueColor: "#C9791F",

  // Backlog by Operation section (src/production/backlog.py) - a
  // 4-step severity ramp reused identically across all 5 backlog
  // charts, from "on time" (same teal as onTimeColor) through to
  // "worst" (same red as delayedColor), with two intermediate
  // ambers so the 4 buckets are visually distinguishable at a
  // glance without relying on the legend alone.
  backlogBucketColor: {
    "No Backlog": "#1E8F86",
    "0-7 Days": "#D9A22D",
    "8-30 Days": "#C9791F",
    "Beyond 30 Days": "#A82E30",
  },
};
