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
    projectInsight: [],
    materialInsight: [],
    anomalies: {},
    spools: [],
    generatedAt: null,
    sourceFiles: null,
  },

  hasData: false,

  async fetchPublished() {
    let response;
    try {
      response = await fetch(
        `${PAINTING_CONFIG.publishedDataUrl}?t=${Date.now()}`,
        { cache: "no-store" },
      );
    } catch (error) {
      return null;
    }

    if (!response.ok) return null;

    let bundle;
    try {
      bundle = await response.json();
    } catch (error) {
      console.warn("Published painting data isn't valid JSON:", error);
      return null;
    }

    let store;
    try {
      store = this.loadFromBundle(bundle);
    } catch (error) {
      console.warn("Published painting data is unreadable:", error);
      return null;
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
