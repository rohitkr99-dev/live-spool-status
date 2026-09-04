/**
 * painting-pendingWork.js
 * ---------------------------------------------------------
 * "Quantum of Work Pending" - one bar per stage a spool can be stuck
 * at, so the team can see where the painting backlog actually sits,
 * not just the overall completion %. Rules given by the person
 * (2026-09-05), refined over several rounds of clarification - see
 * CHANGELOG.md for the full back-and-forth. Every spool lands in
 * AT MOST ONE bucket - its single current bottleneck, the earliest
 * unmet step in the stage order below - so bars sum to a meaningful
 * total rather than double-counting a spool stuck at an earlier stage
 * as also "pending" at every later one.
 *
 * Buckets, in priority order (classify() returns the first match):
 *   1. Not Part of Painting Plan - RFP done (DPR), missing from the
 *      Painting Plan file entirely, DPR's own PDI Clearance still
 *      blank. (If DPR already shows PDI Clearance despite being
 *      missing from the plan, it's excluded outright - already done,
 *      nothing to track. Per the person: "we can ignore it as it has
 *      already completed the process".) Same population as the
 *      existing "Missing from Plan" table - this chart just also
 *      surfaces it as its own backlog bucket so it doesn't hide
 *      inside a single "% missing" KPI.
 *   2. Pending Internal Blasting - Reqd = Yes, no date yet.
 *   3. Pending External Blasting - 1+ coats, no date yet.
 *   4. Pending Primer - 1+ coats, no date yet.
 *   5. Pending Mid Coat - 3 coats, Primer done, neither Mid Coat 1 nor
 *      Mid Coat 2 date is filled yet.
 *   6. Pending Top Coat - 2 coats (Primer done, the spool's own
 *      second coat - Mid Coat 1/2 or Top Coat, whichever field was
 *      actually used - not filled) OR 3 coats (Primer + Mid Coat
 *      done, Top Coat date not filled).
 *   7. Pending PDI Offer - every applicable coat done (or none
 *      needed), the Painting Plan's own PDI Offer Date is blank.
 *   8. Offered, Pending DPR Clearance - PDI Offer Date is filled, but
 *      DPR's own PDI Clearance Date is still blank. Two distinct
 *      buckets rather than one, precisely because they're different
 *      real problems - one is "hasn't been offered", the other is
 *      "offered, DPR just hasn't caught up (or a real mismatch)".
 *   Anything with DPR's PDI Clearance Date filled -> Complete,
 *   excluded from this chart entirely (nothing left to track).
 *
 * classify() only reads fields already computed once in Python
 * (src/painting/summary.py -> _build_record()) - same client-side-
 * filtering approach as painting-tables.js -> byFlag() and
 * painting-chartExport.js, for the same reason (see
 * summary.py -> build_anomalies()'s own comment): no second,
 * denormalized copy of this from Python, just a re-partition of the
 * one spool list already shipped to the browser.
 */

const PaintingPendingWork = {

  STAGES: [
    ["not_in_plan", "Not Part of Painting Plan"],
    ["pending_internal_blasting", "Pending Internal Blasting"],
    ["pending_external_blasting", "Pending External Blasting"],
    ["pending_primer", "Pending Primer"],
    ["pending_mid_coat", "Pending Mid Coat"],
    ["pending_top_coat", "Pending Top Coat"],
    ["pending_pdi_offer", "Pending PDI Offer"],
    ["pending_pdi_clearance", "Offered, Pending DPR Clearance"],
  ],

  metric: "count", // "count" | "surface_area"
  bay: "__all__",
  project: "__all__",

  instance: null,
  store: null,

  /** Returns this spool's single current bottleneck stage key, or null if it's Complete (nothing pending). */
  classify(s) {
    if (!s.in_painting_plan) {
      return s.pdi_clearance_date ? null : "not_in_plan";
    }

    // DPR's own PDI Clearance Date is the ultimate completion gate,
    // checked BEFORE any intermediate stage - a spool DPR already
    // shows cleared is done, full stop, even if some earlier Painting
    // Plan date happens to be missing (a data-quality gap, not a real
    // bottleneck). Checking this only at the very end (after the
    // per-stage checks below) mis-filed a real spool into an earlier
    // "pending" bucket whenever such a gap existed - confirmed live
    // against the KPI strip's own PDI Cleared count before this fix.
    if (s.pdi_clearance_date) return null;

    if (s.internal_blasting_applicable === true && !s.internal_blasting_date) {
      return "pending_internal_blasting";
    }

    if (s.paint_applicable === true) {
      if (!s.external_blasting_date) return "pending_external_blasting";

      if (s.no_of_coats >= 1) {
        if (!s.primer_date) return "pending_primer";

        if (s.no_of_coats === 2) {
          if (!s.next_coat_date) return "pending_top_coat";
        } else if (s.no_of_coats >= 3) {
          const midDone = s.mid_coat_1_date || s.mid_coat_2_date;
          if (!midDone) return "pending_mid_coat";
          if (!s.top_coat_date) return "pending_top_coat";
        }
      }
    }

    if (!s.pdi_offer_date) return "pending_pdi_offer";
    return "pending_pdi_clearance"; // pdi_offer_date is set, pdi_clearance_date is null (checked above)
  },

  /** Every spool tagged with its bucket (or null) - computed once per render, reused by the chart, the filters, and the Excel export so all three always agree. */
  classifyAll(spools) {
    return spools.map((s) => ({ spool: s, bucket: this.classify(s) }));
  },

  matchesFilters(spool) {
    if (this.bay !== "__all__" && spool.bay_no !== this.bay) return false;
    if (this.project !== "__all__" && spool.project_code !== this.project) return false;
    return true;
  },

  metricValue(spool) {
    return this.metric === "surface_area" ? (spool.surface_area || 0) : 1;
  },

  render(store) {
    this.store = store;
    this.classified = this.classifyAll(store.spools);
    this.populateFilters(store.spools);
    this.setupFilters();
    this.renderChart();
  },

  populateFilters(spools) {
    const bayContainer = document.getElementById("pending-bay-filter");
    if (bayContainer && !bayContainer.dataset.populated) {
      bayContainer.dataset.populated = "true";
      const bays = [...new Set(spools.map((s) => s.bay_no).filter(Boolean))].sort();
      bays.forEach((bay) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "activity-filter__btn";
        btn.dataset.bay = bay;
        btn.textContent = bay;
        bayContainer.appendChild(btn);
      });
    }

    const projectSelect = document.getElementById("pending-project-filter");
    if (projectSelect && !projectSelect.dataset.populated) {
      projectSelect.dataset.populated = "true";
      const codes = [...new Set(spools.map((s) => s.project_code).filter(Boolean))].sort();
      codes.forEach((code) => {
        const row = spools.find((s) => s.project_code === code);
        const opt = document.createElement("option");
        opt.value = code;
        opt.textContent = row && row.project_name ? `${row.project_name} (${code})` : code;
        projectSelect.appendChild(opt);
      });
    }
  },

  setupFilters() {
    const metricContainer = document.getElementById("pending-metric-filter");
    if (metricContainer && !metricContainer.dataset.wired) {
      metricContainer.dataset.wired = "true";
      metricContainer.querySelectorAll(".activity-filter__btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          metricContainer.querySelectorAll(".activity-filter__btn").forEach((b) => b.classList.remove("is-active"));
          btn.classList.add("is-active");
          this.metric = btn.dataset.metric;
          this.renderChart();
        });
      });
    }

    const bayContainer = document.getElementById("pending-bay-filter");
    if (bayContainer && !bayContainer.dataset.wired) {
      bayContainer.dataset.wired = "true";
      bayContainer.addEventListener("click", (e) => {
        const btn = e.target.closest(".activity-filter__btn");
        if (!btn) return;
        bayContainer.querySelectorAll(".activity-filter__btn").forEach((b) => b.classList.remove("is-active"));
        btn.classList.add("is-active");
        this.bay = btn.dataset.bay;
        this.renderChart();
      });
    }

    const projectSelect = document.getElementById("pending-project-filter");
    if (projectSelect && !projectSelect.dataset.wired) {
      projectSelect.dataset.wired = "true";
      projectSelect.addEventListener("change", () => {
        this.project = projectSelect.value;
        this.renderChart();
      });
    }
  },

  renderChart() {
    const ctx = document.getElementById("chart-pending-work");
    if (!ctx) return;
    if (this.instance) this.instance.destroy();

    const chartFont = PaintingCharts.chartFont;
    const filtered = this.classified.filter(({ spool, bucket }) => bucket && this.matchesFilters(spool));
    const metricLabel = this.metric === "surface_area" ? "Surface area (m²)" : "Spool count";

    const totals = this.STAGES.map(([key]) =>
      filtered.filter((r) => r.bucket === key).reduce((sum, r) => sum + this.metricValue(r.spool), 0)
    );

    const hintEl = document.getElementById("chart-pending-work-hint");
    if (hintEl) {
      const bayText = this.bay === "__all__" ? "all bays" : this.bay;
      const projectText = this.project === "__all__" ? "all projects" : this.project;
      hintEl.textContent = `${metricLabel} · ${bayText} · ${projectText}`;
    }

    this.instance = new Chart(ctx, {
      type: "bar",
      data: {
        labels: this.STAGES.map(([, label]) => label),
        datasets: [{
          label: metricLabel,
          data: totals,
          backgroundColor: PAINTING_CONFIG.overIdealColor,
          maxBarThickness: 34,
        }],
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          datalabels: {
            display: "auto",
            formatter: (v) => (v === 0 ? "" : this.metric === "surface_area" ? v.toLocaleString("en-US", { maximumFractionDigits: 1 }) : v.toLocaleString("en-US")),
          },
          tooltip: {
            titleFont: chartFont,
            bodyFont: chartFont,
            callbacks: {
              label: (item) => ` ${item.raw.toLocaleString("en-US", { maximumFractionDigits: this.metric === "surface_area" ? 1 : 0 })} ${metricLabel.toLowerCase()}`,
            },
          },
        },
        scales: {
          x: { beginAtZero: true, grid: { display: false }, ticks: { font: chartFont }, title: { display: true, text: metricLabel, font: chartFont } },
          y: { grid: { display: false }, ticks: { font: { ...chartFont, size: 11.5 } } },
        },
      },
    });

    if (typeof PaintingChartExport !== "undefined") PaintingChartExport.wirePendingWork(this);
  },
};
