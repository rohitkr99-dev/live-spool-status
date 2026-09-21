/**
 * painting-data.js
 * ---------------------------------------------------------
 * Same loading strategy as website/js/packing-data.js: fetch the
 * published bundle (website/data/<PAINTING_CONFIG.bundleFilename>,
 * written by `python3 painting_main.py`). No local-upload/IndexedDB
 * path on this page - unlike Packing & Dispatch or Projects, nobody
 * hand-uploads a Painting Weekly Plan workbook through the browser,
 * so there's nothing to persist besides what's published.
 */

const PaintingData = {

  store: {
    kpiSummary: null,
    stageFunnel: [],
    stageDurationStats: [],
    cycleTimeHistogram: [],
    agingBuckets: [],
    weeklyTrend: [],
    stageOutputTrend: {},
    blastingOutputTrend: {},
    bayOutputTrend: {},
    projectInsight: [],
    materialInsight: [],
    anomalies: {},
    spools: [],
    generatedAt: null,
    sourceFiles: null,
  },

  hasData: false,

  /**
   * Throws on any real failure (network, bad status, bad JSON,
   * unreadable bundle) rather than returning null - the published
   * bundle should always be there on a working deployment, so any
   * failure here is a genuine error the caller should surface
   * distinctly from "nothing's been uploaded yet" (see
   * painting-app.js -> loadInitialData()/showEmptyState()).
   */
  async fetchPublished() {
    const response = await fetch(
      `${PAINTING_CONFIG.publishedDataUrl}?t=${Date.now()}`,
      { cache: "no-store" },
    );

    if (!response.ok) throw new Error(`Published painting data returned ${response.status}`);

    let bundle;
    try {
      bundle = await response.json();
    } catch (error) {
      throw new Error("Published painting data isn't valid JSON: " + error.message);
    }

    let store;
    try {
      store = this.loadFromBundle(bundle);
    } catch (error) {
      throw new Error("Published painting data is unreadable: " + error.message);
    }

    return { store, generatedAt: bundle.generated_at };
  },

  loadFromBundle(bundle) {
    if (!bundle || typeof bundle !== "object") {
      throw new Error("Unrecognised data file.");
    }
    if (!bundle.kpi_summary || !Array.isArray(bundle.spools)) {
      throw new Error(
        "This doesn't look like a painting data bundle (expected kpi_summary + spools)."
      );
    }

    this.store.kpiSummary = bundle.kpi_summary || null;
    this.store.stageFunnel = bundle.stage_funnel || [];
    this.store.stageDurationStats = bundle.stage_duration_stats || [];
    this.store.cycleTimeHistogram = bundle.cycle_time_histogram || [];
    this.store.agingBuckets = bundle.aging_buckets || [];
    this.store.weeklyTrend = bundle.weekly_trend || [];
    this.store.stageOutputTrend = bundle.stage_output_trend || {};
    this.store.blastingOutputTrend = bundle.blasting_output_trend || {};
    this.store.bayOutputTrend = bundle.bay_output_trend || {};
    this.store.projectInsight = bundle.project_insight || [];
    this.store.materialInsight = bundle.material_insight || [];
    this.store.anomalies = bundle.anomalies || {};
    this.store.spools = bundle.spools || [];
    this.store.generatedAt = bundle.generated_at || null;
    this.store.sourceFiles = bundle.source_files || null;

    this.hasData = true;

    return this.store;
  },

  projectLabel(row) {
    return row.project_name ? `${row.project_name} (${row.project_code})` : row.project_code;
  },
};
