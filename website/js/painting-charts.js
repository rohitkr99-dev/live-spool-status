/**
 * painting-charts.js
 * ---------------------------------------------------------
 * Builds every Chart.js chart on the page directly from
 * already-computed arrays in the JSON bundle (stage_funnel,
 * stage_duration_stats, cycle_time_histogram, aging_buckets,
 * weekly_trend) - this module only maps those numbers into Chart.js's
 * data/options shape, it never re-derives a business figure.
 */

const PaintingCharts = {

  instances: {},
  store: null,

  chartFont: {
    family: "Inter, sans-serif",
    size: 11,
  },

  outputMetric: "count",
  outputGranularity: "Week",

  blastingRangeFrom: null,
  blastingRangeTo: null,
  _blastingPeriods: [],

  bayOutputStage: "internal_blasting",
  bayOutputMetric: "count",
  bayOutputGranularity: "Week",

  render(store) {
    this.store = store;
    this.renderFunnel();
    this.renderBottleneck();
    this.renderHistogram();
    this.renderAging();
    this.renderTrend();
    this.setupOutputFilters();
    this.setupBlastingRangeFilter();
    this.renderAllOutputTrends();
    this.setupBayOutputFilters();
    this.renderBayOutputTrend();
    this.renderProjectInsight();
    this.renderMaterialInsight();
  },

  _formatMetricValue(value, metric) {
    const n = Number(value) || 0;
    return metric === "surface_area"
      ? n.toLocaleString("en-US", { maximumFractionDigits: 1 })
      : n.toLocaleString("en-US");
  },

  destroy(key) {
    if (this.instances[key]) {
      this.instances[key].destroy();
      delete this.instances[key];
    }
  },

  // ---------------------------------------------------------------
  // Stage Completion Funnel - horizontal bar, one bar per stage, %
  // done OF THE SPOOLS THAT STAGE ACTUALLY APPLIES TO (applicable_
  // count) - not every spool needs internal blasting, external
  // blasting/primer, or pickling, so a raw count/pct-of-all-RFP-done
  // would understate how caught-up each stage really is.
  // ---------------------------------------------------------------
  renderFunnel() {
    this.destroy("funnel");
    const ctx = document.getElementById("chart-funnel");
    if (!ctx) return;

    const rows = this.store.stageFunnel || [];

    this.instances.funnel = new Chart(ctx, {
      type: "bar",
      data: {
        labels: rows.map((r) => r.stage),
        datasets: [{
          label: "% done",
          data: rows.map((r) => r.pct_of_applicable),
          backgroundColor: PAINTING_CONFIG.stageColor,
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
            formatter: (value, ctx) => {
              const row = rows[ctx.dataIndex];
              return value === null ? "n/a" : `${value}% (${row.done_count.toLocaleString("en-US")}/${row.applicable_count.toLocaleString("en-US")})`;
            },
          },
          tooltip: {
            titleFont: this.chartFont,
            bodyFont: this.chartFont,
            callbacks: {
              label(item) {
                const row = rows[item.dataIndex];
                if (row.pct_of_applicable === null) return " No spools this stage applies to";
                return ` ${row.done_count.toLocaleString("en-US")} of ${row.applicable_count.toLocaleString("en-US")} applicable spools (${row.pct_of_applicable}%)`;
              },
            },
          },
        },
        scales: {
          x: { beginAtZero: true, max: 100, grid: { display: false }, ticks: { font: this.chartFont, callback: (v) => `${v}%` }, title: { display: true, text: "% done, of applicable spools", font: this.chartFont } },
          y: { grid: { display: false }, ticks: { font: { ...this.chartFont, size: 12 } } },
        },
      },
    });
  },

  // ---------------------------------------------------------------
  // Bottleneck chart - median working days per stage transition, plus
  // a dashed reference line at the 4-day total ideal, so whichever
  // segment's bar reaches furthest past that line is where spools are
  // actually losing time.
  // ---------------------------------------------------------------
  idealLinePlugin: {
    id: "idealLine",
    afterDraw(chart) {
      const opts = chart.options.plugins && chart.options.plugins.idealLine;
      if (!opts || opts.value === undefined) return;
      const { ctx, scales, chartArea } = chart;
      const x = scales.x;
      if (!x) return;
      const xPos = x.getPixelForValue(opts.value);
      ctx.save();
      ctx.strokeStyle = PAINTING_CONFIG.idealLineColor;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(xPos, chartArea.top);
      ctx.lineTo(xPos, chartArea.bottom);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = "600 10.5px 'IBM Plex Mono', monospace";
      ctx.fillStyle = PAINTING_CONFIG.idealLineColor;
      ctx.textAlign = "left";
      ctx.fillText(`${opts.value}d ideal (total)`, xPos + 6, chartArea.top + 12);
      ctx.restore();
    },
  },

  renderBottleneck() {
    this.destroy("bottleneck");
    const ctx = document.getElementById("chart-bottleneck");
    if (!ctx) return;

    const rows = (this.store.stageDurationStats || []).filter((r) => r.applicable_count > 0);

    this.instances.bottleneck = new Chart(ctx, {
      type: "bar",
      data: {
        labels: rows.map((r) => r.segment),
        datasets: [{
          label: "Median working days",
          data: rows.map((r) => r.median_days),
          backgroundColor: rows.map((r) =>
            r.segment.includes("total") ? PAINTING_CONFIG.overIdealColor : PAINTING_CONFIG.stageColor
          ),
          maxBarThickness: 34,
        }],
      },
      plugins: [this.idealLinePlugin],
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          idealLine: { value: PAINTING_CONFIG.idealCycleDays },
          datalabels: {
            display: "auto",
            formatter: (value) => `${value}d`,
          },
          tooltip: {
            titleFont: this.chartFont,
            bodyFont: this.chartFont,
            callbacks: {
              label(item) {
                const row = rows[item.dataIndex];
                return [
                  ` Median: ${row.median_days}d · Average: ${row.avg_days}d · 90th pct: ${row.p90_days}d`,
                  ` Applicable to ${row.applicable_count.toLocaleString("en-US")} spool(s)${row.out_of_order_count ? ` · ${row.out_of_order_count} out-of-order` : ""}`,
                ];
              },
            },
          },
        },
        scales: {
          x: { beginAtZero: true, grid: { display: false }, ticks: { font: this.chartFont }, title: { display: true, text: "Working days", font: this.chartFont } },
          y: { grid: { display: false }, ticks: { font: { ...this.chartFont, size: 11.5 } } },
        },
      },
    });
  },

  // ---------------------------------------------------------------
  // Cycle time histogram - completed spools, bucketed
  // ---------------------------------------------------------------
  _bucketColors(rows) {
    return rows.map((r) => (r.bucket.includes("ideal") ? PAINTING_CONFIG.idealLineColor : PAINTING_CONFIG.overIdealColor));
  },

  renderHistogram() {
    this.destroy("histogram");
    const ctx = document.getElementById("chart-histogram");
    if (!ctx) return;

    const rows = this.store.cycleTimeHistogram || [];
    const total = rows.reduce((a, r) => a + r.count, 0);

    this.instances.histogram = new Chart(ctx, {
      type: "bar",
      data: {
        labels: rows.map((r) => r.bucket),
        datasets: [{ label: "Spools", data: rows.map((r) => r.count), backgroundColor: this._bucketColors(rows), maxBarThickness: 46 }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            titleFont: this.chartFont,
            bodyFont: this.chartFont,
            callbacks: {
              label(item) {
                const pct = total ? ((item.raw / total) * 100).toFixed(1) : "0.0";
                return ` ${item.raw.toLocaleString("en-US")} spools (${pct}%)`;
              },
            },
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: this.chartFont } },
          y: { beginAtZero: true, grid: { display: false }, ticks: { font: this.chartFont }, title: { display: true, text: "Spool count", font: this.chartFont } },
        },
      },
    });
  },

  // ---------------------------------------------------------------
  // Aging buckets - open spools, by days since RFP
  // ---------------------------------------------------------------
  renderAging() {
    this.destroy("aging");
    const ctx = document.getElementById("chart-aging");
    if (!ctx) return;

    const rows = this.store.agingBuckets || [];
    const total = rows.reduce((a, r) => a + r.count, 0);

    this.instances.aging = new Chart(ctx, {
      type: "bar",
      data: {
        labels: rows.map((r) => r.bucket),
        datasets: [{ label: "Open spools", data: rows.map((r) => r.count), backgroundColor: this._bucketColors(rows), maxBarThickness: 46 }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            titleFont: this.chartFont,
            bodyFont: this.chartFont,
            callbacks: {
              label(item) {
                const pct = total ? ((item.raw / total) * 100).toFixed(1) : "0.0";
                return ` ${item.raw.toLocaleString("en-US")} spools (${pct}%)`;
              },
            },
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: this.chartFont } },
          y: { beginAtZero: true, grid: { display: false }, ticks: { font: this.chartFont }, title: { display: true, text: "Open spool count", font: this.chartFont } },
        },
      },
    });
  },

  // ---------------------------------------------------------------
  // Weekly trend - median cycle time by RFP week
  // ---------------------------------------------------------------
  renderTrend() {
    this.destroy("trend");
    const ctx = document.getElementById("chart-trend");
    if (!ctx) return;

    const rows = this.store.weeklyTrend || [];

    this.instances.trend = new Chart(ctx, {
      type: "line",
      data: {
        labels: rows.map((r) => r.week),
        datasets: [
          {
            label: "Median cycle days",
            data: rows.map((r) => r.median_days),
            borderColor: PAINTING_CONFIG.overIdealColor,
            backgroundColor: `${PAINTING_CONFIG.overIdealColor}33`,
            fill: true,
            tension: 0.3,
            pointRadius: 3,
          },
          {
            label: "4-day ideal",
            data: rows.map(() => PAINTING_CONFIG.idealCycleDays),
            borderColor: PAINTING_CONFIG.idealLineColor,
            borderDash: [6, 4],
            pointRadius: 0,
            fill: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "top", align: "end", labels: { font: this.chartFont, boxWidth: 10, usePointStyle: true, pointStyle: "circle" } },
          datalabels: { display: false },
          tooltip: {
            titleFont: this.chartFont,
            bodyFont: this.chartFont,
            callbacks: {
              afterTitle(items) {
                const row = rows[items[0].dataIndex];
                return `${row.count} spool(s) RFP'd that week`;
              },
            },
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { family: "IBM Plex Mono, monospace", size: 10 }, autoSkip: true, maxRotation: 0 } },
          y: { beginAtZero: true, grid: { display: false }, ticks: { font: this.chartFont }, title: { display: true, text: "Working days", font: this.chartFont } },
        },
      },
    });
  },

  // ---------------------------------------------------------------
  // Process Output Over Time - one chart per process, how many spools
  // (or how much surface area) completed it per day/week/month.
  // Metric/granularity are shared across all six charts - simple
  // client-side selectors over pre-computed arrays (stage_output_trend
  // in the bundle) - same filter pattern as
  // website/js/packing-charts.js -> renderPackingTrend().
  // ---------------------------------------------------------------
  // Internal/External Blasting are no longer here - same machines, so
  // the person asked for them combined into one chart instead
  // (renderBlastingOutputTrend() below), not two separate ones.
  outputStages: [
    ["primer", "Primer"],
    ["pickling", "Pickling"],
    ["pdi_offer", "PDI Offer"],
    ["pdi_clearance", "PDI Clearance"],
  ],

  // stage key -> [spool record date field, display label] - used by
  // renderBayOutputTrend() to tell PaintingChartExport which date
  // field the currently-selected bay-output stage corresponds to.
  STAGE_DATE_FIELDS: {
    internal_blasting: ["internal_blasting_date", "Internal Blasting"],
    external_blasting: ["external_blasting_date", "External Blasting"],
    primer: ["primer_date", "Primer"],
    pickling: ["pickling_date", "Pickling"],
    pdi_offer: ["pdi_offer_date", "PDI Offer"],
    pdi_clearance: ["pdi_clearance_date", "PDI Clearance"],
  },

  setupOutputFilters() {
    this._wireFilterGroup("output-metric-filter", "metric", (value) => {
      this.outputMetric = value;
      this.renderAllOutputTrends();
    });
    this._wireFilterGroup("output-period-filter", "granularity", (value) => {
      this.outputGranularity = value;
      this.renderAllOutputTrends();
    });
  },

  _wireFilterGroup(containerId, dataAttr, onChange) {
    const container = document.getElementById(containerId);
    if (!container || container.dataset.wired) return;
    container.dataset.wired = "true";
    container.querySelectorAll(".activity-filter__btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        container.querySelectorAll(".activity-filter__btn").forEach((b) => b.classList.remove("is-active"));
        btn.classList.add("is-active");
        onChange(btn.dataset[dataAttr]);
      });
    });
  },

  _granularityKey(g) {
    return g === "Day" ? "daily" : g === "Month" ? "monthly" : "weekly";
  },

  _formatPeriodLabel(raw, granularity) {
    if (granularity === "Month") {
      const [y, m] = raw.split("-").map(Number);
      return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "short", year: "2-digit" });
    }
    if (granularity === "Week") return raw; // "2026-W14" reads fine as-is
    const date = new Date(`${raw}T00:00:00`);
    if (isNaN(date.getTime())) return raw;
    return date.toLocaleDateString("en-US", { day: "numeric", month: "short" });
  },

  renderAllOutputTrends() {
    this.outputStages.forEach(([stage]) => this.renderOutputTrend(stage));
    this.renderBlastingOutputTrend();
  },

  renderOutputTrend(stage) {
    const key = `output_${stage}`;
    this.destroy(key);
    const ctx = document.getElementById(`chart-output-${stage}`);
    if (!ctx) return;

    const hintEl = document.getElementById(`chart-output-${stage}-hint`);
    const metricLabel = this.outputMetric === "surface_area" ? "Surface area (m²)" : "Spool count";
    if (hintEl) hintEl.textContent = `${metricLabel}, by ${this.outputGranularity.toLowerCase()}`;

    const stageData = (this.store.stageOutputTrend || {})[stage] || {};
    const rows = stageData[this._granularityKey(this.outputGranularity)] || [];
    const rawKeys = rows.map((r) => r.period);
    const labels = rawKeys.map((raw) => this._formatPeriodLabel(raw, this.outputGranularity));
    const data = rows.map((r) => r[this.outputMetric] || 0);

    this.instances[key] = new Chart(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: [{ label: metricLabel, data, backgroundColor: PAINTING_CONFIG.stageColor, borderRadius: 4, maxBarThickness: 28 }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { grid: { display: false }, ticks: { font: { family: "IBM Plex Mono, monospace", size: 9.5 }, autoSkip: true, maxRotation: 0 } },
          y: { beginAtZero: true, grid: { display: false }, ticks: { font: this.chartFont }, title: { display: true, text: metricLabel, font: this.chartFont } },
        },
        plugins: {
          legend: { display: false },
          datalabels: {
            formatter: (v) => (v === 0 ? "" : this._formatMetricValue(v, this.outputMetric)),
          },
          tooltip: {
            titleFont: this.chartFont,
            bodyFont: this.chartFont,
            callbacks: {
              title(items) {
                const raw = rawKeys[items[0].dataIndex];
                return raw;
              },
            },
          },
        },
      },
    });
  },

  // ---------------------------------------------------------------
  // Internal vs External Blasting - combined into a single diverging
  // ("butterfly") chart per the person (2026-09-04): "Internal &
  // External blasting are both done at same machines, I want to show
  // some chart showing those together." Corrected the same day, twice:
  // first to a true left/right-wing butterfly (indexAxis: 'y' -
  // horizontal bars, not vertical up/down bars, which the person
  // clarified is what "vertical" meant - the chart tall enough for
  // ~20 rows, not the BARS drawn vertically), then to put Internal on
  // the left / External on the right with the DEE logo's own two
  // brand colours (--ice #4333A5 / --ember #A82E30, see css/styles.css
  // -> "DEE red and DEE blue as the two brand" accents) instead of the
  // original teal. Internal renders as a negative-valued bar (so it
  // extends left), External as positive (extends right) - both
  // stacked on the same y category so they sit directly opposite each
  // other, plus a combined-total label drawn at the center (x=0) of
  // each row by sumLabelPlugin below. Shows the most recent ~20
  // periods by default (tall enough to read all of them - see
  // renderBlastingOutputTrend()'s dynamic canvas height below); the
  // From/To range selects (blasting-range-from/-to) let the person
  // widen or narrow that window, same UI pattern as dashboard.html's
  // Weekly Progress chart's own from/to week-range control
  // (website/js/charts.js -> setupWeeklyRangeFilter()).
  // ---------------------------------------------------------------
  sumLabelPlugin: {
    id: "sumLabels",
    afterDatasetsDraw(chart) {
      const opts = chart.options.plugins && chart.options.plugins.sumLabels;
      if (!opts || !opts.totals) return;
      const { ctx, scales } = chart;
      const xScale = scales.x, yScale = scales.y;
      if (!xScale || !yScale) return;
      const zeroX = xScale.getPixelForValue(0);
      ctx.save();
      ctx.font = "700 10px 'IBM Plex Mono', monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      opts.totals.forEach((total, i) => {
        if (!total) return;
        const y = yScale.getPixelForValue(i);
        const text = total.toLocaleString("en-US");
        const boxW = ctx.measureText(text).width + 10;
        const boxH = 15;
        ctx.fillStyle = PAINTING_CONFIG.blastingColors.sumLabelBg;
        ctx.fillRect(zeroX - boxW / 2, y - boxH / 2, boxW, boxH);
        ctx.fillStyle = "#FFFFFF";
        ctx.fillText(text, zeroX, y + 1);
      });
      ctx.restore();
    },
  },

  setupBlastingRangeFilter() {
    const fromSelect = document.getElementById("blasting-range-from");
    const toSelect = document.getElementById("blasting-range-to");
    if (!fromSelect || !toSelect || fromSelect.dataset.wired) return;
    fromSelect.dataset.wired = "true";

    const onChange = () => {
      const periods = this._blastingPeriods || [];
      const fromIdx = periods.indexOf(fromSelect.value);
      const toIdx = periods.indexOf(toSelect.value);
      if (fromIdx === -1 || toIdx === -1) return;
      this.blastingRangeFrom = periods[Math.min(fromIdx, toIdx)];
      this.blastingRangeTo = periods[Math.max(fromIdx, toIdx)];
      this.renderBlastingOutputTrend();
    };

    fromSelect.addEventListener("change", onChange);
    toSelect.addEventListener("change", onChange);
  },

  /** Only rebuilds the <option>s when the available period set has actually changed, so an in-progress From/To selection isn't clobbered by every re-render. */
  refreshBlastingRangeOptions(periods, granularity) {
    const fromSelect = document.getElementById("blasting-range-from");
    const toSelect = document.getElementById("blasting-range-to");
    if (!fromSelect || !toSelect) return;

    const signature = `${granularity}:${periods.join(",")}`;
    if (fromSelect.dataset.periodsSignature === signature) return;
    fromSelect.dataset.periodsSignature = signature;

    const optionsHtml = periods
      .map((p) => `<option value="${p}">${this._formatPeriodLabel(p, granularity)}</option>`)
      .join("");
    fromSelect.innerHTML = optionsHtml;
    toSelect.innerHTML = optionsHtml;
  },

  renderBlastingOutputTrend() {
    this.destroy("blasting");
    const ctx = document.getElementById("chart-output-blasting");
    if (!ctx) return;

    const metricLabel = this.outputMetric === "surface_area" ? "Surface area (m²)" : "Spool count";
    const stageData = this.store.blastingOutputTrend || {};
    const allRows = stageData[this._granularityKey(this.outputGranularity)] || [];
    const periods = allRows.map((r) => r.period);
    this._blastingPeriods = periods;

    this.refreshBlastingRangeOptions(periods, this.outputGranularity);

    const rangeStillValid =
      this.blastingRangeFrom !== null
      && periods.includes(this.blastingRangeFrom)
      && periods.includes(this.blastingRangeTo);

    if (!rangeStillValid) {
      const last20 = periods.slice(-20);
      this.blastingRangeFrom = last20[0] ?? null;
      this.blastingRangeTo = last20[last20.length - 1] ?? null;
    }

    const fromSelect = document.getElementById("blasting-range-from");
    const toSelect = document.getElementById("blasting-range-to");
    if (fromSelect && this.blastingRangeFrom !== null) fromSelect.value = this.blastingRangeFrom;
    if (toSelect && this.blastingRangeTo !== null) toSelect.value = this.blastingRangeTo;

    const fromIdx = Math.max(0, periods.indexOf(this.blastingRangeFrom));
    const toIdx = periods.indexOf(this.blastingRangeTo);
    const rows = toIdx >= 0 ? allRows.slice(fromIdx, toIdx + 1) : allRows;

    const hintEl = document.getElementById("chart-output-blasting-hint");
    if (hintEl) {
      hintEl.textContent = allRows.length
        ? `${metricLabel}, by ${this.outputGranularity.toLowerCase()} — same machines, shown together · showing ${rows.length} of ${allRows.length}`
        : `${metricLabel}, by ${this.outputGranularity.toLowerCase()} — same machines, shown together`;
    }

    const rawKeys = rows.map((r) => r.period);
    const labels = rawKeys.map((raw) => this._formatPeriodLabel(raw, this.outputGranularity));
    const internalData = rows.map((r) => -(r.internal_blasting[this.outputMetric] || 0));
    const externalData = rows.map((r) => r.external_blasting[this.outputMetric] || 0);
    const totals = rows.map((r) => r.total[this.outputMetric] || 0);

    // A true butterfly needs real height to breathe - one row per
    // period, not a fixed box. .chart-card__body is `flex: 1` (see
    // css/styles.css), which resolves to flex-basis: 0% - a plain
    // `height` on a 0-basis flex child is ignored outright, only
    // `min-height` actually grows it (confirmed: setting .style.height
    // here left the card stuck at its static min-height:380px CSS
    // fallback, verified via clientHeight in the browser). min-height
    // is what the static CSS fallback itself relies on too, so this
    // just overrides that same property with the row-count-driven
    // value, same "chart.js horizontal-bar sizing" math as every
    // other horizontal chart on this site.
    const bodyEl = ctx.parentElement;
    if (bodyEl) bodyEl.style.minHeight = `${Math.max(340, rows.length * 34 + 90)}px`;

    this.instances.blasting = new Chart(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "Internal Blasting",
            data: internalData,
            backgroundColor: PAINTING_CONFIG.blastingColors.internal,
            borderRadius: 4,
            maxBarThickness: 22,
            datalabels: {
              // The global bar-chart default (anchor:"end", align:"end"
              // - see chartTheme.js) means "the far/outer tip" for a
              // POSITIVE stacked segment, but for this NEGATIVE one
              // (Internal renders left of zero) Chart.js's own "end"
              // resolves to the NEAR tip, right at the zero line -
              // confirmed live in the browser: with the default, the
              // label sat directly under the sum-total pill, and the
              // real per-bar value was only ever visible as a sliver
              // peeking out from behind it. "start"/"start" is what
              // actually lands at the far/outer (left) tip here.
              anchor: "start",
              align: "start",
              formatter: (v) => (v === 0 ? "" : this._formatMetricValue(Math.abs(v), this.outputMetric)),
            },
          },
          {
            label: "External Blasting",
            data: externalData,
            backgroundColor: PAINTING_CONFIG.blastingColors.external,
            borderRadius: 4,
            maxBarThickness: 22,
            datalabels: {
              formatter: (v) => (v === 0 ? "" : this._formatMetricValue(v, this.outputMetric)),
            },
          },
        ],
      },
      plugins: [this.sumLabelPlugin],
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { left: 30, right: 30 } },
        scales: {
          x: {
            stacked: true,
            grid: { color: "rgba(23, 21, 43, 0.06)" },
            ticks: { font: this.chartFont, callback: (v) => this._formatMetricValue(Math.abs(v), this.outputMetric) },
            title: { display: true, text: metricLabel, font: this.chartFont },
          },
          y: {
            stacked: true,
            grid: { display: false },
            ticks: { font: { family: "IBM Plex Mono, monospace", size: 10 } },
          },
        },
        plugins: {
          legend: { position: "top", align: "end", labels: { font: this.chartFont, boxWidth: 10, usePointStyle: true, pointStyle: "circle" } },
          datalabels: {
            formatter: (v) => (v === 0 ? "" : this._formatMetricValue(Math.abs(v), this.outputMetric)),
          },
          sumLabels: { totals },
          tooltip: {
            titleFont: this.chartFont,
            bodyFont: this.chartFont,
            callbacks: {
              title(items) {
                return rawKeys[items[0].dataIndex];
              },
              label(item) {
                return ` ${item.dataset.label}: ${Math.abs(item.raw).toLocaleString("en-US")}`;
              },
              afterBody(items) {
                return `Combined total: ${totals[items[0].dataIndex].toLocaleString("en-US")}`;
              },
            },
          },
        },
      },
    });
  },

  // ---------------------------------------------------------------
  // Output by Bay - which bay (Bay-4 / Bay-6 / Bay-6 Auto) produced how
  // much, per day/week/month, one process at a time. A standalone
  // chart (own process/metric/period selectors, independent of the six
  // Process Output Over Time charts above) built directly from
  // bay_output_trend in the bundle - one Chart.js dataset per bay so
  // they're visually compared side by side rather than summed.
  //
  // Data labels (2026-09-04, per the person): unlike the Blasting
  // butterfly chart, these bars are GROUPED side by side per period,
  // not stacked - so there's no single "top of stack" pixel to draw a
  // combined-total label at. groupTotalPlugin below finds the tallest
  // bar in each period's group and draws the total just above IT
  // instead, same dark-pill visual language as the Blasting chart's
  // own sum badge (PAINTING_CONFIG.blastingColors.sumLabelBg) so a
  // "combined total" reads the same way wherever it appears on this
  // page.
  // ---------------------------------------------------------------
  groupTotalPlugin: {
    id: "groupTotals",
    afterDatasetsDraw(chart) {
      const opts = chart.options.plugins && chart.options.plugins.groupTotals;
      if (!opts || !opts.totals) return;
      const { ctx, scales } = chart;
      ctx.save();
      ctx.font = "700 10px 'IBM Plex Mono', monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      opts.totals.forEach((total, i) => {
        if (!total) return;
        let topY = Infinity;
        chart.data.datasets.forEach((ds, di) => {
          const meta = chart.getDatasetMeta(di);
          if (meta.hidden) return;
          const bar = meta.data[i];
          if (bar && bar.y < topY) topY = bar.y;
        });
        if (!isFinite(topY)) return;
        const x = scales.x.getPixelForValue(i);
        // 28px, not a smaller gap - confirmed live in the browser
        // (same lesson as the Blasting chart's sum badge): the tallest
        // bar's OWN datalabel already occupies roughly topY-16 to
        // topY-4 (global bar default: offset 4 + the label's own text
        // height), so anything closer than ~28px collides with it.
        const y = topY - 28;
        const text = total.toLocaleString("en-US");
        const boxW = ctx.measureText(text).width + 10;
        const boxH = 15;
        ctx.fillStyle = PAINTING_CONFIG.blastingColors.sumLabelBg;
        ctx.fillRect(x - boxW / 2, y - boxH / 2, boxW, boxH);
        ctx.fillStyle = "#FFFFFF";
        ctx.fillText(text, x, y + 1);
      });
      ctx.restore();
    },
  },

  setupBayOutputFilters() {
    this._wireFilterGroup("bay-output-stage-filter", "stage", (value) => {
      this.bayOutputStage = value;
      this.renderBayOutputTrend();
    });
    this._wireFilterGroup("bay-output-metric-filter", "metric", (value) => {
      this.bayOutputMetric = value;
      this.renderBayOutputTrend();
    });
    this._wireFilterGroup("bay-output-period-filter", "granularity", (value) => {
      this.bayOutputGranularity = value;
      this.renderBayOutputTrend();
    });
  },

  renderBayOutputTrend() {
    this.destroy("bayOutput");
    const ctx = document.getElementById("chart-bay-output");
    if (!ctx) return;

    const bayData = this.store.bayOutputTrend || {};
    const bays = bayData.bays || [];
    const metricLabel = this.bayOutputMetric === "surface_area" ? "Surface area (m²)" : "Spool count";

    const hintEl = document.getElementById("chart-bay-output-hint");
    if (hintEl) hintEl.textContent = `${metricLabel}, by ${this.bayOutputGranularity.toLowerCase()}`;

    const stageData = (bayData.stages || {})[this.bayOutputStage] || {};
    const rows = stageData[this._granularityKey(this.bayOutputGranularity)] || [];
    const rawKeys = rows.map((r) => r.period);
    const labels = rawKeys.map((raw) => this._formatPeriodLabel(raw, this.bayOutputGranularity));

    const datasets = bays.map((bay, i) => ({
      label: bay,
      data: rows.map((r) => (r[bay] ? r[bay][this.bayOutputMetric] || 0 : 0)),
      backgroundColor: PAINTING_CONFIG.projectPalette[i % PAINTING_CONFIG.projectPalette.length],
      borderRadius: 4,
      maxBarThickness: 28,
      datalabels: {
        formatter: (v) => (v === 0 ? "" : this._formatMetricValue(v, this.bayOutputMetric)),
      },
    }));

    const totals = rows.map((r) => bays.reduce((sum, bay) => sum + ((r[bay] && r[bay][this.bayOutputMetric]) || 0), 0));

    this.instances.bayOutput = new Chart(ctx, {
      type: "bar",
      data: { labels, datasets },
      plugins: [this.groupTotalPlugin],
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { top: 42 } },
        scales: {
          x: { grid: { display: false }, ticks: { font: { family: "IBM Plex Mono, monospace", size: 9.5 }, autoSkip: true, maxRotation: 0 } },
          y: { beginAtZero: true, grid: { display: false }, ticks: { font: this.chartFont }, title: { display: true, text: metricLabel, font: this.chartFont } },
        },
        plugins: {
          legend: { position: "top", align: "end", labels: { font: this.chartFont, boxWidth: 10, usePointStyle: true, pointStyle: "circle" } },
          groupTotals: { totals },
          tooltip: {
            titleFont: this.chartFont,
            bodyFont: this.chartFont,
            callbacks: {
              title(items) {
                return rawKeys[items[0].dataIndex];
              },
              afterBody(items) {
                return `Combined total: ${totals[items[0].dataIndex].toLocaleString("en-US")}`;
              },
            },
          },
        },
      },
    });

    if (typeof PaintingChartExport !== "undefined") {
      const [dateField, stageLabel] = this.STAGE_DATE_FIELDS[this.bayOutputStage] || [];
      if (dateField) PaintingChartExport.wireBayOutput(this.store, this.bayOutputStage, dateField, stageLabel);
    }
  },

  // ---------------------------------------------------------------
  // More insights - median cycle time by project / by material, so a
  // slow project or material doesn't get averaged away in the single
  // site-wide median.
  // ---------------------------------------------------------------
  renderProjectInsight() {
    this.destroy("projectInsight");
    const ctx = document.getElementById("chart-project-insight");
    if (!ctx) return;

    const rows = (this.store.projectInsight || []).filter((r) => r.median_cycle_days !== null);

    this.instances.projectInsight = new Chart(ctx, {
      type: "bar",
      data: {
        labels: rows.map((r) => r.project_code),
        datasets: [{
          label: "Median cycle days",
          data: rows.map((r) => r.median_cycle_days),
          backgroundColor: rows.map((r) => (r.median_cycle_days > PAINTING_CONFIG.idealCycleDays ? PAINTING_CONFIG.overIdealColor : PAINTING_CONFIG.idealLineColor)),
          maxBarThickness: 34,
        }],
      },
      plugins: [this.idealLinePlugin],
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          idealLine: { value: PAINTING_CONFIG.idealCycleDays },
          datalabels: { display: "auto", formatter: (v) => `${v}d` },
          tooltip: {
            titleFont: this.chartFont,
            bodyFont: this.chartFont,
            callbacks: {
              title(items) {
                const row = rows[items[0].dataIndex];
                return row.project_name ? `${row.project_name} (${row.project_code})` : row.project_code;
              },
              label(item) {
                const row = rows[item.dataIndex];
                return ` Median ${row.median_cycle_days}d · ${row.pdi_cleared_count} cleared · ${row.stuck_long_open_count} stuck open`;
              },
            },
          },
        },
        scales: {
          x: { beginAtZero: true, grid: { display: false }, ticks: { font: this.chartFont }, title: { display: true, text: "Working days", font: this.chartFont } },
          y: { grid: { display: false }, ticks: { font: { ...this.chartFont, size: 11 } } },
        },
      },
    });
  },

  renderMaterialInsight() {
    this.destroy("materialInsight");
    const ctx = document.getElementById("chart-material-insight");
    if (!ctx) return;

    const rows = (this.store.materialInsight || []).filter((r) => r.median_cycle_days !== null);

    this.instances.materialInsight = new Chart(ctx, {
      type: "bar",
      data: {
        labels: rows.map((r) => r.material),
        datasets: [{
          label: "Median cycle days",
          data: rows.map((r) => r.median_cycle_days),
          backgroundColor: rows.map((r) => (r.median_cycle_days > PAINTING_CONFIG.idealCycleDays ? PAINTING_CONFIG.overIdealColor : PAINTING_CONFIG.idealLineColor)),
          maxBarThickness: 34,
        }],
      },
      plugins: [this.idealLinePlugin],
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          idealLine: { value: PAINTING_CONFIG.idealCycleDays },
          datalabels: { display: "auto", formatter: (v) => `${v}d` },
          tooltip: {
            titleFont: this.chartFont,
            bodyFont: this.chartFont,
            callbacks: {
              label(item) {
                const row = rows[item.dataIndex];
                return ` Median ${row.median_cycle_days}d · ${row.spool_count} spool(s) · ${row.pdi_cleared_count} cleared`;
              },
            },
          },
        },
        scales: {
          x: { beginAtZero: true, grid: { display: false }, ticks: { font: this.chartFont }, title: { display: true, text: "Working days", font: this.chartFont } },
          y: { grid: { display: false }, ticks: { font: { ...this.chartFont, size: 12 } } },
        },
      },
    });
  },
};
