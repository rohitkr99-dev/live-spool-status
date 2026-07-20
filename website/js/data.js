/**
 * data.js
 * ---------------------------------------------------------
 * Holds the single in-memory store the whole dashboard reads from.
 * The dashboard does not fetch anything over the network except one
 * thing: on every page load, it tries the "published" bundle at
 * SPOOL_STATUS_CONFIG.publishedDataUrl (website/data/dashboard_data.json
 * - see src/pipeline.py -> write_dashboard_bundle(), produced by
 * `python3 main.py` whenever config/settings.json ->
 * publishing.publish_to_website is on). That's what makes a hosted
 * copy of this site show the latest data to every visitor with no
 * upload needed - see fetchPublished() below and app.js ->
 * loadInitialData().
 *
 * If nothing is published (or it's unreachable), the dashboard falls
 * back to whatever was last uploaded on THIS browser via IndexedDB
 * (see SpoolStorage below) - this is the whole experience for people
 * just using the local "Upload Data" workflow with nothing hosted.
 *
 * No calculation happens here beyond what's needed to load, persist,
 * and parse JSON - per the Master Specification's Rule 2/3, all real
 * numbers are pre-calculated in Python.
 */

/**
 * Thin wrapper around IndexedDB for saving/restoring the single most
 * recently uploaded dashboard_data.json bundle. Plain localStorage
 * isn't used because a real bundle (master_spools for a few thousand
 * spools, plus every summary) can run into several MB, well past
 * what localStorage reliably holds; IndexedDB has no such practical
 * ceiling.
 */
const SpoolStorage = {

  DB_NAME: "spool-tracker-db",
  DB_VERSION: 1,
  STORE_NAME: "bundles",
  KEY: "latest",

  openDatabase() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error("IndexedDB isn't available in this browser."));
        return;
      }
      const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(this.STORE_NAME)) {
          request.result.createObjectStore(this.STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },

  /** Save the raw parsed bundle, keyed by a single fixed key - there
   * is only ever one "current" upload saved. */
  async save(bundle, fileName) {
    const db = await this.openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, "readwrite");
      tx.objectStore(this.STORE_NAME).put(
        { bundle, fileName, savedAt: new Date().toISOString() },
        this.KEY,
      );
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  },

  /** Returns { bundle, fileName, savedAt } or null if nothing saved. */
  async load() {
    const db = await this.openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, "readonly");
      const request = tx.objectStore(this.STORE_NAME).get(this.KEY);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  },

  async clear() {
    const db = await this.openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, "readwrite");
      tx.objectStore(this.STORE_NAME).delete(this.KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  },
};

const SpoolData = {

  store: {
    masterSpools: [],
    dashboardSummary: null,
    projectSummary: [],
    weeklySummary: [],
    groupSummary: [],
    stageAgeingSummary: [],
    exceptions: [],
    activityMetrics: [],
  },

  hasData: false,

  /**
   * Try to load the "published" bundle - the copy src/pipeline.py's
   * write_dashboard_bundle() writes to website/data/dashboard_data.json
   * whenever publishing.publish_to_website is enabled. On a hosted
   * copy of this site (e.g. GitHub Pages), this is what makes the
   * dashboard show the latest data to EVERY visitor automatically,
   * with no upload needed on their end - whoever runs the pipeline
   * and pushes the updated file is the only one who has to do
   * anything.
   *
   * Returns { store, generatedAt } on success, or null if nothing is
   * reachable at that URL (no publish step configured, running from
   * a plain local file, offline, etc.) - the caller falls back to
   * restorePersisted() in that case, so plain local-upload usage is
   * completely unaffected.
   */
  async fetchPublished() {
    let response;
    try {
      // Cache-bust: hosts commonly cache static JSON aggressively,
      // which would otherwise mean a fresh publish doesn't show up
      // for visitors until their browser's cache happens to expire.
      response = await fetch(
        `${SPOOL_STATUS_CONFIG.publishedDataUrl}?t=${Date.now()}`,
        { cache: "no-store" },
      );
    } catch (error) {
      return null; // offline, no host, CORS on file://, etc.
    }

    if (!response.ok) return null;

    let bundle;
    try {
      bundle = await response.json();
    } catch (error) {
      console.warn("Published dashboard data isn't valid JSON:", error);
      return null;
    }

    let store;
    try {
      store = this.loadFromBundle(bundle);
    } catch (error) {
      console.warn("Published dashboard data is unreadable:", error);
      return null;
    }

    // Cache it as the fallback for next time (e.g. offline, or this
    // URL becomes unreachable) - same cache a manual upload writes to.
    try {
      await SpoolStorage.save(bundle, SPOOL_STATUS_CONFIG.bundleFilename);
    } catch (error) {
      console.warn("Couldn't cache published dashboard data:", error);
    }

    return { store, generatedAt: bundle.generated_at };
  },

  /**
   * Read a File (from an <input type="file"> or drag-and-drop) as
   * text, parse it as the dashboard_data.json bundle, and persist it
   * to IndexedDB so it survives a page refresh.
   */
  async loadFromFile(file) {
    const text = await file.text();
    let bundle;
    try {
      bundle = JSON.parse(text);
    } catch (error) {
      throw new Error("That file isn't valid JSON.");
    }

    const store = this.loadFromBundle(bundle);

    try {
      await SpoolStorage.save(bundle, file.name);
    } catch (error) {
      // Persistence is a nice-to-have, not a hard requirement - the
      // dashboard already works for this session even if saving it
      // for next time failed (e.g. private browsing mode).
      console.warn("Couldn't save dashboard data for next time:", error);
    }

    return store;
  },

  /**
   * On page load, restore whatever was saved from the last upload,
   * if anything. Returns { store, fileName, savedAt } or null.
   */
  async restorePersisted() {
    let record;
    try {
      record = await SpoolStorage.load();
    } catch (error) {
      console.warn("Couldn't read saved dashboard data:", error);
      return null;
    }

    if (!record) return null;

    try {
      const store = this.loadFromBundle(record.bundle);
      return { store, fileName: record.fileName, savedAt: record.savedAt };
    } catch (error) {
      // Saved data no longer matches the expected shape (e.g. an
      // older bundle format) - treat it as if nothing were saved.
      console.warn("Saved dashboard data is unreadable:", error);
      return null;
    }
  },

  /** Forget the saved upload - used by the "Clear Saved Data" button. */
  async clearPersisted() {
    await SpoolStorage.clear();
  },

  /**
   * Populate the store from an already-parsed dashboard_data.json
   * bundle object. Validates that it looks like the expected shape
   * before replacing the store, so a bad upload doesn't blank the
   * dashboard.
   */
  loadFromBundle(bundle) {

    if (!bundle || typeof bundle !== "object") {
      throw new Error("Unrecognised data file.");
    }

    if (!Array.isArray(bundle.master_spools) || !bundle.dashboard_summary) {
      throw new Error(
        "This doesn't look like a dashboard_data.json bundle " +
        "(expected master_spools + dashboard_summary)."
      );
    }

    this.store.masterSpools = bundle.master_spools || [];
    this.store.dashboardSummary = bundle.dashboard_summary || null;
    this.store.projectSummary = bundle.project_summary || [];
    this.store.weeklySummary = bundle.weekly_summary || [];
    this.store.groupSummary = bundle.group_summary || [];
    this.store.stageAgeingSummary = bundle.stage_ageing_summary || [];
    this.store.exceptions = bundle.exceptions || [];
    this.store.activityMetrics = bundle.activity_metrics || [];

    this.hasData = true;

    return this.store;
  },

  /**
   * Oldest N spools, sorted by Total Age descending.
   * A plain re-sort of already-computed data - not a calculation.
   */
  oldestSpools(limit = 25) {
    return [...this.store.masterSpools]
      .sort((a, b) => (b["Total Age"] || 0) - (a["Total Age"] || 0))
      .slice(0, limit);
  },

  /**
   * Distinct values for a field, for populating filter dropdowns.
   */
  distinctValues(field) {
    const values = new Set();
    for (const row of this.store.masterSpools) {
      const value = row[field];
      if (value !== null && value !== undefined && value !== "") {
        values.add(value);
      }
    }
    return [...values].sort((a, b) => String(a).localeCompare(String(b)));
  },
};
