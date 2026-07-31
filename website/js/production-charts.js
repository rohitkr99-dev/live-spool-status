/**
 * production-charts.js
 * ---------------------------------------------------------
 * Every chart on the Production dashboard. All numbers come
 * straight from the JSON bundle (src/production/summary.py) - this
 * file only shapes them into Chart.js datasets. Deliberately no
 * stacked bars anywhere (grouped/clustered bars only), per the
 * project owner's instruction - stacking target-vs-actual would
 * hide exactly the comparison the chart exists to show.
 *
 * Charts:
 *   1. chart-category-pie      Spool count by category (pie)
 *   2-6. chart-stage-<key>     Target vs. Actual days per stage,
 *                              one chart per category (grouped bar)
 *   7. chart-ideal-vs-actual   Target vs. Actual total cycle time,
 *                              all 5 categories side by side (grouped bar)
 */

const ProductionCharts = {

  instances: {},

  render(store) {
    this.destroyAll();
    this.renderCategoryPie(store.categoryDistribution);
    this.renderStageCharts(store.stageAgeing, store.categories);
    this.renderIdealVsActual(store.idealVsActual);
  },

  destroyAll() {
    Object.values(this.instances).forEach((chart) => chart && chart.destroy());
    this.instances = {};
  },

  _ctx(id) {
    const canvas = document.getElementById(id);
    return canvas ? canvas.getContext("2d") : null;
  },

  renderCategoryPie(distribution) {
    const ctx = this._ctx("chart-category-pie");
    if (!ctx || !distribution) return;

    const labels = distribution.map((c) => c.short_label);
    const data = distribution.map((c) => c.count);
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
        plugins: {
          legend: { position: "bottom" },
          tooltip: {
            callbacks: {
              label(item) {
                const total = item.dataset.data.reduce((a, b) => a + b, 0);
                const pct = total ? ((item.raw / total) * 100).toFixed(1) : "0.0";
                return ` ${item.label}: ${item.raw.toLocaleString()} spools (${pct}%)`;
              },
            },
          },
        },
      },
    });
  },

  renderStageCharts(stageAgeing, categories) {
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
              label: "Actual avg. (spools that reached this stage)",
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

  renderIdealVsActual(idealVsActual) {
    const ctx = this._ctx("chart-ideal-vs-actual");
    if (!ctx || !idealVsActual) return;

    const labels = idealVsActual.map((c) => c.short_label);
    const targetData = idealVsActual.map((c) => c.target_total_days);
    const actualData = idealVsActual.map((c) => c.avg_actual_total_days);

    this.instances.idealVsActual = new Chart(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "Target total (Planned Start \u2192 Packed)",
            data: targetData,
            backgroundColor: PRODUCTION_CONFIG.targetColor,
          },
          {
            label: "Actual avg. total (Packed spools only)",
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
                const lines = [`Completed (Packed): ${row.completed_count}`];
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
