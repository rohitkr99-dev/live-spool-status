/**
 * tables.js
 * ---------------------------------------------------------
 * Sets up the three DataTables (All Spools, Oldest Spools,
 * Exceptions), the filter dropdowns above them, and Export to
 * Excel. Sorting/filtering/searching happens entirely client-side
 * over data that was already fully computed in Python - no spool's
 * Stage Age, Total Age, Current Stage, etc. is derived here.
 */

const SpoolTables = {

  dt: {},

  ageThresholdClass(days) {
    const t = SPOOL_STATUS_CONFIG.ageThresholds;
    if (days >= t.criticalDays) return "age-chip--critical";
    if (days >= t.warnDays) return "age-chip--warn";
    return "age-chip--ok";
  },

  renderAgeChip(days) {
    const value = days === null || days === undefined ? 0 : days;
    return `<span class="age-chip ${this.ageThresholdClass(value)}">${value}</span>`;
  },

  renderStagePill(stage) {
    const color = SPOOL_STATUS_CONFIG.stageColor[stage] || SPOOL_STATUS_CONFIG.defaultStageColor;
    const safe = stage === null || stage === undefined ? "—" : stage;
    return `<span class="status-pill" style="--pill-color:${color}">${safe}</span>`;
  },

  renderBool(value) {
    return value
      ? '<span class="bool-yes">Yes</span>'
      : '<span class="bool-no">No</span>';
  },

  renderTextDisplay(value) {
    if (value === null || value === undefined || value === "") {
      return '<span class="bool-no">—</span>';
    }
    return value;
  },

  renderDateDisplay(value) {
    if (value === null || value === undefined || value === "") {
      return '<span class="bool-no">—</span>';
    }
    try {
      const date = new Date(value);
      if (isNaN(date.getTime())) return value;
      return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    } catch (e) {
      return value;
    }
  },

  renderDate() {
    return this.typeAware(
      (d) => this.renderDateDisplay(d),
      (d) => (d === null || d === undefined ? "" : d),
    );
  },

  renderNumberDisplay(value) {
    if (value === null || value === undefined || value === "") {
      return '<span class="bool-no">—</span>';
    }
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
  },

  renderNumber() {
    return this.typeAware(
      (d) => this.renderNumberDisplay(d),
      (d) => (d === null || d === undefined ? "" : d),
    );
  },

  /**
   * Wraps a value so DataTables shows the pretty HTML for display,
   * but filters/sorts against the plain underlying value. Without
   * this, the anchored dropdown filters below would search against
   * raw HTML (e.g. "<span class=...>Yes</span>") and never match.
   */
  typeAware(displayFn, plainFn) {
    return (data, type) => {
      if (type === "display") return displayFn(data);
      if (type === "filter" || type === "sort" || type === "type") return plainFn(data);
      return data;
    };
  },

  renderText() {
    return this.typeAware(
      (d) => this.renderTextDisplay(d),
      (d) => (d === null || d === undefined ? "" : d),
    );
  },

  renderStage() {
    return this.typeAware(
      (d) => this.renderStagePill(d),
      (d) => d || "",
    );
  },

  renderBoolCell() {
    return this.typeAware(
      (d) => this.renderBool(d),
      (d) => (d ? "Yes" : "No"),
    );
  },

  /**
   * Project Name cell for the spool tables: shown bold, with a
   * smaller, muted look and feel matching how it appears on the
   * charts (see charts.js -> drawTwoPartYLabels).
   */
  renderProjectName() {
    return this.typeAware(
      (d) => (d === null || d === undefined || d === "" ? '<span class="bool-no">—</span>' : `<span class="project-name-cell">${d}</span>`),
      (d) => (d === null || d === undefined ? "" : d),
    );
  },

  exportButtons(title) {
    return [
      {
        extend: "excelHtml5",
        text: "Export to Excel",
        className: "btn-export",
        title,
        exportOptions: { columns: ":visible" },
      },
    ];
  },

  // -----------------------------------------------------

  initAllSpoolsTable(masterSpools) {

    this.dt.all = $("#table-all").DataTable({
      data: masterSpools,
      deferRender: true,
      pageLength: 25,
      lengthMenu: [10, 25, 50, 100, 250],
      order: [[11, "desc"]], // Total Age desc by default
      dom: '<"dt-toolbar"B>frtip',
      buttons: this.exportButtons("All Spools"),
      scrollX: true,
      scrollCollapse: true,
      columns: [
        { data: "Project Name", render: this.renderProjectName() },
        { data: "Project Code" },
        { data: "Drawing No" },
        { data: "Spool No" },
        { data: "Material", render: this.renderText() },
        { data: "Total Wt.", className: "mono-cell", render: this.renderNumber() },
        { data: "Group", render: this.renderText() },
        { data: "Week", render: this.renderText() },
        { data: "Current Stage", render: this.renderStage() },
        { data: "Status Message", render: this.renderText() },
        { data: "Stage Age", className: "mono-cell", render: (d, type) => (type === "display" ? this.renderAgeChip(d) : d) },
        { data: "Total Age", className: "mono-cell", render: (d, type) => (type === "display" ? this.renderAgeChip(d) : d) },
        { data: "Planned", render: this.renderBoolCell() },
        { data: "Completed", render: this.renderBoolCell() },
        { data: "Remarks", render: this.renderText() },
        { data: "Planned Start", className: "mono-cell", render: this.renderDate() },
        { data: "Actual Start Date", className: "mono-cell", render: this.renderDate() },
        { data: "Completion Date", className: "mono-cell", render: this.renderDate() },
        { data: "Inch Dia", className: "mono-cell", render: this.renderNumber() },
        { data: "Surface Area Out", className: "mono-cell", render: this.renderNumber() },
        { data: "Line History Stage", render: this.renderText() },
      ],
      language: {
        search: "",
        searchPlaceholder: "Search project, drawing, spool, material, group, remarks…",
        info: "Showing _START_–_END_ of _TOTAL_ spools",
        infoEmpty: "No spools match these filters",
        infoFiltered: "(filtered from _MAX_ total)",
        lengthMenu: "Show _MENU_ per page",
        emptyTable: "No spools loaded",
      },
    });

    this.dt.all.on("draw.dt", () => this.updateSelectionSummary());
    this.updateSelectionSummary();
  },

  /**
   * Sum of every configured numeric column (SPOOL_STATUS_CONFIG.
   * summableColumns) across whatever rows the current filters/search
   * leave visible, plus the visible row count. Recomputed on every
   * DataTables draw so it always matches what's on screen.
   */
  updateSelectionSummary() {

    if (!this.dt.all) return;

    const rows = this.dt.all.rows({ search: "applied" }).data().toArray();

    document.getElementById("selection-summary-count").textContent =
      `${rows.length.toLocaleString("en-US")} spool${rows.length === 1 ? "" : "s"} selected`;

    const totals = SPOOL_STATUS_CONFIG.summableColumns.map(({ field, label }) => {
      const sum = rows.reduce((acc, row) => acc + (Number(row[field]) || 0), 0);
      const formatted = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(sum);
      return `${label}: <strong>${formatted}</strong>`;
    });

    document.getElementById("selection-summary-totals").innerHTML = totals.join(" &nbsp;·&nbsp; ");
  },

  initOldestSpoolsTable(masterSpools) {

    const oldest = SpoolData.oldestSpools(25);

    this.dt.oldest = $("#table-oldest").DataTable({
      data: oldest,
      pageLength: 25,
      lengthMenu: [10, 25, 50],
      order: [[6, "desc"]],
      dom: '<"dt-toolbar"B>frtip',
      buttons: this.exportButtons("Oldest Spools"),
      columns: [
        { data: "Project Name", render: this.renderProjectName() },
        { data: "Project Code" },
        { data: "Drawing No" },
        { data: "Spool No" },
        { data: "Current Stage", render: this.renderStage() },
        { data: "Status Message", render: this.renderText() },
        { data: "Total Age", className: "mono-cell", render: (d, type) => (type === "display" ? this.renderAgeChip(d) : d) },
        { data: "Planned", render: this.renderBoolCell() },
      ],
      language: { search: "", searchPlaceholder: "Search…" },
    });
  },

  initExceptionsTable(exceptions) {

    document.getElementById("exceptions-count").textContent = exceptions.length;

    this.dt.exceptions = $("#table-exceptions").DataTable({
      data: exceptions,
      pageLength: 25,
      lengthMenu: [10, 25, 50, 100],
      dom: '<"dt-toolbar"B>frtip',
      buttons: this.exportButtons("Exceptions"),
      columns: [
        { data: "project_code" },
        { data: "drawing_no" },
        { data: "spool_no" },
        { data: "current_stage", render: this.renderStage() },
        { data: "detail" },
      ],
      language: {
        search: "",
        searchPlaceholder: "Search…",
        emptyTable: "No data-quality exceptions found — clean run.",
      },
    });
  },

  // -----------------------------------------------------
  // Filters
  // -----------------------------------------------------

  populateFilterDropdown(selectId, values) {
    const select = document.getElementById(selectId);
    for (const value of values) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      select.appendChild(option);
    }
  },

  /**
   * Same as populateFilterDropdown, but for Project Code values:
   * the option's value stays the Project Code (so filtering against
   * the Project Code column keeps working unchanged), while the
   * visible text is "Project Name (Project Code)".
   */
  populateProjectFilterDropdown(selectId, projectCodes) {
    const select = document.getElementById(selectId);
    for (const code of projectCodes) {
      const option = document.createElement("option");
      option.value = code;
      option.textContent = SpoolData.projectLabel(code);
      select.appendChild(option);
    }
  },

  setupFilters() {

    this.populateProjectFilterDropdown("filter-project", SpoolData.distinctValues("Project Code"));
    this.populateFilterDropdown("filter-week", this.sortedWeeks(SpoolData.distinctValues("Week")));
    this.populateFilterDropdown("filter-group", SpoolData.distinctValues("Group"));
    this.populateFilterDropdown("filter-material", SpoolData.distinctValues("Material"));
    this.populateFilterDropdown("filter-stage", SPOOL_STATUS_CONFIG.stageOrder.filter(
      (s) => SpoolData.distinctValues("Current Stage").includes(s)
    ));

    // Multi-select filters: each dropdown allows any number of
    // selected values, matched as an OR (regex alternation) against
    // that column - e.g. selecting "Week 3" and "Week 4" shows rows
    // matching either.
    const columnIndex = {
      "filter-project": 1,
      "filter-week": 7,
      "filter-group": 6,
      "filter-material": 4,
      "filter-stage": 8,
    };

    for (const [selectId, colIndex] of Object.entries(columnIndex)) {
      document.getElementById(selectId).addEventListener("change", (event) => {
        const selected = [...event.target.selectedOptions].map((o) => o.value);
        const search = selected.length
          ? `^(${selected.map((v) => this.escapeRegex(v)).join("|")})$`
          : "";
        this.dt.all.column(colIndex).search(search, true, false).draw();
      });
    }

    document.getElementById("filter-planning").addEventListener("change", (event) => {
      const value = event.target.value;
      const search = value === "" ? "" : (value === "Planned" ? "^Yes$" : "^No$");
      this.dt.all.column(12).search(search, true, false).draw();
    });

    document.getElementById("filter-status").addEventListener("change", (event) => {
      const value = event.target.value;
      const search = value === "" ? "" : (value === "Completed" ? "^Yes$" : "^No$");
      this.dt.all.column(13).search(search, true, false).draw();
    });

    // Numerical range filters for Stage Age / Total Age (both in
    // Days) - Excel-style "between min and max" filtering. Wired
    // once in setupNumericRangeFilters() via a shared
    // $.fn.dataTable.ext.search function so it applies on every
    // redraw alongside the dropdown/search filters above.
    this.setupNumericRangeFilters();

    // Custom sort: pick any column + direction instead of only
    // being able to click a header (handy on touch devices, and
    // makes the intent explicit).
    const applySort = () => {
      const colIndex = parseInt(document.getElementById("sort-field").value, 10);
      const dir = document.getElementById("sort-direction").value;
      this.dt.all.order([colIndex, dir]).draw();
    };
    document.getElementById("sort-field").addEventListener("change", applySort);
    document.getElementById("sort-direction").addEventListener("change", applySort);

    document.getElementById("clear-filters").addEventListener("click", () => {
      document.querySelectorAll("#filter-bar select[multiple]").forEach((select) => {
        [...select.options].forEach((option) => (option.selected = false));
      });
      document.getElementById("filter-planning").value = "";
      document.getElementById("filter-status").value = "";
      document.getElementById("filter-stage-age-min").value = "";
      document.getElementById("filter-stage-age-max").value = "";
      document.getElementById("filter-total-age-min").value = "";
      document.getElementById("filter-total-age-max").value = "";
      document.getElementById("sort-field").value = "11";
      document.getElementById("sort-direction").value = "desc";
      this.dt.all.columns().search("").draw();
      this.dt.all.search("").draw();
      this.dt.all.order([11, "desc"]).draw();
    });
  },

  /**
   * Excel-style numeric "between min and max" filtering for Stage
   * Age (column 10) and Total Age (column 11), both already plain
   * day counts (see renderAgeChip). Registered once as a shared
   * DataTables search plugin so it combines with every other filter
   * (dropdowns, global search) rather than replacing them.
   */
  setupNumericRangeFilters() {

    const AGE_COLUMNS = { stage: 10, total: 11 };

    $.fn.dataTable.ext.search.push((settings, searchData) => {

      if (settings.nTable.id !== "table-all") return true;

      const stageMin = document.getElementById("filter-stage-age-min").value;
      const stageMax = document.getElementById("filter-stage-age-max").value;
      const totalMin = document.getElementById("filter-total-age-min").value;
      const totalMax = document.getElementById("filter-total-age-max").value;

      const stageAge = parseFloat(searchData[AGE_COLUMNS.stage]);
      const totalAge = parseFloat(searchData[AGE_COLUMNS.total]);

      if (stageMin !== "" && !(stageAge >= parseFloat(stageMin))) return false;
      if (stageMax !== "" && !(stageAge <= parseFloat(stageMax))) return false;
      if (totalMin !== "" && !(totalAge >= parseFloat(totalMin))) return false;
      if (totalMax !== "" && !(totalAge <= parseFloat(totalMax))) return false;

      return true;
    });

    ["filter-stage-age-min", "filter-stage-age-max", "filter-total-age-min", "filter-total-age-max"]
      .forEach((id) => {
        document.getElementById(id).addEventListener("input", () => this.dt.all.draw());
      });
  },

  sortedWeeks(weeks) {
    return [...weeks].sort((a, b) => {
      const numA = parseInt(String(a).match(/\d+/), 10);
      const numB = parseInt(String(b).match(/\d+/), 10);
      if (isNaN(numA) && isNaN(numB)) return String(a).localeCompare(String(b));
      if (isNaN(numA)) return 1;
      if (isNaN(numB)) return -1;
      return numA - numB;
    });
  },

  escapeRegex(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  },

  // -----------------------------------------------------

  renderAll(store) {
    this.initAllSpoolsTable(store.masterSpools);
    this.initOldestSpoolsTable(store.masterSpools);
    this.initExceptionsTable(store.exceptions);
    this.setupFilters();
  },

  destroyAll() {
    for (const key of Object.keys(this.dt)) {
      if (this.dt[key]) {
        this.dt[key].destroy();
        delete this.dt[key];
      }
    }
    document.querySelectorAll(".spool-table tbody").forEach((tbody) => (tbody.innerHTML = ""));
    document.querySelectorAll("#filter-bar select").forEach((select) => {
      if (select.multiple) {
        select.innerHTML = "";
      } else {
        select.querySelectorAll("option:not(:first-child)").forEach((opt) => opt.remove());
      }
    });
  },
};
