/**
 * packing-app.js
 * ---------------------------------------------------------
 * Entry point for the Packing & Dispatch dashboard. Same loading
 * order as website/js/app.js: published bundle -> last local upload
 * -> empty state. See packing-data.js for details.
 */

const PackingApp = {

  isLoading: false,

  async init() {
    this.setupTabs();
    this.setupUploadControl();
    this.setupClearControl();
    await this.loadInitialData();
  },

  showEmptyState() {
    document.getElementById("last-updated").textContent = "No data uploaded yet";
    document.getElementById("clear-data-btn").hidden = true;
  },

  renderAll(store, isReload) {
    PackingKPI.render(store.kpiSummary);
    PackingCharts.render(store);

    if (isReload) {
      PackingTables.destroyAll();
    }
    PackingTables.renderAll(store);

    document.getElementById("last-updated").textContent = PackingKPI.formatTimestamp(store.generatedAt);
    document.getElementById("clear-data-btn").hidden = false;

    document.body.classList.add("is-ready");
  },

  async loadInitialData() {
    let published;
    try {
      published = await PackingData.fetchPublished();
    } catch (error) {
      console.error(error);
      published = null;
    }

    if (published) {
      this.renderAll(published.store, false);
      this.showToast("Showing the latest published data");
      return;
    }

    let restored;
    try {
      restored = await PackingData.restorePersisted();
    } catch (error) {
      console.error(error);
      restored = null;
    }

    if (!restored) {
      this.showEmptyState();
      return;
    }

    this.renderAll(restored.store, false);
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
      if (!confirm("Forget the packing data saved in this browser? This only clears what's saved here - your packing_dispatch_data.json file on disk is untouched, and if a published copy is reachable it will be reloaded.")) {
        return;
      }
      try {
        await PackingData.clearPersisted();
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

    const isReload = PackingData.hasData;

    try {
      const store = await PackingData.loadFromFile(file);
      this.renderAll(store, isReload);
      this.showToast(`Previewing ${file.name} (local only - refresh to see the published data again)`);
    } catch (error) {
      console.error(error);
      this.showToast(`Couldn't load "${file.name}": ${error.message}`, true);
    } finally {
      uploadBtn.classList.remove("is-loading");
      this.isLoading = false;
    }
  },

  setupTabs() {
    const tabs = document.querySelectorAll(".tab");
    const panes = document.querySelectorAll(".table-pane");

    tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        tabs.forEach((t) => {
          t.classList.remove("is-active");
          t.setAttribute("aria-selected", "false");
        });
        tab.classList.add("is-active");
        tab.setAttribute("aria-selected", "true");

        panes.forEach((pane) => pane.classList.remove("is-active"));
        document.getElementById(`pane-${tab.dataset.tab}`).classList.add("is-active");

        if (PackingTables.dt[tab.dataset.tab]) {
          PackingTables.dt[tab.dataset.tab].columns.adjust().draw(false);
        }
      });
    });
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

document.addEventListener("DOMContentLoaded", () => PackingApp.init());
