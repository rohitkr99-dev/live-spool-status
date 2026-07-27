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

  bundleFilename: "packing_dispatch_data.json",

  // See config/packing_settings.json -> paths.website_data_folder /
  // publishing.publish_to_website, and src/packing/pipeline.py ->
  // run(). Every page load tries to fetch this first (packing-data.js
  // -> fetchPublished()) so a hosted copy of the site shows whatever
  // was last published, with no upload needed.
  publishedDataUrl: "data/packing_dispatch_data.json",

  // Status vocabulary + colour, matching src/packing/normalize.py ->
  // normalize_status() exactly. Grey->blue->green reads as a simple
  // progress ramp (not started -> in progress -> done), distinct
  // from the 9-stage palette on the Projects dashboard.
  statusOrder: ["Pending / Under Packing", "Packed", "Dispatched"],
  statusColor: {
    "Pending / Under Packing": "#8A8FA6",
    "Packed": "#4333A5",
    "Dispatched": "#1F8A55",
  },

  // A distinct colour per project, cycled if more projects than
  // colours - same qualitative palette as config.js -> projectPalette.
  projectPalette: [
    "#4333A5", "#A82E30", "#1E8F86", "#D9A22D",
    "#6E5FD1", "#1F8A55", "#8A3E82", "#8A8FA6",
  ],
};
