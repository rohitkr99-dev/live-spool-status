/**
 * studio-theme.js (DEE Maroon skin)
 * ---------------------------------------------------------
 * The chart half of the Studio skin (css/studio.css is the card half).
 * Loaded only when <html data-skin="studio"> is set, right after
 * chartTheme.js and before any chart is built. It changes bar shape and
 * the chart "chrome" only - no data, no calculation, and no data colours:
 * every chart keeps the stage / status colours the rest of the site uses,
 * so the same stage looks the same on every page.
 *   - flat bars with a fine 4px corner and a small gap between stacked
 *     segments, instead of gradient bars with a drop shadow;
 *   - charcoal tooltips, charts sitting directly on the card colour;
 *   - dark text on light treemap boxes.
 */
(function () {

  const cfg = SPOOL_STATUS_CONFIG;

  const explicit = document.documentElement.getAttribute("data-theme");
  const isDark = explicit
    ? explicit === "dark"
    : !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);

  const INK = isDark ? "#F2F4F3" : "#3A1214";
  const CARD = isDark ? "#292929" : "#FFFFFF";

  cfg.chartTextColor = isDark ? "rgba(242, 244, 243, 0.64)" : "rgba(58, 18, 20, 0.62)";
  cfg.chartTextColorStrong = INK;
  cfg.chartGridColor = isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(58, 18, 20, 0.07)";
  cfg.chartWellColor = CARD;

  Chart.defaults.color = cfg.chartTextColor;
  Chart.defaults.borderColor = cfg.chartGridColor;
  Chart.defaults.font.family = "'Manrope', -apple-system, sans-serif";
  Chart.defaults.font.weight = "500";

  const tip = Chart.defaults.plugins.tooltip;
  tip.backgroundColor = "#3A1214";
  tip.titleColor = "#FFFFFF";
  tip.bodyColor = "rgba(255, 255, 255, 0.82)";
  tip.borderWidth = 0;
  tip.cornerRadius = 14;
  tip.padding = 12;
  tip.titleFont = { family: "'Manrope', sans-serif", weight: "700", size: 12 };
  tip.bodyFont = { family: "'Manrope', sans-serif", weight: "500", size: 12 };

  if (Chart.overrides.bar && Chart.overrides.bar.plugins && Chart.overrides.bar.plugins.datalabels) {
    Chart.overrides.bar.plugins.datalabels.color = INK;
    Chart.overrides.bar.plugins.datalabels.font = { family: "'Manrope', sans-serif", size: 10, weight: "700" };
  }

  // Flat fills: switch off the gradient + drop-shadow plugin from chartTheme.js
  try {
    const gradientPlugin = Chart.registry.plugins.get("spoolGradientBars");
    if (gradientPlugin) Chart.unregister(gradientPlugin);
  } catch (error) { /* plugin not registered: nothing to switch off */ }

  Chart.defaults.elements.bar.borderRadius = 4;
  Chart.defaults.datasets.bar = Object.assign({}, Chart.defaults.datasets.bar, {
    barPercentage: 0.72,
    categoryPercentage: 0.85,
  });
  Chart.defaults.elements.line.borderWidth = 3;
  Chart.defaults.elements.point.radius = 0;

  // Treemap labels are white in the shared code; on light boxes they need to be dark.
  function isLight(hex) {
    const n = parseInt(String(hex).replace("#", "").slice(0, 6), 16);
    const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
    return lum > 0.62;
  }

  Chart.register({
    id: "studioTreemap",
    beforeUpdate(chart) {
      if (chart.config.type !== "treemap") return;
      chart.data.datasets.forEach((ds) => {
        if (!ds.labels) return;
        ds.labels.color = (ctx) => {
          const stage = ctx.raw && ctx.raw._data && ctx.raw._data.stage;
          const fill = (cfg.stageColor && cfg.stageColor[stage]) || cfg.defaultStageColor;
          return fill && isLight(fill) ? "#3A1214" : "#FFFFFF";
        };
        ds.labels.font = { family: "'Manrope', sans-serif", size: 12, weight: "700" };
      });
    },
  });

  Chart.register({
    id: "studioBars",
    beforeUpdate(chart) {
      if (chart.config.type !== "bar") return;
      const sc = chart.options.scales || {};
      const stacked = !!((sc.x && sc.x.stacked) || (sc.y && sc.y.stacked));
      chart.data.datasets.forEach((ds) => {
        // Stacked segments touch: a hairline separator (0.5px each side) and a tighter corner.
        ds.borderRadius = stacked ? 2 : 4;
        if (!stacked) ds.maxBarThickness = 44;
        ds.borderSkipped = false;
        ds.borderWidth = stacked ? 0.5 : 1;
        ds.borderColor = CARD;
      });
    },
  });
})();
