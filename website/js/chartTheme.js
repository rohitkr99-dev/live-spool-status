/**
 * chartTheme.js
 * ---------------------------------------------------------
 * Global Chart.js visual defaults for the DEE light-glass theme, applied
 * once here instead of repeated in every chart file. Purely display
 * (colours, fonts) - no chart data or business logic lives here.
 *
 * Must load after the Chart.js vendor script and after config.js
 * (reads SPOOL_STATUS_CONFIG for the palette), and before any file
 * that constructs a Chart instance (charts.js, stageThroughput.js,
 * stageAgeing.js).
 */

(function () {

  const cfg = SPOOL_STATUS_CONFIG;

  Chart.defaults.color = cfg.chartTextColor;
  Chart.defaults.borderColor = cfg.chartGridColor;
  Chart.defaults.font.family = "'Manrope', -apple-system, sans-serif";
  Chart.defaults.font.size = 12;

  Chart.defaults.plugins.tooltip.backgroundColor = "rgba(255, 255, 255, 0.96)";
  Chart.defaults.plugins.tooltip.titleColor = cfg.chartTextColorStrong;
  Chart.defaults.plugins.tooltip.bodyColor = cfg.chartTextColor;
  Chart.defaults.plugins.tooltip.borderColor = "rgba(23, 21, 43, 0.1)";
  Chart.defaults.plugins.tooltip.borderWidth = 1;
  Chart.defaults.plugins.tooltip.padding = 10;
  Chart.defaults.plugins.tooltip.cornerRadius = 8;
  Chart.defaults.plugins.tooltip.displayColors = true;
  Chart.defaults.plugins.tooltip.boxPadding = 4;
  Chart.defaults.plugins.tooltip.titleFont = { family: "'IBM Plex Mono', monospace", weight: "600", size: 12 };
  Chart.defaults.plugins.tooltip.bodyFont = { family: "'IBM Plex Mono', monospace", size: 11.5 };

  Chart.defaults.plugins.legend.labels.color = cfg.chartTextColor;
  Chart.defaults.plugins.legend.labels.usePointStyle = true;
  Chart.defaults.plugins.legend.labels.pointStyle = "circle";
  Chart.defaults.plugins.legend.labels.boxWidth = 7;
  Chart.defaults.plugins.legend.labels.boxHeight = 7;

  // Data labels (2026-08-13, "add data labels to all bar charts in
  // all pages" - given by the person). chartjs-plugin-datalabels,
  // once registered, defaults to ON for every chart type it can
  // draw on - which would also clutter every pie/doughnut/line
  // chart on this dashboard with raw-value labels nobody asked for.
  // So: OFF globally first, then explicitly back ON only for
  // Chart.defaults.set('bar', ...) below - the only chart TYPE the
  // person asked for.
  //
  // display: 'auto' (not `true`) - the plugin's own overlap
  // detection, so a dense chart (a weekly trend with 50+ bars, say)
  // silently drops labels that would collide rather than rendering
  // an unreadable wall of numbers; a normal handful-of-bars chart is
  // completely unaffected by this and always shows every label.
  //
  // Every STACKED bar chart on this dashboard opts back OUT
  // individually, in its own chart config (plugins.datalabels sets
  // display:false there) - stacked segments are usually too narrow
  // for a label to read cleanly, and the person explicitly asked to
  // exclude stacked bars for now. Current full list, so a new
  // stacked chart added later doesn't accidentally inherit labels
  // and forget to opt out: charts.js (chart-project, chart-weekly),
  // production-charts.js (chart-delayed-by-project, chart-mh-
  // weekly-first-time), stageAgeing.js (chart-stage-ageing-dist),
  // stageThroughput.js (chart-stage-throughput), packing-charts.js
  // (chart-project-status).
  if (typeof ChartDataLabels !== "undefined") {

    Chart.register(ChartDataLabels);
    Chart.defaults.set("plugins.datalabels", { display: false });

    // CORRECTED 2026-08-14: Chart.js v4 keeps chart-TYPE-specific
    // defaults (bar-only, line-only, etc.) in a SEPARATE registry,
    // Chart.overrides[type] - one per registered controller, each
    // already pre-populated with that type's own scale/plugin
    // defaults. Chart.defaults.set("bar", {...}) (the previous
    // version of this block) only ever writes into Chart.defaults,
    // which per-type chart creation never reads for this - it's a
    // silent no-op, no error, the labels just never appear. Merging
    // into Chart.overrides.bar.plugins.datalabels directly (rather
    // than overwriting Chart.overrides.bar wholesale) preserves its
    // existing scale defaults, which are load-bearing for every bar
    // chart already on this dashboard.
    Chart.overrides.bar = Chart.overrides.bar || {};
    Chart.overrides.bar.plugins = Chart.overrides.bar.plugins || {};
    Chart.overrides.bar.plugins.datalabels = {
      display: "auto",
      color: cfg.chartTextColorStrong,
      font: { family: "'IBM Plex Mono', monospace", size: 10, weight: "600" },
      anchor: "end",
      align: "end",
      offset: 4,
      clip: false,
      formatter(value) {
        if (value === null || value === undefined || value === 0) return "";
        return typeof value === "number"
          ? value.toLocaleString(undefined, { maximumFractionDigits: 1 })
          : value;
      },
    };
  }

  // Rounded, breathing bars in every bar chart on the dashboard,
  // applied once here rather than per chart file - the modern
  // "BI tool" look (Power BI / Tableau) leans on soft corners and
  // generous gaps rather than square-edged, wall-to-wall bars.
  Chart.defaults.elements.bar.borderRadius = 6;
  Chart.defaults.elements.bar.borderSkipped = false;
  Chart.defaults.datasets.bar = Object.assign({}, Chart.defaults.datasets.bar, {
    barPercentage: 0.72,
    categoryPercentage: 0.72,
  });

  /**
   * Every canvas on this dashboard sits inside a translucent glass
   * card, so it needs its own opaque backing fill - both so the
   * chart reads as a solid "well" set into the glass on screen, and
   * so a canvas.toDataURL() snapshot (see pdfExport.js) doesn't lose
   * light-coloured gridlines/text to a transparent background.
   * Registered globally, so it applies to every chart type (bar,
   * line, bubble, treemap) with no per-chart wiring.
   */
  Chart.register({
    id: "spoolCanvasBackground",
    beforeDraw(chart) {
      const { ctx, width, height } = chart;
      ctx.save();
      ctx.globalCompositeOperation = "destination-over";
      ctx.fillStyle = cfg.chartWellColor;
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
    },
  });

  // ---------------------------------------------------------------
  // Gradient fills + soft elevation for bar charts (the "advanced,
  // BI-tool" chart finish requested alongside the brand refresh).
  // Every bar dataset on this dashboard sets a single flat hex (or
  // an array of them, for per-category palettes) - see charts.js /
  // stageAgeing.js / stageThroughput.js. Rather than edit each of
  // those files, this plugin intercepts the resolved colour once
  // per render and swaps it for a matching two-stop gradient, plus
  // a soft drop shadow behind every bar. Treemap cells (which use a
  // function for backgroundColor, not a hex) are left untouched.
  // ---------------------------------------------------------------

  function hexToRgb(hex) {
    const clean = String(hex).replace("#", "");
    const full = clean.length === 3
      ? clean.split("").map((c) => c + c).join("")
      : clean;
    const int = parseInt(full, 16);
    return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
  }

  function rgba({ r, g, b }, alpha) {
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function lighten(hex, amount) {
    const { r, g, b } = hexToRgb(hex);
    return {
      r: Math.round(r + (255 - r) * amount),
      g: Math.round(g + (255 - g) * amount),
      b: Math.round(b + (255 - b) * amount),
    };
  }

  function buildGradient(ctx, area, hex, horizontal) {
    const grad = horizontal
      ? ctx.createLinearGradient(area.left, 0, area.right, 0)
      : ctx.createLinearGradient(0, area.top, 0, area.bottom);
    const top = lighten(hex, 0.38);
    const base = hexToRgb(hex);
    if (horizontal) {
      grad.addColorStop(0, rgba(base, 0.92));
      grad.addColorStop(1, rgba(top, 0.96));
    } else {
      grad.addColorStop(0, rgba(top, 0.98));
      grad.addColorStop(1, rgba(base, 0.94));
    }
    return grad;
  }

  function resolveColors(ctx, area, source, horizontal) {
    if (Array.isArray(source)) {
      return source.map((c) => resolveColors(ctx, area, c, horizontal));
    }
    if (typeof source !== "string") return source; // functions (treemap) pass through untouched
    return buildGradient(ctx, area, source, horizontal);
  }

  Chart.register({
    id: "spoolGradientBars",
    beforeDatasetsDraw(chart) {
      if (chart.config.type !== "bar" || !chart.chartArea) return;
      const horizontal = chart.options.indexAxis === "y";
      chart.data.datasets.forEach((dataset) => {
        if (dataset.__spoolBaseColor === undefined) {
          dataset.__spoolBaseColor = dataset.backgroundColor;
        }
        dataset.backgroundColor = resolveColors(chart.ctx, chart.chartArea, dataset.__spoolBaseColor, horizontal);
      });
    },
    // Shadow save/restore scoped to EACH individual dataset's own
    // draw (the SINGULAR beforeDatasetDraw/afterDatasetDraw hooks,
    // not the plural ones above) - fixed 2026-08-14. Chart.js always
    // finishes every dataset's singular before/afterDatasetDraw
    // BEFORE it ever reaches the plural afterDatasetsDraw phase,
    // where chartjs-plugin-datalabels draws its labels - so scoping
    // save/restore to the singular hooks guarantees the shadow is
    // torn down before any label gets drawn, regardless of plugin
    // REGISTRATION order. The previous version used the plural
    // hooks for save/restore too, which only worked by accident of
    // this plugin happening to register after ChartDataLabels; once
    // datalabels started drawing (2026-08-13), every label was drawn
    // while the bar shadow was still active on the canvas context -
    // producing exactly the doubled/ghosted label text reported.
    beforeDatasetDraw(chart) {
      if (chart.config.type !== "bar" || !chart.chartArea) return;
      const horizontal = chart.options.indexAxis === "y";
      chart.ctx.save();
      chart.ctx.shadowColor = "rgba(23, 21, 43, 0.16)";
      chart.ctx.shadowBlur = 9;
      chart.ctx.shadowOffsetY = horizontal ? 0 : 4;
      chart.ctx.shadowOffsetX = horizontal ? 4 : 0;
    },
    afterDatasetDraw(chart) {
      if (chart.config.type !== "bar") return;
      chart.ctx.restore();
    },
  });

})();
