/**
 * production-table.js
 * ---------------------------------------------------------
 * The spool list table: one row per spool, with a multi-select
 * filter on every column and a live subtotal row reflecting
 * whatever combination of column filters is currently applied.
 * Independent of the metric/Project filters above the charts - see
 * the module docstring in production-filters.js.
 *
 * Every value shown is already computed in Python
 * (src/production/summary.py); this file only renders, filters,
 * paginates, and subtotals it.
 */

const ProductionTable = {

  PAGE_SIZE: 50,
  currentPage: 1,
  store: null,

  // Column definitions - `key` for the identifier/text/number
  // columns comes straight off each spool row; `stageKey` columns
  // instead read row.stage_days[stageKey].
  COLUMNS: [
    { key: "project_code", label: "Project Code", type: "text" },
    { key: "drawing_no", label: "Drawing No", type: "text" },
    { key: "spool_no", label: "Spool No", type: "text" },
    { key: "category", label: "Category", type: "text" },
    { key: "status", label: "Status", type: "text" },
    { key: "delay_status", label: "On Time / Delayed", type: "text" },
    { key: "material", label: "Material", type: "text" },
    { key: "spool_size", label: "Spool Size", type: "number" },
    { key: "inch_dia", label: "Inch Dia", type: "number" },
    { key: "quantity", label: "Quantity", type: "number", subtotal: "sum" },
    { key: "weight", label: "Weight", type: "number", subtotal: "sum" },
    { key: "surface_area", label: "Surface Area", type: "number", subtotal: "sum" },
    { key: "days_welding_finish", stageKey: "welding_finish", label: "Welding Finish (d)", type: "day" },
    { key: "days_pdqc", stageKey: "pdqc", label: "PDQC (d)", type: "day" },
    { key: "days_release_for_painting", stageKey: "release_for_painting", label: "Release for Painting (d)", type: "day" },
    { key: "days_pdi_clearance", stageKey: "pdi_clearance", label: "PDI Clearance (d)", type: "day" },
    { key: "days_packed", stageKey: "packed", label: "Packed (d)", type: "day" },
  ],

  init(store) {
    this.store = store;
    this.currentPage = 1;
    this.buildHeader();
    this.render();

    document.getElementById("table-clear-filters-btn").addEventListener("click", () => {
      ProductionFilters.clearTableFilters();
      this.currentPage = 1;
      this.render();
    });

    document.addEventListener("click", (event) => {
      const popover = document.getElementById("table-filter-popover");
      if (!popover.hidden && !popover.contains(event.target) && !event.target.closest(".table-filter-btn")) {
        popover.hidden = true;
      }
    });
  },

  rawValue(row, column) {
    return column.stageKey ? (row.stage_days ? row.stage_days[column.stageKey] : null) : row[column.key];
  },

  columnFilterValue(row, column) {
    const value = this.rawValue(row, column);
    if (value === null || value === undefined || value === "") return "(blank)";
    return String(value);
  },

  distinctValuesFor(column) {
    const values = new Set();
    this.store.spools.forEach((row) => values.add(this.columnFilterValue(row, column)));
    const list = Array.from(values);
    return column.type === "number" || column.type === "day"
      ? list.sort((a, b) => (a === "(blank)" ? -1 : b === "(blank)" ? 1 : Number(a) - Number(b)))
      : list.sort();
  },

  filteredSpools() {
    const filters = ProductionFilters.tableColumnFilters;
    const keys = Object.keys(filters);
    if (keys.length === 0) return this.store.spools;
    const columnsByKey = {};
    this.COLUMNS.forEach((c) => { columnsByKey[c.key] = c; });
    return this.store.spools.filter((row) =>
      keys.every((key) => filters[key].has(this.columnFilterValue(row, columnsByKey[key])))
    );
  },

  formatValue(row, column) {
    const value = this.rawValue(row, column);
    if (value === null || value === undefined || value === "") return "\u2013";
    if (column.type === "number") {
      return Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
    }
    if (column.type === "day") {
      return `${value}`;
    }
    return String(value);
  },

  buildHeader() {
    const headRow = document.getElementById("spool-table-head-row");
    headRow.innerHTML = "";
    this.COLUMNS.forEach((column) => {
      const th = document.createElement("th");
      const active = ProductionFilters.tableColumnFilters[column.key] ? " is-filtered" : "";
      th.innerHTML = `
        <span class="table-th__label">${column.label}</span>
        <button type="button" class="table-filter-btn${active}" data-column="${column.key}" title="Filter ${column.label}">
          <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path d="M2 3h12l-4.5 5.5v4L7 14v-5.5L2 3z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>
        </button>
      `;
      th.querySelector(".table-filter-btn").addEventListener("click", (e) => {
        e.stopPropagation();
        this.openFilterPopover(column, e.currentTarget);
      });
      headRow.appendChild(th);
    });
  },

  openFilterPopover(column, anchorEl) {
    const popover = document.getElementById("table-filter-popover");
    const values = this.distinctValuesFor(column);
    const selected = ProductionFilters.tableColumnFilters[column.key];

    popover.innerHTML = `
      <div class="table-filter-popover__search">
        <input type="text" placeholder="Search values..." id="table-filter-search">
      </div>
      <div class="table-filter-popover__list" id="table-filter-list"></div>
      <div class="table-filter-popover__actions">
        <button type="button" class="btn btn--ghost btn--tiny" id="table-filter-clear">Clear</button>
        <button type="button" class="btn btn--primary btn--tiny" id="table-filter-apply">Apply</button>
      </div>
    `;

    const listEl = popover.querySelector("#table-filter-list");
    const renderList = (filterText) => {
      listEl.innerHTML = "";
      values
        .filter((v) => !filterText || v.toLowerCase().includes(filterText.toLowerCase()))
        .forEach((value) => {
          const id = `tf-${column.key}-${value}`.replace(/[^a-zA-Z0-9_-]/g, "_");
          const checked = selected ? selected.has(value) : false;
          const label = document.createElement("label");
          label.className = "table-filter-popover__option";
          label.innerHTML = `<input type="checkbox" value="${value}" ${checked ? "checked" : ""}> <span>${value}</span>`;
          listEl.appendChild(label);
        });
    };
    renderList("");

    popover.querySelector("#table-filter-search").addEventListener("input", (e) => renderList(e.target.value));

    popover.querySelector("#table-filter-clear").addEventListener("click", () => {
      ProductionFilters.setColumnFilter(column.key, null);
      popover.hidden = true;
      this.buildHeader();
      this.currentPage = 1;
      this.render();
    });

    popover.querySelector("#table-filter-apply").addEventListener("click", () => {
      const checked = Array.from(listEl.querySelectorAll("input[type=checkbox]:checked")).map((i) => i.value);
      ProductionFilters.setColumnFilter(column.key, checked);
      popover.hidden = true;
      this.buildHeader();
      this.currentPage = 1;
      this.render();
    });

    const rect = anchorEl.getBoundingClientRect();
    popover.style.top = `${rect.bottom + window.scrollY + 4}px`;
    popover.style.left = `${Math.max(8, rect.left + window.scrollX - 180)}px`;
    popover.hidden = false;
  },

  render() {
    const filtered = this.filteredSpools();
    this.renderRows(filtered);
    this.renderSubtotal(filtered);
    this.renderPagination(filtered.length);
    document.getElementById("table-filtered-count").textContent =
      `${filtered.length.toLocaleString()} of ${this.store.spools.length.toLocaleString()} spool(s)`;
  },

  renderRows(filtered) {
    const start = (this.currentPage - 1) * this.PAGE_SIZE;
    const pageRows = filtered.slice(start, start + this.PAGE_SIZE);
    const tbody = document.getElementById("spool-table-body");
    tbody.innerHTML = "";

    if (pageRows.length === 0) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td colspan="${this.COLUMNS.length}" class="table-empty">No spools match the current filters.</td>`;
      tbody.appendChild(tr);
      return;
    }

    const frag = document.createDocumentFragment();
    pageRows.forEach((row) => {
      const tr = document.createElement("tr");
      if (row.is_delayed) tr.classList.add("is-delayed-row");
      this.COLUMNS.forEach((column) => {
        const td = document.createElement("td");
        td.textContent = this.formatValue(row, column);
        if (column.key === "delay_status") {
          if (row.delay_status === "Delayed") td.classList.add("cell-delayed");
          else if (row.delay_status === "On Time") td.classList.add("cell-on-time");
        }
        tr.appendChild(td);
      });
      frag.appendChild(tr);
    });
    tbody.appendChild(frag);
  },

  renderSubtotal(filtered) {
    const tr = document.getElementById("spool-table-subtotal");
    tr.innerHTML = "";

    this.COLUMNS.forEach((column, index) => {
      const td = document.createElement("td");
      if (index === 0) {
        td.textContent = `Subtotal (${filtered.length.toLocaleString()} rows)`;
      } else if (column.type === "number" || column.type === "day") {
        const values = filtered
          .map((r) => this.rawValue(r, column))
          .filter((v) => v !== null && v !== undefined);
        if (values.length === 0) {
          td.textContent = "\u2013";
        } else if (column.subtotal === "sum") {
          const sum = values.reduce((a, b) => a + b, 0);
          td.textContent = Math.round(sum * 100) / 100;
        } else {
          const avg = values.reduce((a, b) => a + b, 0) / values.length;
          td.textContent = `avg ${Math.round(avg * 10) / 10}`;
        }
      } else {
        td.textContent = "";
      }
      tr.appendChild(td);
    });
  },

  renderPagination(totalRows) {
    const totalPages = Math.max(1, Math.ceil(totalRows / this.PAGE_SIZE));
    if (this.currentPage > totalPages) this.currentPage = totalPages;

    document.getElementById("table-page-info").textContent = `Page ${this.currentPage} of ${totalPages}`;

    const prevBtn = document.getElementById("table-prev-page");
    const nextBtn = document.getElementById("table-next-page");
    prevBtn.disabled = this.currentPage <= 1;
    nextBtn.disabled = this.currentPage >= totalPages;

    prevBtn.onclick = () => {
      if (this.currentPage > 1) { this.currentPage -= 1; this.render(); }
    };
    nextBtn.onclick = () => {
      if (this.currentPage < totalPages) { this.currentPage += 1; this.render(); }
    };
  },
};
