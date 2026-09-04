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

  // Internal vs External Blasting butterfly chart (2026-09-04,
  // corrected same day to the DEE logo's own two brand colours per
  // the person - "use the color code of DEE logo and some
  // complementing color for the opposite side"): --ice (DEE blue) for
  // Internal, the left wing; --ember (DEE red) for External, the
  // right wing - see css/styles.css's own "DEE red and DEE blue as
  // the two brand [colours]" comment. overIdealColor below happens to
  // be the same DEE-red hex - unrelated reuse, not a shared token,
  // since that one means "over the ideal" everywhere else on this
  // page and this one doesn't carry that meaning here. Plus a neutral
  // dark pill for the combined-total label drawn at the row's center.
  blastingColors: {
    internal: "#4333A5",
    external: "#A82E30",
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
