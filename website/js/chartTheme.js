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

})();
