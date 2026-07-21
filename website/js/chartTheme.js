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
      chart.ctx.save();
      chart.ctx.shadowColor = "rgba(23, 21, 43, 0.16)";
      chart.ctx.shadowBlur = 9;
      chart.ctx.shadowOffsetY = horizontal ? 0 : 4;
      chart.ctx.shadowOffsetX = horizontal ? 4 : 0;
    },
    afterDatasetsDraw(chart) {
      if (chart.config.type !== "bar") return;
      chart.ctx.restore();
    },
  });

})();
