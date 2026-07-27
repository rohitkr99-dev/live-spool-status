/**
 * packing-tables.js
 * ---------------------------------------------------------
 * Sets up the four DataTables (Project Summary, Shipments, Boxes,
 * Spools). Sorting/filtering/searching happens entirely client-side
 * over data that was already computed in Python - no number here is
 * derived, only formatted for display. Mirrors website/js/tables.js.
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

  renderNumberDisplay(value, decimals = 0) {
    if (value === null || value === undefined || value === "") return '<span class="bool-no">—</span>';
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: decimals }).format(value);
  },
  renderNumber(decimals = 0) {
    return this.typeAware((d) => this.renderNumberDisplay(d, decimals), (d) => (d === null || d === undefined ? "" : d));
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
        { data: "project_code" },
        { data: "total_spools", className: "mono-cell", render: this.renderNumber() },
        { data: "spools_pending", className: "mono-cell", render: this.renderNumber() },
        { data: "spools_packed", className: "mono-cell", render: this.renderNumber() },
        { data: "spools_dispatched", className: "mono-cell", render: this.renderNumber() },
        { data: "pct_dispatched", className: "mono-cell", render: this.typeAware((d) => `${this.renderNumberDisplay(d, 1)}%`, (d) => d ?? "") },
        { data: "total_boxes", className: "mono-cell", render: this.renderNumber() },
        { data: "boxes_dispatched", className: "mono-cell", render: this.renderNumber() },
        { data: "total_shipments", className: "mono-cell", render: this.renderNumber() },
        { data: "total_weight_kg", className: "mono-cell", render: this.renderNumber(1) },
        { data: "weight_dispatched_kg", className: "mono-cell", render: this.renderNumber(1) },
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
        { data: "weight_kg", className: "mono-cell", render: this.renderNumber(1) },
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
        { data: "project_code" },
        { data: "box_no", render: this.renderText() },
        { data: "status", render: this.renderStatusPill() },
        { data: "qty", className: "mono-cell", render: this.renderNumber() },
        { data: "net_wt", className: "mono-cell", render: this.renderNumber(1) },
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
        { data: "project_code" },
        { data: "drawing_no", render: this.renderText() },
        { data: "spool_no", render: this.renderText() },
        { data: "box_no", render: this.renderText() },
        { data: "packing_status", render: this.renderStatusPill() },
        { data: "total_qty", className: "mono-cell", render: this.renderNumber() },
        { data: "total_wt", className: "mono-cell", render: this.renderNumber(1) },
        { data: "pdi_date", className: "mono-cell", render: this.renderDate() },
        { data: "packing_date", className: "mono-cell", render: this.renderDate() },
        { data: "dispatched_date", className: "mono-cell", render: this.renderDate() },
        { data: "paint_system", render: this.renderText() },
        { data: "item_category", render: this.renderText() },
      ],
      language: { search: "", searchPlaceholder: "Search project, drawing, spool no…", info: "Showing _START_–_END_ of _TOTAL_ spools", emptyTable: "No spools loaded" },
    });
  },
};
