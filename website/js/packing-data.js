/**
 * packing-data.js
 * ---------------------------------------------------------
 * Same loading strategy as website/js/data.js: try the published
 * bundle first (website/data/packing_dispatch_data.json, written by
 * `python3 packing_main.py`), fall back to the last file uploaded on
 * this browser (IndexedDB), otherwise show the empty state.
 *
 * A separate IndexedDB database from the Projects dashboard's
 * spool-tracker-db, so the two "Upload Data" workflows never
 * collide.
 */

const PackingStorage = {

  DB_NAME: "packing-dispatch-db",
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

const PackingData = {

  store: {
    kpiSummary: null,
    statusBreakdown: [],
    projectSummary: [],
    packingTrend: null,
    dispatchTrend: null,
    shipments: [],
    spools: [],
    boxes: [],
    generatedAt: null,
    sourceFiles: [],
  },

  hasData: false,

  async fetchPublished() {
    let response;
    try {
      response = await fetch(
        `${PACKING_CONFIG.publishedDataUrl}?t=${Date.now()}`,
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
      console.warn("Published packing data isn't valid JSON:", error);
      return null;
    }

    let store;
    try {
      store = this.loadFromBundle(bundle);
    } catch (error) {
      console.warn("Published packing data is unreadable:", error);
      return null;
    }

    try {
      await PackingStorage.save(bundle, PACKING_CONFIG.bundleFilename);
    } catch (error) {
      console.warn("Couldn't cache published packing data:", error);
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
      await PackingStorage.save(bundle, file.name);
    } catch (error) {
      console.warn("Couldn't save packing data for next time:", error);
    }

    return store;
  },

  async restorePersisted() {
    let record;
    try {
      record = await PackingStorage.load();
    } catch (error) {
      console.warn("Couldn't read saved packing data:", error);
      return null;
    }

    if (!record) return null;

    try {
      const store = this.loadFromBundle(record.bundle);
      return { store, fileName: record.fileName, savedAt: record.savedAt };
    } catch (error) {
      console.warn("Saved packing data is unreadable:", error);
      return null;
    }
  },

  async clearPersisted() {
    await PackingStorage.clear();
  },

  loadFromBundle(bundle) {
    if (!bundle || typeof bundle !== "object") {
      throw new Error("Unrecognised data file.");
    }
    if (!bundle.kpi_summary || !Array.isArray(bundle.spools)) {
      throw new Error(
        "This doesn't look like a packing_dispatch_data.json bundle " +
        "(expected kpi_summary + spools)."
      );
    }

    this.store.kpiSummary = bundle.kpi_summary || null;
    this.store.statusBreakdown = bundle.status_breakdown || [];
    this.store.projectSummary = bundle.project_summary || [];
    this.store.packingTrend = bundle.packing_trend || { daily: [], weekly: [], monthly: [] };
    this.store.dispatchTrend = bundle.dispatch_trend || { daily: [], weekly: [], monthly: [] };
    this.store.shipments = bundle.shipments || [];
    this.store.spools = bundle.spools || [];
    this.store.boxes = bundle.boxes || [];
    this.store.generatedAt = bundle.generated_at || null;
    this.store.sourceFiles = bundle.source_files || [];

    this.hasData = true;

    return this.store;
  },

  /** Project Code -> Project Name, from project_summary. */
  projectNameByCode() {
    const lookup = {};
    for (const row of this.store.projectSummary) {
      if (row.project_code && row.project_name) lookup[row.project_code] = row.project_name;
    }
    return lookup;
  },

  projectLabel(projectCode) {
    const name = this.projectNameByCode()[projectCode];
    return name ? `${name} (${projectCode})` : projectCode;
  },
};
