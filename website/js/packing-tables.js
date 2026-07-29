/**
 * packing-tables.js
 * ---------------------------------------------------------
 * Sets up the four DataTables (Project Summary, Shipments, Boxes,
 * Spools). Sorting/filtering/searching happens entirely client-side
 * over data that was already computed in Python - no number here is
 * derived, only formatted for display. Weight fields in the bundle
 * are already in MT, rounded to 2 decimals (src/packing/summary.py).
 * Mirrors website/js/tables.js.
 *
 * Every table also carries a `project_code` column (visible on some,
 * hidden on others) named "project_code" so the shared project
 * filter (#table-project-filter, wired in packing-app.js) can target
 * it uniformly via `table.column("project_code:name")`.
 */

const PackingTables = {

  dt: {},

  typeAware(displayFn, plainFn) {
    return (data, type) => {
      if (type === "display") return displayFn(data);
      if (type === "filter" || type === "sort" || type === "type") return plainFn(data);
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
      const date = new Date(value);
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
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
  },
  renderNumber() {
    return this.typeAware((d) => this.renderNumberDisplay(d), (d) => (d === null || d === undefined ? "" : d));
  },

  renderWeightMTDisplay(value) {
    if (value === null || value === undefined || value === "") return '<span class="bool-no">—</span>';
    return `${Number(value).toFixed(2)} MT`;
  },
  renderWeightMT() {
    return this.typeAware((d) => this.renderWeightMTDisplay(d), (d) => (d === null || d === undefined ? "" : d));
  },

  renderPercentDisplay(value) {
    if (value === null || value === undefined || value === "") return '<span class="bool-no">—</span>';
    return `${Number(value).toFixed(1)}%`;
  },
  renderPercent() {
    return this.typeAware((d) => this.renderPercentDisplay(d), (d) => (d === null || d === undefined ? "" : d));
  },

  renderStatusPill() {
    return this.typeAware(
      (status) => {
        const color = PACKING_CONFIG.statusColor[status] || "#8A8FA6";
        const safe = status || "—";
        return `<span class="status-pill" style="--pill-color:${color}">${safe}</span>`;
      },
      (status) => status || "",
    );
  },

  renderProjectName() {
    return this.typeAware(
      (d) => (d ? `<span class="project-name-cell">${d}</span>` : '<span class="bool-no">—</span>'),
      (d) => d || "",
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

  renderAll(store) {
    this.initProjectTable(store.projectSummary);
    this.initShipmentsTable(store.shipments);
    this.initBoxesTable(store.boxes);
    this.initSpoolsTable(store.spools);
    this.populateProjectFilter(store.projectSummary);
  },

  initProjectTable(projectSummary) {
    this.dt.project = $("#table-project").DataTable({
      data: projectSummary,
      deferRender: true,
      pageLength: 25,
      lengthMenu: [10, 25, 50, 100],
      order: [[10, "desc"]],
      dom: '<"dt-toolbar"B>frtip',
      buttons: this.exportButtons("Project Summary"),
      scrollX: true,
      columns: [
        { data: "project_name", render: this.renderProjectName() },
        { data: "project_code", name: "project_code" },
        { data: "total_spools", className: "mono-cell", render: this.renderNumber() },
        { data: "spools_pending", className: "mono-cell", render: this.renderNumber() },
        { data: "spools_packed", className: "mono-cell", render: this.renderNumber() },
        { data: "spools_dispatched", className: "mono-cell", render: this.renderNumber() },
        { data: "pct_dispatched", className: "mono-cell", render: this.renderPercent() },
        { data: "total_boxes", className: "mono-cell", render: this.renderNumber() },
        { data: "boxes_dispatched", className: "mono-cell", render: this.renderNumber() },
        { data: "total_shipments", className: "mono-cell", render: this.renderNumber() },
        { data: "total_weight_mt", className: "mono-cell", render: this.renderWeightMT() },
        { data: "weight_dispatched_mt", className: "mono-cell", render: this.renderWeightMT() },
        { data: "last_dispatch_date", className: "mono-cell", render: this.renderDate() },
      ],
      language: { search: "", searchPlaceholder: "Search project…", info: "Showing _START_–_END_ of _TOTAL_ projects", emptyTable: "No projects loaded" },
    });
  },

  initShipmentsTable(shipments) {
    this.dt.shipments = $("#table-shipments").DataTable({
      data: shipments,
      deferRender: true,
      pageLength: 25,
      lengthMenu: [10, 25, 50, 100],
      order: [[3, "desc"]],
      dom: '<"dt-toolbar"B>frtip',
      buttons: this.exportButtons("Shipments"),
      scrollX: true,
      columns: [
        { data: "container_no", render: this.renderText() },
        { data: "seal_no", render: this.renderText() },
        { data: "project_name", render: this.renderProjectName() },
        { data: "dispatch_date", className: "mono-cell", render: this.renderDate() },
        { data: "box_count", className: "mono-cell", render: this.renderNumber() },
        { data: "qty_total", className: "mono-cell", render: this.renderNumber() },
        { data: "weight_mt", className: "mono-cell", render: this.renderWeightMT() },
        { data: "project_code", name: "project_code", visible: false },
      ],
      language: { search: "", searchPlaceholder: "Search container, seal, project…", info: "Showing _START_–_END_ of _TOTAL_ shipments", emptyTable: "No shipments (no dispatched containers) yet" },
    });
  },

  initBoxesTable(boxes) {
    this.dt.boxes = $("#table-boxes").DataTable({
      data: boxes,
      deferRender: true,
      pageLength: 25,
      lengthMenu: [10, 25, 50, 100, 250],
      order: [[0, "asc"]],
      dom: '<"dt-toolbar"B>frtip',
      buttons: this.exportButtons("Boxes"),
      scrollX: true,
      columns: [
        { data: "project_name", render: this.renderProjectName() },
        { data: "project_code", name: "project_code" },
        { data: "box_no", render: this.renderText() },
        { data: "status", render: this.renderStatusPill() },
        { data: "qty", className: "mono-cell", render: this.renderNumber() },
        { data: "net_wt_mt", className: "mono-cell", render: this.renderWeightMT() },
        { data: "item_category", render: this.renderText() },
        { data: "container_no", render: this.renderText() },
        { data: "seal_no", render: this.renderText() },
        { data: "dispatch_date", className: "mono-cell", render: this.renderDate() },
      ],
      language: { search: "", searchPlaceholder: "Search project, box no…", info: "Showing _START_–_END_ of _TOTAL_ boxes", emptyTable: "No boxes loaded" },
    });
  },

  initSpoolsTable(spools) {
    this.dt.spools = $("#table-spools").DataTable({
      data: spools,
      deferRender: true,
      pageLength: 25,
      lengthMenu: [10, 25, 50, 100, 250],
      order: [[9, "desc"]],
      dom: '<"dt-toolbar"B>frtip',
      buttons: this.exportButtons("Spools"),
      scrollX: true,
      scrollCollapse: true,
      columns: [
        { data: "project_code", name: "project_code" },
        { data: "drawing_no", render: this.renderText() },
        { data: "spool_no", render: this.renderText() },
        { data: "box_no", render: this.renderText() },
        { data: "packing_status", render: this.renderStatusPill() },
        { data: "total_qty", className: "mono-cell", render: this.renderNumber() },
        { data: "total_wt_mt", className: "mono-cell", render: this.renderWeightMT() },
        { data: "pdi_date", className: "mono-cell", render: this.renderDate() },
        { data: "packing_date", className: "mono-cell", render: this.renderDate() },
        { data: "dispatched_date", className: "mono-cell", render: this.renderDate() },
        { data: "paint_system", render: this.renderText() },
        { data: "item_category", render: this.renderText() },
      ],
      language: { search: "", searchPlaceholder: "Search project, drawing, spool no…", info: "Showing _START_–_END_ of _TOTAL_ spools", emptyTable: "No spools loaded" },
    });
  },

  // ---------------------------------------------------------------
  // Shared project filter - one dropdown, applies to all 4 tables
  // ---------------------------------------------------------------
  populateProjectFilter(projectSummary) {
    const select = document.getElementById("table-project-filter");
    if (!select) return;

    const current = select.value;
    select.innerHTML = '<option value="__all__">All Projects</option>';
    [...projectSummary]
      .sort((a, b) => (a.project_code || "").localeCompare(b.project_code || ""))
      .forEach((p) => {
        const opt = document.createElement("option");
        opt.value = p.project_code;
        opt.textContent = p.project_name ? `${p.project_name} (${p.project_code})` : p.project_code;
        select.appendChild(opt);
      });

    if ([...select.options].some((o) => o.value === current)) {
      select.value = current;
    }
  },

  applyProjectFilter(projectCode) {
    const escape = $.fn.dataTable.util.escapeRegex;
    const value = !projectCode || projectCode === "__all__" ? "" : `^${escape(projectCode)}$`;
    ["project", "shipments", "boxes", "spools"].forEach((key) => {
      const table = this.dt[key];
      if (!table) return;
      table.column("project_code:name").search(value, true, false).draw();
    });
  },
};
