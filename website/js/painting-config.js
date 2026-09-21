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

  stageColor: "#0c2dd5", // re-stepped 2026-09-20, dataviz validator (see config.js)
  idealLineColor: "#1F8A55",
  overIdealColor: "#A82E30",

  // "Median Cycle Time by RFP Week" chart (painting-charts.js ->
  // renderTrend()), added 2026-09-07: plannedPendingColor is the
  // "pending PDI, by planned week" bar - same magenta/purple as
  // projectPalette's own 7th entry below, picked live with the person
  // against a preview (rejected an initial amber/yellow: "please use
  // some other color instead of yellowish"). medianTrendColor is the
  // median-cycle-days line's own colour, changed from overIdealColor
  // to a neutral grey per the person, again picked live against the
  // preview ("change it to greyish please") - deliberately NOT reusing
  // overIdealColor/stageColor, which carry other meanings elsewhere on
  // this page.
  plannedPendingColor: "#8A3E82",
  medianTrendColor: "#5F5E5A",

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
    internal: "#0c2dd5",
    external: "#A82E30",
    sumLabelBg: "#1B1A2E",
  },

  // A distinct colour per project, cycled if more projects than
  // colours - same qualitative palette as config.js -> projectPalette
  // / packing-config.js -> projectPalette. Re-stepped 2026-09-20 to
  // match (same dataviz-validator fixes; cycling gap still unfixed).
  projectPalette: [
    "#0c2dd5", "#A82E30", "#00948a", "#b78612",
    "#6E5FD1", "#1F8A55", "#8A3E82", "#7b88d8",
  ],
};
