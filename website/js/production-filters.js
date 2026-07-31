/**
 * production-filters.js
 * ---------------------------------------------------------
 * Two independent, separate filter systems sharing one underlying
 * per-spool array (store.spools, from production_data.json - fully
 * computed in Python, see src/production/summary.py):
 *
 *  - Chart filters (global, above the charts): which metric to
 *    measure by (Spool Count / Quantity / Inch Dia / Weight /
 *    Surface Area) and which Project(s) to include. All 7 charts
 *    react to both.
 *  - Table filters (per column, on the spool table): independent
 *    multi-select on each column, plus a live subtotal row. Do NOT
 *    affect the charts above - a separate, more granular filter set
 *    for drilling into the table itself.
 *
 * All aggregation (sums, weighted averages, distributions) happens
 * here in JS, not in Python - it has to, since it depends on
 * whichever combination of filters is currently selected, which
 * Python can't precompute for every possibility. Python's job stays
 * computing the per-spool numbers (category, Welding Finish, days
 * per stage, delayed flag) - see src/production/. This module only
 * groups/sums/averages what Python already calculated.
 */

const ProductionFilters = {

  // ---- Chart filters (global) ----
  selectedMetricKey: "spool_count",
  selectedProjects: null, // null = all projects

  setMetric(key) {
    this.selectedMetricKey = key;
  },

  setProjects(projectList) {
    // empty array/null both mean "all projects" - never show zero data
    this.selectedProjects = (!projectList || projectList.length === 0) ? null : projectList;
  },

  getMetric(store) {
    return (store.metrics || []).find((m) => m.key === this.selectedMetricKey) || store.metrics[0];
  },

  spoolsForCharts(store) {
    if (!this.selectedProjects) return store.spools;
    const set = new Set(this.selectedProjects);
    return store.spools.filter((s) => set.has(s.project_code));
  },

  // ---- Table filters (per column) ----
  // columnKey -> Set of selected values (absent/empty = no filter on that column)
  tableColumnFilters: {},

  setColumnFilter(columnKey, values) {
    if (!values || values.length === 0) {
      delete this.tableColumnFilters[columnKey];
    } else {
      this.tableColumnFilters[columnKey] = new Set(values);
    }
  },

  clearTableFilters() {
    this.tableColumnFilters = {};
  },
};


const ProductionAggregate = {

  /**
   * Sum/count per category for the pie chart. "Spool Count" sums 1
   * per spool; any other metric sums that spool's raw field value
   * (e.g. total Weight in that category), skipping spools where the
   * field is null.
   */
  categoryDistribution(spools, categories, metric) {
    const totals = {};
    categories.forEach((c) => { totals[c.key] = 0; });

    spools.forEach((s) => {
      if (!(s.category_key in totals)) return;
      if (metric.field === null) {
        totals[s.category_key] += 1;
      } else {
        const value = s[metric.field];
        if (value !== null && value !== undefined) totals[s.category_key] += value;
      }
    });

    return categories.map((c) => ({
      key: c.key,
      label: c.label,
      short_label: c.short_label,
      value: Math.round(totals[c.key] * 100) / 100,
    }));
  },

  /**
   * Weighted average of `values[i]` weighted by `weights[i]` -
   * "Spool Count" passes weight 1 for every spool (a plain average).
   * Spools with a null/zero weight are skipped for any other metric
   * (nothing meaningful to weight by).
   */
  _weightedAverage(pairs) {
    let weightedSum = 0;
    let weightTotal = 0;
    let count = 0;
    pairs.forEach(([value, weight]) => {
      if (value === null || value === undefined) return;
      if (weight === null || weight === undefined || weight <= 0) return;
      weightedSum += value * weight;
      weightTotal += weight;
      count += 1;
    });
    if (weightTotal === 0) return { avg: null, count: 0 };
    return { avg: Math.round((weightedSum / weightTotal) * 10) / 10, count };
  },

  _weightFor(spool, metric) {
    return metric.field === null ? 1 : spool[metric.field];
  },

  /**
   * Per category, per tracked stage: target (always the fixed
   * config day-count - a target doesn't have a "weighted" version)
   * vs. the metric-weighted average ACTUAL days for spools that
   * reached that stage, plus the pending backlog's weighted average
   * current age. Mirrors src/production/summary.py -> build_stage_ageing(),
   * but computed here so it can react to the metric + project filters.
   */
  stageAgeing(spools, categories, stageOrder, stageLabels, targetDays, metric) {
    const out = {};

    categories.forEach((cat) => {
      const catSpools = spools.filter((s) => s.category_key === cat.key && s.planned_start);

      const stages = stageOrder.map((stage) => {
        const reachedPairs = [];
        const pendingPairs = [];
        let reachedCount = 0;
        let pendingCount = 0;

        catSpools.forEach((s) => {
          const days = s.stage_days ? s.stage_days[stage] : null;
          const weight = this._weightFor(s, metric);
          if (days === null || days === undefined) return;

          if (s.current_stage === stage && !s.is_complete) {
            pendingPairs.push([days, weight]);
            pendingCount += 1;
          } else {
            reachedPairs.push([days, weight]);
            reachedCount += 1;
          }
        });

        const reached = this._weightedAverage(reachedPairs);
        const pending = this._weightedAverage(pendingPairs);

        return {
          stage,
          label: stageLabels[stage] || stage,
          target_days: (targetDays[cat.key] || {})[stage] ?? null,
          avg_actual_days: reached.avg,
          reached_count: reachedCount,
          pending_count: pendingCount,
          avg_pending_age_days: pending.avg,
        };
      });

      out[cat.key] = {
        key: cat.key,
        label: cat.label,
        short_label: cat.short_label,
        spool_count: catSpools.length,
        stages,
      };
    });

    return out;
  },

  /**
   * One row per category: target total (Planned Start -> Packed)
   * vs. the metric-weighted average ACTUAL total for Packed spools,
   * plus the weighted average current age of spools still open.
   * Mirrors src/production/summary.py -> build_ideal_vs_actual().
   */
  idealVsActual(spools, categories, targetDays, metric) {
    return categories.map((cat) => {
      const catSpools = spools.filter((s) => s.category_key === cat.key && s.planned_start);

      const completedPairs = [];
      const openPairs = [];
      catSpools.forEach((s) => {
        const weight = this._weightFor(s, metric);
        const packedDays = s.stage_days ? s.stage_days.packed : null;
        if (s.is_complete && packedDays !== null && packedDays !== undefined) {
          completedPairs.push([packedDays, weight]);
        } else if (!s.is_complete && s.current_age_days !== null && s.current_age_days !== undefined) {
          openPairs.push([s.current_age_days, weight]);
        }
      });

      const completed = this._weightedAverage(completedPairs);
      const open = this._weightedAverage(openPairs);

      return {
        key: cat.key,
        label: cat.label,
        short_label: cat.short_label,
        target_total_days: (targetDays[cat.key] || {}).packed ?? null,
        avg_actual_total_days: completed.avg,
        completed_count: completed.count,
        avg_open_age_days: open.avg,
        open_count: open.count,
      };
    });
  },
};
