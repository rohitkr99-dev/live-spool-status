/**
 * config.js
 * ---------------------------------------------------------
 * Central configuration: where the JSON files live, and the
 * stage/colour vocabulary used across the dashboard.
 *
 * Per the Master Specification (Rule 2/3): this dashboard never
 * calculates anything. Every value here is either a path, a label,
 * or a display colour - never a business number.
 */

const SPOOL_STATUS_CONFIG = {

  // The dashboard no longer fetches JSON over HTTP or auto-refreshes.
  // It stays exactly as it is until the person uploads a fresh
  // dashboard_data.json (written by `python3 main.py` to
  // processed/dashboard_data.json - see src/pipeline.py ->
  // write_dashboard_bundle()) via the "Upload Data" button.
  bundleFilename: "dashboard_data.json",

  // Where the "published" bundle lives, relative to index.html - see
  // config/settings.json -> paths.website_data_folder /
  // publishing.publish_to_website, and src/pipeline.py ->
  // write_dashboard_bundle(). Every page load tries to fetch this
  // first (see js/data.js -> fetchPublished()) so that anyone who
  // opens a hosted copy of this site (e.g. on GitHub Pages) sees
  // whatever was last published, with no upload needed on their end.
  // If nothing is reachable at this URL (e.g. running purely locally
  // with no publish step), the dashboard falls back to whatever was
  // last uploaded on THIS browser, exactly as before.
  publishedDataUrl: "data/dashboard_data.json",

  // Shared literals for Chart.js configs, which draw on a <canvas>
  // and so can't read CSS custom properties - kept here once instead
  // of repeated as string literals in every chart file. Match
  // website/css/styles.css -> --glass-border / --frost-dim / --frost
  // / --bg-2. See js/chartTheme.js for where these get applied.
  chartGridColor: "rgba(23, 21, 43, 0.08)",
  chartTextColor: "#55566E",
  chartTextColorStrong: "#1B1A2E",
  chartWellColor: "#FFFFFF",
  defaultStageColor: "#8A8FA6",

  // Stage sequence + colour, matching config/stages.json in the
  // Python pipeline. Kept here only for DISPLAY (colour, order) -
  // the actual stage assignment for each spool already happened in
  // Python and arrives as plain text in Current Stage.
  //
  // Each stage has its own hue, deliberately separated from the
  // Ageing Distribution bucket colours below and the general
  // --status-* tokens in styles.css - a colour meaning "Packing" here
  // never coincides with a colour meaning "31-60 days old" or
  // "warning" elsewhere, so a legend learned in one chart doesn't
  // mislead in another. Built around the DEE brand pair (red
  // #A82E30 / blue #4333A5), with supporting teal/amber/violet/green
  // hues bridging the two so all nine stages stay distinguishable.
  stageOrder: [
    "Production Order Not Released",
    "Fit-Up",
    "Welding",
    "PDQC",
    "Ready for Painting",
    "Under Painting",
    "Packing",
    "Dispatch",
    "Completed",
  ],

  stageColor: {
    "Production Order Not Released": "#8A8FA6",
    "Fit-Up": "#C9791F",
    "Welding": "#4333A5",
    "PDQC": "#1E8F86",
    "Ready for Painting": "#6E5FD1",
    "Under Painting": "#A82E30",
    "Packing": "#D9A22D",
    "Dispatch": "#8A3E82",
    "Completed": "#1F8A55",
  },

  // Stage-age thresholds purely for the colour chip in the table -
  // a display convenience, not a business rule. The underlying
  // number always comes straight from Stage Age in the JSON.
  ageThresholds: {
    warnDays: 14,
    criticalDays: 30,
  },

  // Ageing-distribution buckets for the "Spools by Age" dashboard.
  // Purely display buckets over the already-computed Total Age
  // field. Deliberately a sequential ramp (calm green -> alarmed
  // brand red) rather than reusing stage hues, so "getting older"
  // always reads the same way regardless of which stage a spool is
  // in.
  ageingBuckets: [
    { label: "0–7d", min: 0, max: 7, color: "#1F8A55" },
    { label: "8–14d", min: 8, max: 14, color: "#7DA82E" },
    { label: "15–30d", min: 15, max: 30, color: "#D9A22D" },
    { label: "31–60d", min: 31, max: 60, color: "#C9601F" },
    { label: "60d+", min: 61, max: Infinity, color: "#A82E30" },
  ],

  // Numeric fields summed above the All Spools table, updating as
  // filters are applied. Keys must match master_spools.json fields.
  summableColumns: [
    { field: "Inch Dia", label: "Total Inch Dia" },
    { field: "Total Wt.", label: "Total Weight" },
    { field: "Surface Area Out", label: "Total Surface Area" },
  ],

  // The Current Stage value a spool shows before its Production
  // Order has even been released - mirrors config/business_rules.json
  // -> prod_order_release.not_released_label exactly. Used to exclude
  // these spools from ageing-based dashboards (they have no anchor
  // date yet, so Total Age is always 0 for them).
  notReleasedLabel: "Production Order Not Released",

  // Metrics selectable above the Overview charts (Project Progress /
  // Weekly Progress / Ageing Distribution) and the Ageing
  // Distribution chart. "count" means "count of spools"; the rest
  // are fields already present on every master_spools.json record.
  overviewMetrics: [
    { key: "count", label: "Spools", unitLabel: "Spool count" },
    { key: "Inch Dia", label: "Inch Dia", unitLabel: "Inch Dia" },
    { key: "Surface Area Out", label: "Surface Area", unitLabel: "Surface Area" },
    { key: "Total Wt.", label: "Total Wt.", unitLabel: "Total Weight" },
  ],

  // The 7 fabrication stages, in sequence, with the master_spools.json
  // date field each one completes on - matches config/stages.json in
  // the Python pipeline exactly (sequence + date_field + display_name).
  // Used by the Stage Throughput dashboard (js/stageThroughput.js) to
  // know which already-computed date column to group each stage's
  // spools by; it introduces no new business logic of its own.
  stageSequence: [
    { name: "Fit-Up", dateField: "First Fit-Up" },
    { name: "Welding", dateField: "First Welding" },
    { name: "PDQC", dateField: "PDQC" },
    { name: "Ready for Painting", dateField: "RFP" },
    { name: "Under Painting", dateField: "PDI" },
    { name: "Packing", dateField: "Packing" },
    { name: "Dispatch", dateField: "Dispatch" },
  ],

  // A distinct colour per project, cycled if there are more projects
  // than colours - used by the Stage Ageing dashboard's "all
  // projects" grouped-bar view (js/stageAgeing.js). A qualitative
  // palette anchored on the DEE brand pair (blue, red) plus
  // supporting teal/amber/violet/green/plum/slate hues, so it reads
  // as clearly "categorical" rather than echoing the sequential
  // ageing-bucket ramp or the stage colours above.
  projectPalette: [
    "#4333A5", "#A82E30", "#1E8F86", "#D9A22D",
    "#6E5FD1", "#1F8A55", "#8A3E82", "#8A8FA6",
  ],
};
