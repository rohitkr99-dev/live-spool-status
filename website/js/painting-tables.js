/**
 * painting-tables.js
 * ---------------------------------------------------------
 * Sets up the seven DataTables (All Spools, Missing from Plan, Stuck/
 * Long Open, Extreme Cycle Time, Data Quality Issues, DPR/Painting
 * PDI Mismatch, In Plan but Not RFP in DPR). Sorting/filtering
 * happens entirely client-side over data already computed in Python -
 * no number here is derived, only formatted for display. Mirrors
 * website/js/packing-tables.js.
 */

const PaintingTables = {

  dt: {},

  typeAware(displayFn, plainFn) {
    return (data, type, row) => {
      if (type === "display") return displayFn(data, type, row);
      if (type === "filter" || type === "sort" || type === "type") return plainFn(data, type, row);
      return data;
    };
  },

  renderTextDisplay(value) {
    if (value === null || value === undefined || value === "") return '<span class="bool-no">—</span>';
    return value;
  },
  renderText() {
    return this.typeAware((d) => this.renderTextDisplay(d), (d) => (d === null || d === undefined ? "" : d));
  },

  renderDateDisplay(value) {
    if (!value) return '<span class="bool-no">—</span>';
    try {
      const date = new Date(`${value}T00:00:00`);
      if (isNaN(date.getTime())) return value;
      return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    } catch (e) {
      return value;
    }
  },
  renderDate() {
    return this.typeAware((d) => this.renderDateDisplay(d), (d) => d || "");
  },

  renderNumberDisplay(value) {
    if (value === null || value === undefined || value === "") return '<span class="bool-no">—</span>';
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);
  },
  renderNumber() {
    return this.typeAware((d) => this.renderNumberDisplay(d), (d) => (d === null || d === undefined ? "" : d));
  },

  renderDaysDisplay(value) {
    if (value === null || value === undefined) return '<span class="bool-no">—</span>';
    const cls = value > PAINTING_CONFIG.idealCycleDays ? "days-over" : value < 0 ? "days-negative" : "days-ok";
    return `<span class="${cls}">${value}d</span>`;
  },
  renderDays() {
    return this.typeAware((d) => this.renderDaysDisplay(d), (d) => (d === null || d === undefined ? "" : d));
  },

  renderBoolDisplay(value) {
    return value
      ? '<span class="status-pill" style="--pill-color:#1F8A55">Yes</span>'
      : '<span class="status-pill" style="--pill-color:#A82E30">No</span>';
  },
  renderBool() {
    return this.typeAware((d) => this.renderBoolDisplay(d), (d) => (d ? "Yes" : "No"));
  },

  renderProjectName() {
    return this.typeAware(
      (d, type, row) => {
        if (!d && !row.project_code) return '<span class="bool-no">—</span>';
        if (!d) return `<span class="project-name-cell">${row.project_code}</span>`;
        return `<span class="project-name-cell">${d}</span> <span class="project-code-suffix">(${row.project_code})</span>`;
      },
      (d, type, row) => d || row.project_code || "",
    );
  },

  exportButtons(title) {
    return [{
      extend: "excelHtml5",
      text: "Export to Excel",
      className: "btn-export",
      title,
      exportOptions: { columns: ":visible" },
    }];
  },

  destroyAll() {
    Object.keys(this.dt).forEach((key) => {
      if (this.dt[key]) {
        this.dt[key].destroy();
        delete this.dt[key];
      }
    });
  },

  // Every anomaly category except "not_in_dpr" is a spool already in
  // store.spools carrying that flag in its own `anomalies` array -
  // filtered here client-side rather than shipped as a second,
  // denormalized copy from Python (that doubled the bundle size - see
  // src/painting/summary.py -> build_anomalies() for why). The flags
  // themselves, and every field used below, are still 100% computed
  // in Python; this only re-partitions already-computed data.
  byFlag(spools, flag) {
    return spools.filter((s) => (s.anomalies || []).includes(flag));
  },

  renderAll(store) {
    const spools = store.spools;
    this.initAllTable(spools);
    this.initMissingTable(this.byFlag(spools, "missing_from_plan"));
    this.initStuckTable(
      [...this.byFlag(spools, "stuck_long_open")].sort((a, b) => (b.current_age_days || 0) - (a.current_age_days || 0)),
    );
    this.initExtremeTable(
      [...this.byFlag(spools, "extreme_cycle_time")].sort((a, b) => (b.total_cycle_days || 0) - (a.total_cycle_days || 0)),
    );
    this.initDataQualityTable([
      ...this.byFlag(spools, "out_of_order_dates").map((r) => ({ ...r, issue: "Out-of-order dates" })),
      ...this.byFlag(spools, "blasting_reqd_but_no_date").map((r) => ({ ...r, issue: "Blasting marked Required, but no date logged" })),
      ...this.byFlag(spools, "blasting_date_but_not_reqd").map((r) => ({ ...r, issue: "Blasting date logged, but marked Not Required" })),
      ...this.byFlag(spools, "external_blasted_no_primer").map((r) => ({ ...r, issue: "External Blasting done, but no Primer date" })),
      ...this.byFlag(spools, "coats_missing").map((r) => ({ ...r, issue: "No.of Coats not recorded" })),
    ]);
    this.initPdiMismatchTable(this.byFlag(spools, "dpr_painting_pdi_mismatch"));
    this.initNotInDprTable(store.anomalies.not_in_dpr || []);
    this.initExcludedTable(store.anomalies.excluded_already_packed || []);
    this.populateProjectFilter(spools);
    this.setupPaintingFilters(spools);
  },

  initAllTable(spools) {
    this.dt.all = $("#table-all").DataTable({
      data: spools,
      deferRender: true,
      pageLength: 25,
      lengthMenu: [10, 25, 50, 100, 250],
      order: [[11, "desc"]],
      dom: '<"dt-toolbar"B>frtip',
      buttons: this.exportButtons("All RFP-Done Spools"),
      scrollX: true,
      scrollCollapse: true,
      columns: [
        { data: "project_name", render: this.renderProjectName() },
        { data: "project_code", name: "project_code", visible: false },
        { data: "drawing_no", render: this.renderText() },
        { data: "spool_no", render: this.renderText() },
        { data: "in_painting_plan", className: "mono-cell", render: this.renderBool() },
        { data: "rfp_date", className: "mono-cell", render: this.renderDate() },
        { data: "internal_blasting_date", className: "mono-cell", render: this.renderDate() },
        { data: "external_blasting_date", className: "mono-cell", render: this.renderDate() },
        { data: "primer_date", className: "mono-cell", render: this.renderDate() },
        { data: "pickling_date", className: "mono-cell", render: this.renderDate() },
        { data: "pdi_offer_date", className: "mono-cell", render: this.renderDate() },
        { data: "pdi_clearance_date", className: "mono-cell", render: this.renderDate() },
        { data: "total_cycle_days", className: "mono-cell", render: this.renderDays() },
        { data: "painting_status", render: this.renderText() },
        // Hidden - not shown to the reader, only here so the filter
        // bar (setupPaintingFilters()) has a real DataTables column
        // to run column().search() / the numeric-range ext.search
        // plugin against, same technique as website/js/tables.js.
        { data: "material", name: "material", visible: false },
        { data: "item_category", name: "item_category", visible: false },
        { data: "current_age_days", name: "current_age_days", visible: false },
        { data: "is_complete", name: "is_complete", visible: false, render: this.renderBool() },
      ],
      language: { search: "", searchPlaceholder: "Search project, drawing, spool no…", info: "Showing _START_–_END_ of _TOTAL_ spools", emptyTable: "No spools loaded" },
    });

    this.dt.all.on("draw.dt", () => this.updatePaintingSelectionSummary());
  },

  initMissingTable(rows) {
    const withAge = rows.map((r) => ({
      ...r,
      days_since_rfp: r.rfp_date ? Math.round((Date.now() - new Date(`${r.rfp_date}T00:00:00`)) / 86400000) : null,
    }));
    this.dt.missing = $("#table-missing").DataTable({
      data: withAge,
      deferRender: true,
      pageLength: 25,
      lengthMenu: [10, 25, 50, 100, 250],
      order: [[4, "desc"]],
      dom: '<"dt-toolbar"B>frtip',
      buttons: this.exportButtons("Missing from Painting Plan"),
      scrollX: true,
      columns: [
        { data: "project_name", render: this.renderProjectName() },
        { data: "drawing_no", render: this.renderText() },
        { data: "spool_no", render: this.renderText() },
        { data: "rfp_date", className: "mono-cell", render: this.renderDate() },
        { data: "days_since_rfp", className: "mono-cell", render: this.renderNumber() },
        { data: "project_code", name: "project_code", visible: false },
      ],
      language: { search: "", searchPlaceholder: "Search project, drawing, spool no…", info: "Showing _START_–_END_ of _TOTAL_ spools", emptyTable: "None - every RFP-done spool is in the Painting Plan" },
    });
  },

  initStuckTable(rows) {
    this.dt.stuck = $("#table-stuck").DataTable({
      data: rows,
      deferRender: true,
      pageLength: 25,
      lengthMenu: [10, 25, 50, 100, 250],
      order: [[4, "desc"]],
      dom: '<"dt-toolbar"B>frtip',
      buttons: this.exportButtons("Stuck - Long Open"),
      scrollX: true,
      columns: [
        { data: "project_name", render: this.renderProjectName() },
        { data: "drawing_no", render: this.renderText() },
        { data: "spool_no", render: this.renderText() },
        { data: "rfp_date", className: "mono-cell", render: this.renderDate() },
        { data: "current_age_days", className: "mono-cell", render: this.renderDays() },
        { data: "internal_blasting_date", className: "mono-cell", render: this.renderDate() },
        { data: "external_blasting_date", className: "mono-cell", render: this.renderDate() },
        { data: "primer_date", className: "mono-cell", render: this.renderDate() },
        { data: "pdi_offer_date", className: "mono-cell", render: this.renderDate() },
        { data: "project_code", name: "project_code", visible: false },
      ],
      language: { search: "", searchPlaceholder: "Search project, drawing, spool no…", info: "Showing _START_–_END_ of _TOTAL_ spools", emptyTable: "None - no open spool is past the 8-day threshold" },
    });
  },

  initExtremeTable(rows) {
    this.dt.extreme = $("#table-extreme").DataTable({
      data: rows,
      deferRender: true,
      pageLength: 25,
      lengthMenu: [10, 25, 50, 100, 250],
      order: [[3, "desc"]],
      dom: '<"dt-toolbar"B>frtip',
      buttons: this.exportButtons("Extreme Cycle Time"),
      scrollX: true,
      columns: [
        { data: "project_name", render: this.renderProjectName() },
        { data: "drawing_no", render: this.renderText() },
        { data: "spool_no", render: this.renderText() },
        { data: "total_cycle_days", className: "mono-cell", render: this.renderDays() },
        { data: "rfp_to_internal_blasting_days", className: "mono-cell", render: this.renderDays() },
        { data: "rfp_to_external_blasting_days", className: "mono-cell", render: this.renderDays() },
        { data: "primer_to_next_days", className: "mono-cell", render: this.renderDays() },
        { data: "pdi_offer_to_clearance_days", className: "mono-cell", render: this.renderDays() },
        { data: "project_code", name: "project_code", visible: false },
      ],
      language: { search: "", searchPlaceholder: "Search project, drawing, spool no…", info: "Showing _START_–_END_ of _TOTAL_ spools", emptyTable: "None - no completed spool exceeded 15 working days" },
    });
  },

  initDataQualityTable(rows) {
    this.dt.dataquality = $("#table-dataquality").DataTable({
      data: rows,
      deferRender: true,
      pageLength: 25,
      lengthMenu: [10, 25, 50, 100, 250],
      order: [[0, "asc"]],
      dom: '<"dt-toolbar"B>frtip',
      buttons: this.exportButtons("Data Quality Issues"),
      scrollX: true,
      columns: [
        { data: "project_name", render: this.renderProjectName() },
        { data: "drawing_no", render: this.renderText() },
        { data: "spool_no", render: this.renderText() },
        { data: "issue", render: this.renderText() },
        {
          data: null,
          render: this.typeAware(
            (d, type, row) => {
              const parts = [];
              if (row.rfp_to_internal_blasting_days !== undefined) parts.push(`RFP→Int.Blast: ${row.rfp_to_internal_blasting_days ?? "—"}d`);
              if (row.rfp_to_external_blasting_days !== undefined) parts.push(`RFP→Ext.Blast: ${row.rfp_to_external_blasting_days ?? "—"}d`);
              if (row.primer_to_next_days !== undefined) parts.push(`Primer→Next: ${row.primer_to_next_days ?? "—"}d`);
              if (row.pdi_offer_to_clearance_days !== undefined) parts.push(`PDI Offer→Clearance: ${row.pdi_offer_to_clearance_days ?? "—"}d`);
              if (row.internal_blasting_reqd !== undefined) parts.push(`Reqd: ${row.internal_blasting_reqd ?? "—"}, Date: ${row.internal_blasting_date ?? "—"}`);
              return parts.join(" · ") || "—";
            },
            () => "",
          ),
        },
        { data: "project_code", name: "project_code", visible: false },
      ],
      language: { search: "", searchPlaceholder: "Search project, drawing, spool no…", info: "Showing _START_–_END_ of _TOTAL_ issues", emptyTable: "None found" },
    });
  },

  initPdiMismatchTable(rows) {
    this.dt.pdimismatch = $("#table-pdimismatch").DataTable({
      data: rows,
      deferRender: true,
      pageLength: 25,
      lengthMenu: [10, 25, 50, 100, 250],
      order: [[0, "asc"]],
      dom: '<"dt-toolbar"B>frtip',
      buttons: this.exportButtons("DPR vs Painting PDI Mismatch"),
      scrollX: true,
      columns: [
        { data: "project_name", render: this.renderProjectName() },
        { data: "drawing_no", render: this.renderText() },
        { data: "spool_no", render: this.renderText() },
        { data: "pdi_clearance_date", className: "mono-cell", render: this.renderDate() },
        { data: "pdi_status_acceptance_date", className: "mono-cell", render: this.renderDate() },
        { data: "project_code", name: "project_code", visible: false },
      ],
      language: { search: "", searchPlaceholder: "Search project, drawing, spool no…", info: "Showing _START_–_END_ of _TOTAL_ spools", emptyTable: "None found" },
    });
  },

  initNotInDprTable(rows) {
    this.dt.notindpr = $("#table-notindpr").DataTable({
      data: rows,
      deferRender: true,
      pageLength: 25,
      lengthMenu: [10, 25, 50, 100, 250],
      order: [[0, "asc"]],
      dom: '<"dt-toolbar"B>frtip',
      buttons: this.exportButtons("In Plan, Not RFP in DPR"),
      scrollX: true,
      columns: [
        { data: "project_code", render: this.renderText() },
        { data: "drawing_no", render: this.renderText() },
        { data: "spool_no", render: this.renderText() },
        { data: "status", render: this.renderText() },
        { data: "qc_rfp_date", className: "mono-cell", render: this.renderDate() },
      ],
      language: { search: "", searchPlaceholder: "Search project, drawing, spool no…", info: "Showing _START_–_END_ of _TOTAL_ spools", emptyTable: "None found" },
    });
  },

  initExcludedTable(rows) {
    this.dt.excluded = $("#table-excluded").DataTable({
      data: rows,
      deferRender: true,
      pageLength: 25,
      lengthMenu: [10, 25, 50, 100, 250],
      order: [[3, "desc"]],
      dom: '<"dt-toolbar"B>frtip',
      buttons: this.exportButtons("Excluded - Already Packed"),
      scrollX: true,
      columns: [
        { data: "project_name", render: this.renderProjectName() },
        { data: "drawing_no", render: this.renderText() },
        { data: "spool_no", render: this.renderText() },
        { data: "rfp_date", className: "mono-cell", render: this.renderDate() },
        { data: "packing_date", className: "mono-cell", render: this.renderDate() },
        { data: "dispatch_date", className: "mono-cell", render: this.renderDate() },
        { data: "project_code", name: "project_code", visible: false },
      ],
      language: { search: "", searchPlaceholder: "Search project, drawing, spool no…", info: "Showing _START_–_END_ of _TOTAL_ spools", emptyTable: "None found" },
    });
  },

  // ---------------------------------------------------------------
  // Shared project filter - applies to every table that carries a
  // project_code column (the "In Plan, Not RFP in DPR" table doesn't
  // have one named that way, so it's left out - see initNotInDprTable).
  // ---------------------------------------------------------------
  populateProjectFilter(spools) {
    const select = document.getElementById("table-project-filter");
    if (!select) return;

    const codes = [...new Set(spools.map((s) => s.project_code).filter(Boolean))].sort();
    const current = select.value;
    select.innerHTML = '<option value="__all__">All Projects</option>';
    codes.forEach((code) => {
      const row = spools.find((s) => s.project_code === code);
      const opt = document.createElement("option");
      opt.value = code;
      opt.textContent = row && row.project_name ? `${row.project_name} (${code})` : code;
      select.appendChild(opt);
    });

    if ([...select.options].some((o) => o.value === current)) {
      select.value = current;
    }
  },

  applyProjectFilter(projectCode) {
    const escape = $.fn.dataTable.util.escapeRegex;
    const value = !projectCode || projectCode === "__all__" ? "" : `^${escape(projectCode)}$`;
    // "all" is deliberately excluded here - the All RFP-Done Spools
    // tab has its own Project (multi-select) filter as part of
    // painting-filter-bar (setupPaintingFilters()), matching the
    // Projects dashboard's format; this toolbar dropdown only drives
    // the simpler single-project filter on the other tabs.
    ["missing", "excluded", "stuck", "extreme", "dataquality", "pdimismatch"].forEach((key) => {
      const table = this.dt[key];
      if (!table) return;
      table.column("project_code:name").search(value, true, false).draw();
    });
  },

  // ---------------------------------------------------------------
  // "All RFP-Done Spools" filter bar - same format as the Projects
  // dashboard's own filter bar (website/dashboard.html -> #filter-bar,
  // wired in website/js/tables.js -> setupFilters()): multi-select
  // dropdowns (OR-matched against one column each), single-select
  // dropdowns, min/max numeric ranges, a sort-by/direction pair, and
  // a Clear Filters button. Applies only to #table-all, matching how
  // the Projects page's filter bar only governs its own main table.
  // ---------------------------------------------------------------
  populateMultiSelect(selectId, values, labelFn) {
    const select = document.getElementById(selectId);
    if (!select) return;
    select.innerHTML = "";
    values.forEach((value) => {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = labelFn ? labelFn(value) : value;
      select.appendChild(opt);
    });
  },

  setupPaintingFilters(spools) {
    if (!this.dt.all) return;

    const distinct = (field) =>
      [...new Set(spools.map((s) => s[field]).filter((v) => v !== null && v !== undefined && v !== ""))].sort();

    this.populateMultiSelect(
      "pfilter-project",
      distinct("project_code"),
      (code) => {
        const row = spools.find((s) => s.project_code === code);
        return row && row.project_name ? `${row.project_name} (${code})` : code;
      },
    );
    this.populateMultiSelect("pfilter-material", distinct("material"));
    this.populateMultiSelect("pfilter-category", distinct("item_category"));
    this.populateMultiSelect("pfilter-status", distinct("painting_status"));

    const escape = $.fn.dataTable.util.escapeRegex;
    const multiSelectColumns = {
      "pfilter-project": "project_code:name",
      "pfilter-material": "material:name",
      "pfilter-category": "item_category:name",
      "pfilter-status": 13,
    };
    for (const [selectId, colRef] of Object.entries(multiSelectColumns)) {
      const select = document.getElementById(selectId);
      if (!select || select.dataset.wired) continue;
      select.dataset.wired = "true";
      select.addEventListener("change", () => {
        const selected = [...select.selectedOptions].map((o) => o.value);
        const search = selected.length ? `^(${selected.map((v) => escape(v)).join("|")})$` : "";
        this.dt.all.column(colRef).search(search, true, false).draw();
      });
    }

    const inPlanSelect = document.getElementById("pfilter-inplan");
    if (inPlanSelect && !inPlanSelect.dataset.wired) {
      inPlanSelect.dataset.wired = "true";
      inPlanSelect.addEventListener("change", () => {
        const value = inPlanSelect.value;
        this.dt.all.column(4).search(value ? `^${value}$` : "", true, false).draw();
      });
    }

    const completionSelect = document.getElementById("pfilter-completion");
    if (completionSelect && !completionSelect.dataset.wired) {
      completionSelect.dataset.wired = "true";
      completionSelect.addEventListener("change", () => {
        const value = completionSelect.value; // "" | "Completed" | "Open"
        const search = value === "" ? "" : (value === "Completed" ? "^Yes$" : "^No$");
        this.dt.all.column("is_complete:name").search(search, true, false).draw();
      });
    }

    this.setupPaintingNumericRangeFilters();

    const applySort = () => {
      const colIndex = parseInt(document.getElementById("psort-field").value, 10);
      const dir = document.getElementById("psort-direction").value;
      this.dt.all.order([colIndex, dir]).draw();
    };
    const sortField = document.getElementById("psort-field");
    const sortDirection = document.getElementById("psort-direction");
    if (sortField && !sortField.dataset.wired) {
      sortField.dataset.wired = "true";
      sortField.addEventListener("change", applySort);
    }
    if (sortDirection && !sortDirection.dataset.wired) {
      sortDirection.dataset.wired = "true";
      sortDirection.addEventListener("change", applySort);
    }

    const clearBtn = document.getElementById("painting-clear-filters");
    if (clearBtn && !clearBtn.dataset.wired) {
      clearBtn.dataset.wired = "true";
      clearBtn.addEventListener("click", () => {
        document.querySelectorAll("#painting-filter-bar select[multiple]").forEach((select) => {
          [...select.options].forEach((option) => (option.selected = false));
        });
        document.getElementById("pfilter-inplan").value = "";
        document.getElementById("pfilter-completion").value = "";
        document.getElementById("pfilter-cycle-min").value = "";
        document.getElementById("pfilter-cycle-max").value = "";
        document.getElementById("pfilter-age-min").value = "";
        document.getElementById("pfilter-age-max").value = "";
        document.getElementById("psort-field").value = "11";
        document.getElementById("psort-direction").value = "desc";
        this.dt.all.columns().search("").draw();
        this.dt.all.search("").draw();
        this.dt.all.order([11, "desc"]).draw();
      });
    }

    this.updatePaintingSelectionSummary();
  },

  /**
   * Excel-style numeric "between min and max" filtering for Cycle
   * Days (column 12) and Current Age (column 16, open spools only) -
   * same technique as website/js/tables.js ->
   * setupNumericRangeFilters(): one shared DataTables search plugin,
   * scoped to #table-all only, that combines with every dropdown/
   * global-search filter above rather than replacing them.
   */
  setupPaintingNumericRangeFilters() {
    if (this._paintingRangeFilterRegistered) return;
    this._paintingRangeFilterRegistered = true;

    const CYCLE_COL = 12;
    const AGE_COL = 16;

    $.fn.dataTable.ext.search.push((settings, searchData) => {
      if (settings.nTable.id !== "table-all") return true;

      const cycleMin = document.getElementById("pfilter-cycle-min").value;
      const cycleMax = document.getElementById("pfilter-cycle-max").value;
      const ageMin = document.getElementById("pfilter-age-min").value;
      const ageMax = document.getElementById("pfilter-age-max").value;

      const cycleDays = parseFloat(searchData[CYCLE_COL]);
      const currentAge = parseFloat(searchData[AGE_COL]);

      if (cycleMin !== "" && !(cycleDays >= parseFloat(cycleMin))) return false;
      if (cycleMax !== "" && !(cycleDays <= parseFloat(cycleMax))) return false;
      if (ageMin !== "" && !(currentAge >= parseFloat(ageMin))) return false;
      if (ageMax !== "" && !(currentAge <= parseFloat(ageMax))) return false;

      return true;
    });

    ["pfilter-cycle-min", "pfilter-cycle-max", "pfilter-age-min", "pfilter-age-max"].forEach((id) => {
      const el = document.getElementById(id);
      if (el && !el.dataset.wired) {
        el.dataset.wired = "true";
        el.addEventListener("input", () => this.dt.all.draw());
      }
    });
  },

  /**
   * Sum of Surface Area / Weight / Quantity across whatever rows the
   * current filters/search leave visible, plus the visible row count -
   * same "Selection Summary" pattern as website/js/tables.js ->
   * updateSelectionSummary(). Recomputed on every #table-all draw
   * (wired in initAllTable()) so it always matches what's on screen.
   */
  updatePaintingSelectionSummary() {
    if (!this.dt.all) return;
    const rows = this.dt.all.rows({ search: "applied" }).data().toArray();

    const countEl = document.getElementById("painting-selection-summary-count");
    if (countEl) {
      countEl.textContent = `${rows.length.toLocaleString("en-US")} spool${rows.length === 1 ? "" : "s"} selected`;
    }

    const totals = [
      { field: "surface_area", label: "Surface Area (m²)", decimals: 3 },
      { field: "weight", label: "Weight (kg)", decimals: 2 },
      { field: "quantity", label: "Qty", decimals: 0 },
    ].map(({ field, label, decimals }) => {
      const sum = rows.reduce((acc, row) => acc + (Number(row[field]) || 0), 0);
      const formatted = new Intl.NumberFormat("en-US", { maximumFractionDigits: decimals }).format(sum);
      return `${label}: <strong>${formatted}</strong>`;
    });

    const totalsEl = document.getElementById("painting-selection-summary-totals");
    if (totalsEl) totalsEl.innerHTML = totals.join(" &nbsp;·&nbsp; ");
  },
};
