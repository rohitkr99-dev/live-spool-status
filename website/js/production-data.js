/**
 * production-data.js
 * ---------------------------------------------------------
 * Same loading strategy as website/js/packing-data.js: try the
 * published bundle first (website/data/production_data.json,
 * written by `python3 production_main.py`), fall back to the last
 * file uploaded on this browser (IndexedDB), otherwise show the
 * empty state.
 *
 * A separate IndexedDB database from the Projects and Packing &
 * Dispatch dashboards, so the three "Upload Data" workflows never
 * collide.
 */

const ProductionStorage = {

  DB_NAME: "production-dashboard-db",
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

const ProductionData = {

  store: {
    categories: [],
    categoryDistribution: [],
    stageAgeing: {},
    idealVsActual: [],
    kpis: null,
    spools: [],
    generatedAt: null,
  },

  hasData: false,

  async fetchPublished() {
    let response;
    try {
      response = await fetch(
        `${PRODUCTION_CONFIG.publishedDataUrl}?t=${Date.now()}`,
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
      console.warn("Published production data isn't valid JSON:", error);
      return null;
    }

    let store;
    try {
      store = this.loadFromBundle(bundle);
    } catch (error) {
      console.warn("Published production data is unreadable:", error);
      return null;
    }

    try {
      await ProductionStorage.save(bundle, PRODUCTION_CONFIG.bundleFilename);
    } catch (error) {
      console.warn("Couldn't cache published production data:", error);
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
      await ProductionStorage.save(bundle, file.name);
    } catch (error) {
      console.warn("Couldn't save production data for next time:", error);
    }

    return store;
  },

  async restorePersisted() {
    let record;
    try {
      record = await ProductionStorage.load();
    } catch (error) {
      console.warn("Couldn't read saved production data:", error);
      return null;
    }

    if (!record) return null;

    try {
      const store = this.loadFromBundle(record.bundle);
      return { store, fileName: record.fileName, savedAt: record.savedAt };
    } catch (error) {
      console.warn("Saved production data is unreadable:", error);
      return null;
    }
  },

  async clearPersisted() {
    await ProductionStorage.clear();
  },

  loadFromBundle(bundle) {
    if (!bundle || typeof bundle !== "object") {
      throw new Error("Unrecognised data file.");
    }
    if (!Array.isArray(bundle.category_distribution) || !bundle.kpis) {
      throw new Error(
        "This doesn't look like a production_data.json bundle " +
        "(expected category_distribution + kpis)."
      );
    }

    this.store.categories = bundle.categories || [];
    this.store.categoryDistribution = bundle.category_distribution || [];
    this.store.stageAgeing = bundle.stage_ageing || {};
    this.store.idealVsActual = bundle.ideal_vs_actual || [];
    this.store.kpis = bundle.kpis || null;
    this.store.spools = bundle.spools || [];
    this.store.generatedAt = bundle.generated_at || null;

    this.hasData = true;

    return this.store;
  },
};
