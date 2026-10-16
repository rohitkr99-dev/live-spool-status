/**
 * projectFilter.js
 * ---------------------------------------------------------
 * The Projects page's global project filter (2026-10-16): one
 * select between the KPI cards and the Fabrication Line that scopes
 * everything below it to a single project.
 *
 * It never calculates anything. It hands each section a "view" of
 * the loaded store - the same shape, with the spool rows, exceptions,
 * activity rows and the per-project figures the pipeline already
 * published (dashboard_summary.by_project - KPIs and Fabrication
 * Line - activity_metrics' project_code, the name-keyed hold charts)
 * narrowed to the chosen project. Stage Ageing and the S-Curve
 * already had their own project selector; the filter drives that one
 * instead of duplicating it. The KPI cards follow the filter too
 * (2026-10-16, per the person).
 */

const SpoolProjectFilter = {

  selected: "", // Project Code, or "" for all projects
  notice: "",

  setup(store) {
    const select = document.getElementById("global-project-filter");
    if (!select) return;

    const codes = SpoolData.distinctValues("Project Code");

    select.innerHTML = "";
    const all = document.createElement("option");
    all.value = "";
    all.setAttribute("data-i18n", "common.allProjects");
    all.textContent = window.I18N ? window.I18N.t("common.allProjects") : "All Projects";
    select.appendChild(all);

    for (const code of codes) {
      const option = document.createElement("option");
      option.value = code;
      option.textContent = SpoolData.projectLabel(code);
      select.appendChild(option);
    }

    if (!codes.includes(this.selected)) this.selected = "";
    select.value = this.selected;

    if (!select.dataset.wired) {
      select.dataset.wired = "true";
      select.addEventListener("change", () => {
        this.selected = select.value;
        SpoolApp.renderScoped();
      });
    }
  },

  /** The store as the sections below the filter should see it. */
  view(store) {
    this.notice = "";
    const code = this.selected;
    if (!code) {
      this.showNotice();
      return store;
    }

    const summary = store.dashboardSummary || {};
    const name = SpoolData.projectNameByCode()[code];
    const own = summary.by_project && summary.by_project[code];

    const scopedSummary = { ...summary };
    if (own) {
      scopedSummary.current_stage_distribution = own.current_stage_distribution;
      scopedSummary.rework_quantum = own.rework_quantum;
      if (own.kpis) scopedSummary.kpis = own.kpis;
    } else {
      // An older data file (e.g. a cached or uploaded copy) has no
      // per-project line; say so rather than show all-project numbers
      // under a project's name.
      this.notice = "Per-project key metrics and Fabrication Line are not in this data file yet.";
    }

    // The two hold charts are keyed by Project Name, not Code.
    const onlyThisProject = (byName) => {
      const out = {};
      if (byName && name && byName[name]) out[name] = byName[name];
      return out;
    };
    scopedSummary.hold_by_project_stage = onlyThisProject(summary.hold_by_project_stage);
    scopedSummary.material_hold_by_project = onlyThisProject(summary.material_hold_by_project);

    this.showNotice();

    return {
      ...store,
      dashboardSummary: scopedSummary,
      masterSpools: (store.masterSpools || []).filter((r) => r["Project Code"] === code),
      exceptions: (store.exceptions || []).filter((r) => r.project_code === code),
      activityMetrics: (store.activityMetrics || []).filter((r) => r.project_code === code),
    };
  },

  showNotice() {
    const note = document.getElementById("global-project-filter-note");
    if (!note) return;
    note.querySelector(".project-filter__warn")?.remove();
    if (this.notice) {
      const warn = document.createElement("span");
      warn.className = "project-filter__warn";
      warn.textContent = " " + this.notice;
      note.appendChild(warn);
    }
  },

  /**
   * Stage Ageing and the S-Curve share one project select. Point it
   * at this filter's project and lock it while a project is chosen
   * (changing it there would contradict the filter above).
   */
  syncStageSections() {
    const select = document.getElementById("stage-ageing-project");
    if (!select) return;

    const target = this.selected || "__all__";
    if (select.value !== target && [...select.options].some((o) => o.value === target)) {
      select.value = target;
      select.dispatchEvent(new Event("change"));
    }

    select.disabled = !!this.selected;
    select.title = this.selected ? "Set by the project filter at the top of the page" : "";
  },
};
