/**
 * app.js
 * ---------------------------------------------------------
 * Entry point. Wires up tabs and the "Upload Data" control, and
 * renders every section whenever fresh data becomes available.
 * This is the only module allowed to orchestrate the others.
 *
 * On every page load, in order:
 *   1. Try to fetch the published bundle (website/data/dashboard_data.json
 *      - see data.js -> fetchPublished()). This is what makes a
 *      hosted copy of this site (e.g. GitHub Pages) show the latest
 *      data to every visitor automatically, no upload needed.
 *   2. If that's not reachable, restore whatever was last uploaded
 *      on THIS browser (IndexedDB - see data.js -> SpoolStorage).
 *   3. Otherwise, show the empty state.
 *
 * "Upload Data" always works as a local override, e.g. to preview a
 * different file - but it's only remembered as the FALLBACK for step
 * 2 above; a page refresh always tries the published data again
 * first, so an old local preview can't get silently stuck showing
 * instead of the shared report.
 */

const SpoolApp = {

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

  /** Render every section from an already-loaded store - shared by
   * both a fresh upload and loading a published/restored one. */
  renderAll(store, isReload) {
    SpoolKPI.render(store.dashboardSummary);
    SpoolFabline.render(store.dashboardSummary);
    SpoolSCurve.render(store);
    SpoolCharts.render(store);
    SpoolStageThroughput.render(store);
    SpoolStageAgeing.render(store);

    if (isReload) {
      SpoolTables.destroyAll();
    }
    SpoolTables.renderAll(store);

    document.getElementById("last-updated").textContent =
      SpoolKPI.formatTimestamp(store.dashboardSummary.generated_at);
    document.getElementById("clear-data-btn").hidden = false;

    // Presentational only: lets styles.css run the staggered
    // entrance animation on the KPI/fabline/chart cards once real
    // data is on screen, instead of on the empty shell.
    document.body.classList.add("is-ready");
  },

  async loadInitialData() {

    let published;
    try {
      published = await SpoolData.fetchPublished();
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
      restored = await SpoolData.restorePersisted();
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
      fileInput.value = ""; // allow re-selecting the same filename later
      if (!file) return;
      await this.handleUpload(file);
    });
  },

  setupClearControl() {
    const clearBtn = document.getElementById("clear-data-btn");

    clearBtn.addEventListener("click", async () => {
      if (!confirm("Forget the dashboard data saved in this browser? This only clears what's saved here - your dashboard_data.json file on disk is untouched, and if a published copy is reachable it will be reloaded.")) {
        return;
      }
      try {
        await SpoolData.clearPersisted();
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

    const isReload = SpoolData.hasData;

    try {
      const store = await SpoolData.loadFromFile(file);

      this.renderAll(store, isReload);

      this.showToast(
        `Previewing ${file.name} (local only - refresh to see the published data again)`
      );

    } catch (error) {
      console.error(error);
      this.showToast(
        `Couldn't load "${file.name}": ${error.message}`,
        true,
      );
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

        // DataTables needs a nudge to recompute column widths for
        // a table that was hidden (display:none) during init.
        const key = tab.dataset.tab === "all" ? "all" : tab.dataset.tab;
        if (SpoolTables.dt[key]) {
          SpoolTables.dt[key].columns.adjust().draw(false);
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

document.addEventListener("DOMContentLoaded", () => SpoolApp.init());
