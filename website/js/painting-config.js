/**
 * painting-config.js
 * ---------------------------------------------------------
 * Central configuration for the Painting dashboard - mirrors
 * website/js/packing-config.js's role for the Packing & Dispatch
 * dashboard. Only paths, labels, and display colours live here -
 * every business number is pre-calculated in Python by
 * src/painting/pipeline.py.
 */

const PAINTING_CONFIG = {

  bundleFilename: "b3f7e6a1d4.json",

  // See config/painting_settings.json -> paths.website_data_folder /
  // publishing.publish_to_website, and src/painting/pipeline.py ->
  // run(). Every page load tries to fetch this first (painting-data.js
  // -> fetchPublished()) so a hosted copy of the site shows whatever
  // was last published, with no upload needed.
  publishedDataUrl: "data/b3f7e6a1d4.json",

  idealCycleDays: 4,

  stageColor: "#4333A5",
  idealLineColor: "#1F8A55",
  overIdealColor: "#A82E30",

  // Internal vs External Blasting butterfly chart (2026-09-04) - two
  // distinct, non-alarming colours (neither is idealLineColor/
  // overIdealColor, both of which already read as "good"/"bad"
  // elsewhere on this page) plus a neutral dark pill for the combined-
  // total label drawn at the zero line.
  blastingColors: {
    internal: "#4333A5",
    external: "#1E8F86",
    sumLabelBg: "#1B1A2E",
  },

  // A distinct colour per project, cycled if more projects than
  // colours - same qualitative palette as config.js -> projectPalette
  // / packing-config.js -> projectPalette.
  projectPalette: [
    "#4333A5", "#A82E30", "#1E8F86", "#D9A22D",
    "#6E5FD1", "#1F8A55", "#8A3E82", "#8A8FA6",
  ],
};
