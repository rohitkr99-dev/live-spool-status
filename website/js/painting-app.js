/**
 * painting-app.js
 * ---------------------------------------------------------
 * Entry point for the Painting dashboard. Loads the published bundle
 * only - see painting-data.js for why there's no local-upload path
 * here, unlike Packing & Dispatch or Projects.
 */

const PaintingApp = {

  async init() {
    this.setupTabs();
    this.setupProjectFilter();
    document.getElementById("retry-load-btn").addEventListener("click", () => location.reload());
    await this.loadInitialData();
  },

  /**
   * Painting has no local-upload fallback (see file header) - the
   * published bundle is the only source, so any failure to fetch it
   * always means "couldn't load," never "haven't uploaded yet."
   */
  showEmptyState(loadFailed) {
    document.getElementById("last-updated").textContent = loadFailed
      ? "Couldn't load dashboard data"
      : "No data published yet";
    document.getElementById("retry-load-btn").hidden = !loadFailed;
  },

  renderAll(store) {
    PaintingKPI.render(store.kpiSummary);
    PaintingPendingWork.render(store);
    PaintingCharts.render(store);
    PaintingTables.renderAll(store);
    PaintingChartExport.wireStatic(store);

    document.getElementById("last-updated").textContent = PaintingKPI.formatTimestamp(store.generatedAt);
    document.getElementById("retry-load-btn").hidden = true;
    const footer = document.getElementById("footer-generated");
    if (footer && store.sourceFiles) {
      const files = store.sourceFiles.painting_workbooks || [];
      footer.textContent = files.length ? `Source: ${files.join(", ")}` : "";
    }

    document.body.classList.add("is-ready");
  },

  async loadInitialData() {
    let published;
    let publishedFailed = false;
    try {
      published = await PaintingData.fetchPublished();
    } catch (error) {
      console.error(error);
      published = null;
      publishedFailed = true;
    }

    if (published) {
      this.renderAll(published.store);
      this.showToast("Showing the latest published data");
      return;
    }

    this.showEmptyState(publishedFailed);
  },

  setupProjectFilter() {
    const select = document.getElementById("table-project-filter");
    if (!select) return;
    select.addEventListener("change", () => {
      PaintingTables.applyProjectFilter(select.value);
    });
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

        if (PaintingTables.dt[tab.dataset.tab]) {
          PaintingTables.dt[tab.dataset.tab].columns.adjust().draw(false);
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

document.addEventListener("DOMContentLoaded", () => PaintingApp.init());
