/**
 * quality-data.js
 * ---------------------------------------------------------
 * Same loading strategy as website/js/production-data.js: try the
 * published bundle first (website/data/c20a675d03.json, written by
 * `python3 quality_main.py`), fall back to the last file uploaded
 * on this browser (IndexedDB), otherwise show the empty state.
 *
 * A separate IndexedDB database from the Projects, Production, and
 * Packing & Dispatch dashboards, so the "Upload Data" workflows
 * never collide.
 */

const QualityStorage = {

  DB_NAME: "quality-dashboard-db",
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

const QualityData = {

  store: {
    kpis: null,
    topReworkTypes: { items: [], total_rework_events: 0 },
    reworkByProject: [],
    openReworkHoldByProject: [],
    openReworkHoldExport: [],
    firstOfferSplit: null,
    reworkTrend: { day: [], week: [], month: [] },
    reworkCycles: [],
    reworkExport: null,
    welderPerformance: null,
    generatedAt: null,
  },

  hasData: false,

  /**
   * Throws on any real failure (network, bad status, bad JSON,
   * unreadable bundle) rather than returning null - the published
   * bundle should always be there on a working deployment, so any
   * failure here is a genuine error the caller should surface
   * distinctly from "nothing's been uploaded yet" (see
   * quality-app.js -> loadInitialData()/showEmptyState()).
   */
  async fetchPublished() {
    const response = await fetch(
      `${QUALITY_CONFIG.publishedDataUrl}?t=${Date.now()}`,
      { cache: "no-store" },
    );

    if (!response.ok) throw new Error(`Published quality data returned ${response.status}`);

    let bundle;
    try {
      bundle = await response.json();
    } catch (error) {
      throw new Error("Published quality data isn't valid JSON: " + error.message);
    }

    let store;
    try {
      store = this.loadFromBundle(bundle);
    } catch (error) {
      throw new Error("Published quality data is unreadable: " + error.message);
    }

    try {
      await QualityStorage.save(bundle, QUALITY_CONFIG.bundleFilename);
    } catch (error) {
      console.warn("Couldn't cache published quality data:", error);
    }

    return { store, generatedAt: bundle.generated_at };
  },

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
      await QualityStorage.save(bundle, file.name);
    } catch (error) {
      console.warn("Couldn't save quality data for next time:", error);
    }

    return store;
  },

  async restorePersisted() {
    let record;
    try {
      record = await QualityStorage.load();
    } catch (error) {
      console.warn("Couldn't read saved quality data:", error);
      return null;
    }

    if (!record) return null;

    try {
      const store = this.loadFromBundle(record.bundle);
      return { store, fileName: record.fileName, savedAt: record.savedAt };
    } catch (error) {
      console.warn("Saved quality data is unreadable:", error);
      return null;
    }
  },

  async clearPersisted() {
    await QualityStorage.clear();
  },

  loadFromBundle(bundle) {
    if (!bundle || typeof bundle !== "object") {
      throw new Error("Unrecognised data file.");
    }
    if (!bundle.kpis || !bundle.top_rework_types) {
      throw new Error(
        "This doesn't look like a quality data bundle " +
        "(expected kpis + top_rework_types)."
      );
    }

    this.store.kpis = bundle.kpis || null;
    this.store.topReworkTypes = bundle.top_rework_types || { items: [], total_rework_events: 0 };
    this.store.reworkByProject = bundle.rework_by_project || [];
    this.store.openReworkHoldByProject = bundle.open_rework_hold_by_project || [];
    this.store.openReworkHoldExport = bundle.open_rework_hold_export || [];
    this.store.firstOfferSplit = bundle.first_offer_split || null;
    this.store.reworkTrend = bundle.rework_trend || { day: [], week: [], month: [] };
    this.store.reworkCycles = bundle.rework_cycles || [];
    // Optional - null when the source workbook wasn't in this
    // run's Drive sync. The website hides that section / disables
    // its download button when null (see quality-app.js).
    this.store.reworkExport = bundle.rework_export || null;
    this.store.welderPerformance = bundle.welder_performance || null;
    this.store.generatedAt = bundle.generated_at || null;

    this.hasData = true;

    return this.store;
  },
};
