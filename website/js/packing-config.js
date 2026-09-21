/**
 * packing-config.js
 * ---------------------------------------------------------
 * Central configuration for the Packing & Dispatch dashboard -
 * mirrors website/js/config.js's role for the Projects dashboard.
 * Only paths, labels, and display colours live here - never a
 * business number (those are all pre-calculated in Python by
 * src/packing/pipeline.py).
 */

const PACKING_CONFIG = {

  bundleFilename: "dedb903311.json",

  // See config/packing_settings.json -> paths.website_data_folder /
  // publishing.publish_to_website, and src/packing/pipeline.py ->
  // run(). Every page load tries to fetch this first (packing-data.js
  // -> fetchPublished()) so a hosted copy of the site shows whatever
  // was last published, with no upload needed.
  publishedDataUrl: "data/dedb903311.json",

  // Status vocabulary + colour, matching src/packing/normalize.py ->
  // normalize_status() exactly. Grey->blue->green reads as a simple
  // progress ramp (not started -> in progress -> done), distinct
  // from the 9-stage palette on the Projects dashboard.
  statusOrder: ["Balance in Project", "Packed", "Dispatched"],
  statusColor: {
    "Balance in Project": "#8A8FA6",
    "Packed": "#4333A5",
    "Dispatched": "#1F8A55",
  },

  // A distinct colour per project, cycled if more projects than
  // colours - same qualitative palette as config.js -> projectPalette.
  // Re-stepped 2026-09-20 to match config.js -> projectPalette (same
  // dataviz-validator fixes).
  projectPalette: [
    "#0c2dd5", "#A82E30", "#00948a", "#b78612",
    "#6E5FD1", "#1F8A55", "#8A3E82", "#7b88d8",
  ],
  // Shared "overflow" colour for the 9th+ project in the Shipment
  // Bubble chart (js/packing-charts.js) - past the 8 identity colours
  // above, projects share this one muted tone instead of cycling back
  // to slot 1 and looking like a project it isn't.
  projectPaletteOverflow: "#5F6078",
};
