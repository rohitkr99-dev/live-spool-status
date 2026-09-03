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
    await this.loadInitialData();
  },

  showEmptyState() {
    document.getElementById("last-updated").textContent = "No data published yet";
  },

  renderAll(store) {
    PaintingKPI.render(store.kpiSummary);
    PaintingCharts.render(store);
    PaintingTables.renderAll(store);

    document.getElementById("last-updated").textContent = PaintingKPI.formatTimestamp(store.generatedAt);
    const footer = document.getElementById("footer-generated");
    if (footer && store.sourceFiles) {
      const files = store.sourceFiles.painting_workbooks || [];
      footer.textContent = files.length ? `Source: ${files.join(", ")}` : "";
    }

    document.body.classList.add("is-ready");
  },

  async loadInitialData() {
    let published;
    try {
      published = await PaintingData.fetchPublished();
    } catch (error) {
      console.error(error);
      published = null;
    }

    if (published) {
      this.renderAll(published.store);
      this.showToast("Showing the latest published data");
      return;
    }

    this.showEmptyState();
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
