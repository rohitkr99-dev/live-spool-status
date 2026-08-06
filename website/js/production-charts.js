/**
 * production-charts.js
 * ---------------------------------------------------------
 * Every chart on the Production dashboard. Aggregation itself
 * (sums, weighted averages) lives in ProductionAggregate
 * (production-filters.js) so the same logic drives every chart and
 * reacts to the metric + Project filters above them; this file only
 * shapes the aggregated numbers into Chart.js datasets. Every
 * per-spool number (category, Welding Finish, days per stage,
 * delayed flag) is still 100% computed in Python - see
 * src/production/.
 *
 * Deliberately no stacked bars anywhere EXCEPT the Delayed vs. In
 * Time by Project chart, per the project owner's instruction -
 * stacking target-vs-actual would hide exactly the comparison those
 * charts exist to show, but Delayed/On Time genuinely is a part-of-
 * whole split per project, which is what stacking is for.
 *
 * Charts:
 *   1. chart-category-pie      Spool count/metric by category (pie)
 *   2. chart-delayed-by-project  Delayed vs. In Time spool count per
 *                              project (stacked bar) - unreleased
 *                              spools never reach this dashboard at
 *                              all (excluded in src/production/ageing.py)
 *   3-8. chart-stage-<key>     Target vs. Actual days per stage,
 *                              one chart per category (grouped bar)
 *   9. chart-ideal-vs-actual   Target vs. Actual total cycle time,
 *                              every category side by side (grouped bar)
 */

const ProductionCharts = {

  instances: {},

  render(store) {
    this.destroyAll();

    const metric = ProductionFilters.getMetric(store);
    const chartSpools = ProductionFilters.spoolsForCharts(store);

    const distribution = ProductionAggregate.categoryDistribution(chartSpools, store.categories, metric);
    const stageAgeing = ProductionAggregate.stageAgeing(
      chartSpools, store.categories, store.categoryStages, store.targetDays, metric
    );
    const idealVsActual = ProductionAggregate.idealVsActual(
      chartSpools, store.categories, store.categoryStages, store.targetDays, metric
    );
    const delayedByProject = ProductionAggregate.delayedByProject(chartSpools);

    this.renderCategoryPie(distribution, metric);
    this.renderDelayedByProject(delayedByProject);
    this.renderStageCharts(stageAgeing, store.categories, metric);
    this.renderIdealVsActual(idealVsActual, metric);

    document.getElementById("chart-spool-count-note").textContent =
      `${chartSpools.length.toLocaleString()} spool(s) in this view`;
  },

  destroyAll() {
    Object.values(this.instances).forEach((chart) => chart && chart.destroy());
    this.instances = {};
  },

  _ctx(id) {
    const canvas = document.getElementById(id);
    return canvas ? canvas.getContext("2d") : null;
  },

  renderCategoryPie(distribution, metric) {
    const ctx = this._ctx("chart-category-pie");
    if (!ctx || !distribution) return;

    const labels = distribution.map((c) => c.short_label);
    const data = distribution.map((c) => c.value);
    const colors = distribution.map((c) => PRODUCTION_CONFIG.categoryColor[c.key] || "#8A8FA6");

    this.instances.pie = new Chart(ctx, {
      type: "pie",
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: colors,
          borderColor: "#FFFFFF",
          borderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        // A single wide card with a round chart in it leaves a lot of
        // empty space either side of the circle - putting the legend
        // there (instead of a cramped row underneath) uses that space
        // and gives room to show each slice's % alongside its label.
        // Falls back to a bottom legend on narrow/mobile widths where
        // there's no side space to use.
        plugins: {
          legend: {
            position: window.innerWidth < 640 ? "bottom" : "right",
            align: "center",
            labels: {
              boxWidth: 13,
              boxHeight: 13,
              padding: 14,
              font: { size: 12.5, weight: "600" },
              generateLabels(chart) {
                const data = chart.data;
                if (!data.labels.length || !data.datasets.length) return [];
                const dataset = data.datasets[0];
                const total = dataset.data.reduce((a, b) => a + b, 0);
                return data.labels.map((label, i) => {
                  const value = dataset.data[i];
                  const pct = total ? ((value / total) * 100).toFixed(1) : "0.0";
                  return {
                    text: `${label} \u2013 ${pct}%`,
                    fillStyle: dataset.backgroundColor[i],
                    strokeStyle: dataset.borderColor,
                    lineWidth: dataset.borderWidth,
                    hidden: false,
                    index: i,
                  };
                });
              },
            },
          },
          tooltip: {
            callbacks: {
              label(item) {
                const total = item.dataset.data.reduce((a, b) => a + b, 0);
                const pct = total ? ((item.raw / total) * 100).toFixed(1) : "0.0";
                return ` ${item.label}: ${item.raw.toLocaleString()} ${metric.unit} (${pct}%)`;
              },
            },
          },
        },
      },
    });
  },

  renderDelayedByProject(rows) {
    const ctx = this._ctx("chart-delayed-by-project");
    if (!ctx || !rows || !rows.length) return;

    const labels = rows.map((r) => r.project);
    const delayedData = rows.map((r) => r.delayed);
    const onTimeData = rows.map((r) => r.onTime);

    this.instances.delayedByProject = new Chart(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "Delayed",
            data: delayedData,
            backgroundColor: PRODUCTION_CONFIG.delayedColor,
          },
          {
            label: "In Time",
            data: onTimeData,
            backgroundColor: PRODUCTION_CONFIG.onTimeColor,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { stacked: true },
          y: { stacked: true, beginAtZero: true, title: { display: true, text: "Spool count" } },
        },
        plugins: {
          legend: { position: "bottom" },
          tooltip: {
            callbacks: {
              afterBody(items) {
                const row = rows[items[0].dataIndex];
                const total = row.delayed + row.onTime;
                const pct = total ? Math.round((row.delayed / total) * 100) : 0;
                return [`${pct}% of this project's tracked spools are delayed`];
              },
            },
          },
        },
      },
    });
  },

  renderStageCharts(stageAgeing, categories, metric) {
    (categories || []).forEach((cat) => {
      const canvasId = `chart-stage-${cat.key}`;
      const ctx = this._ctx(canvasId);
      const catData = stageAgeing ? stageAgeing[cat.key] : null;
      if (!ctx || !catData) return;

      const stages = catData.stages || [];
      const labels = stages.map((s) => s.label);
      const targetData = stages.map((s) => s.target_days);
      const actualData = stages.map((s) => s.avg_actual_days);
      const color = PRODUCTION_CONFIG.categoryColor[cat.key] || PRODUCTION_CONFIG.actualColor;

      const actualLabel = metric.key === "spool_count"
        ? "Actual avg. (spools that reached this stage)"
        : `Actual avg., weighted by ${metric.label}`;

      this.instances[canvasId] = new Chart(ctx, {
        type: "bar",
        data: {
          labels,
          datasets: [
            {
              label: "Target (days from Planned Start)",
              data: targetData,
              backgroundColor: PRODUCTION_CONFIG.targetColor,
            },
            {
              label: actualLabel,
              data: actualData,
              backgroundColor: color,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            y: { beginAtZero: true, title: { display: true, text: "Days from Planned Start" } },
          },
          plugins: {
            legend: { position: "bottom" },
            tooltip: {
              callbacks: {
                afterBody(items) {
                  const stage = stages[items[0].dataIndex];
                  const lines = [`Reached so far: ${stage.reached_count} spool(s)`];
                  if (stage.pending_count) {
                    lines.push(
                      `Still short of this stage: ${stage.pending_count} spool(s)` +
                      (stage.avg_pending_age_days != null
                        ? `, avg. age ${stage.avg_pending_age_days}d`
                        : "")
                    );
                  }
                  return lines;
                },
              },
            },
          },
        },
      });
    });
  },

  renderIdealVsActual(idealVsActual, metric) {
    const ctx = this._ctx("chart-ideal-vs-actual");
    if (!ctx || !idealVsActual) return;

    const labels = idealVsActual.map((c) => c.short_label);
    const targetData = idealVsActual.map((c) => c.target_total_days);
    const actualData = idealVsActual.map((c) => c.avg_actual_total_days);

    const actualLabel = metric.key === "spool_count"
      ? "Actual avg. total (completed spools only)"
      : `Actual avg. total, weighted by ${metric.label}`;

    this.instances.idealVsActual = new Chart(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "Target total (Planned Start \u2192 final stage)",
            data: targetData,
            backgroundColor: PRODUCTION_CONFIG.targetColor,
          },
          {
            label: actualLabel,
            data: actualData,
            backgroundColor: PRODUCTION_CONFIG.actualColor,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: { beginAtZero: true, title: { display: true, text: "Days from Planned Start" } },
        },
        plugins: {
          legend: { position: "bottom" },
          tooltip: {
            callbacks: {
              afterBody(items) {
                const row = idealVsActual[items[0].dataIndex];
                const lines = [`Completed: ${row.completed_count}`];
                if (row.open_count) {
                  lines.push(
                    `Still open: ${row.open_count}` +
                    (row.avg_open_age_days != null ? `, avg. age ${row.avg_open_age_days}d` : "")
                  );
                }
                return lines;
              },
            },
          },
        },
      },
    });
  },
};
