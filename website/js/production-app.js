/**
 * production-app.js
 * ---------------------------------------------------------
 * Entry point for the Production dashboard. Same loading order as
 * website/js/packing-app.js: published bundle -> last local upload
 * -> empty state. See production-data.js for details.
 */

const ProductionApp = {

  isLoading: false,

  async init() {
    this.setupUploadControl();
    this.setupClearControl();
    this.setupGlobalFilters();
    await this.loadInitialData();
  },

  showEmptyState() {
    document.getElementById("last-updated").textContent = "No data uploaded yet";
    document.getElementById("clear-data-btn").hidden = true;
    document.body.classList.add("is-ready");
  },

  renderAll(store) {
    this.currentStore = store;
    ProductionKPI.render(store.kpis);
    this.populateGlobalFilters(store);
    ProductionCharts.render(store);
    ProductionTable.init(store);

    document.getElementById("last-updated").textContent = ProductionKPI.formatTimestamp(store.generatedAt);
    document.getElementById("clear-data-btn").hidden = false;

    document.body.classList.add("is-ready");
  },

  setupGlobalFilters() {
    document.getElementById("metric-select").addEventListener("change", (e) => {
      ProductionFilters.setMetric(e.target.value);
      if (this.currentStore) ProductionCharts.render(this.currentStore);
    });

    document.getElementById("project-select").addEventListener("change", (e) => {
      const selected = Array.from(e.target.selectedOptions).map((o) => o.value);
      ProductionFilters.setProjects(selected);
      if (this.currentStore) ProductionCharts.render(this.currentStore);
    });

    document.getElementById("project-reset-btn").addEventListener("click", () => {
      document.getElementById("project-select").selectedIndex = -1;
      ProductionFilters.setProjects(null);
      if (this.currentStore) ProductionCharts.render(this.currentStore);
    });
  },

  populateGlobalFilters(store) {
    const metricSelect = document.getElementById("metric-select");
    metricSelect.innerHTML = "";
    (store.metrics || []).forEach((metric) => {
      const option = document.createElement("option");
      option.value = metric.key;
      option.textContent = metric.label;
      metricSelect.appendChild(option);
    });
    metricSelect.value = ProductionFilters.selectedMetricKey;

    const projectSelect = document.getElementById("project-select");
    projectSelect.innerHTML = "";
    (store.projects || []).forEach((project) => {
      const option = document.createElement("option");
      option.value = project;
      option.textContent = project;
      projectSelect.appendChild(option);
    });
  },

  async loadInitialData() {
    let published;
    try {
      published = await ProductionData.fetchPublished();
    } catch (error) {
      console.error(error);
      published = null;
    }

    if (published) {
      this.renderAll(published.store);
      this.showToast("Showing the latest published data");
      return;
    }

    let restored;
    try {
      restored = await ProductionData.restorePersisted();
    } catch (error) {
      console.error(error);
      restored = null;
    }

    if (!restored) {
      this.showEmptyState();
      return;
    }

    this.renderAll(restored.store);
    this.showToast(`Restored last upload (${restored.fileName})`);
  },

  setupUploadControl() {
    const fileInput = document.getElementById("upload-input");
    const uploadBtn = document.getElementById("upload-btn");

    uploadBtn.addEventListener("click", () => fileInput.click());

    fileInput.addEventListener("change", async () => {
      const file = fileInput.files && fileInput.files[0];
      fileInput.value = "";
      if (!file) return;
      await this.handleUpload(file);
    });
  },

  setupClearControl() {
    const clearBtn = document.getElementById("clear-data-btn");

    clearBtn.addEventListener("click", async () => {
      if (!confirm("Forget the production data saved in this browser? This only clears what's saved here - your production_data.json file on disk is untouched, and if a published copy is reachable it will be reloaded.")) {
        return;
      }
      try {
        await ProductionData.clearPersisted();
      } catch (error) {
        console.error(error);
      }
      window.location.reload();
    });
  },

  async handleUpload(file) {
    if (this.isLoading) return;
    this.isLoading = true;

    const uploadBtn = document.getElementById("upload-btn");
    uploadBtn.classList.add("is-loading");

    try {
      const store = await ProductionData.loadFromFile(file);
      this.renderAll(store);
      this.showToast(`Previewing ${file.name} (local only - refresh to see the published data again)`);
    } catch (error) {
      console.error(error);
      this.showToast(`Couldn't load "${file.name}": ${error.message}`, true);
    } finally {
      uploadBtn.classList.remove("is-loading");
      this.isLoading = false;
    }
  },

  showToast(message, isError = false) {
    const toast = document.getElementById("toast");
    toast.textContent = message;
    toast.style.background = isError ? "var(--status-critical)" : "rgba(14, 20, 28, 0.9)";
    toast.classList.add("is-visible");
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      toast.classList.remove("is-visible");
    }, isError ? 6000 : 2600);
  },
};

document.addEventListener("DOMContentLoaded", () => ProductionApp.init());
