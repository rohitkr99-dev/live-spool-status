/**
 * fabline.js
 * ---------------------------------------------------------
 * Renders the "Fabrication Line" - the dashboard's signature visual.
 * Each stage from current_stage_distribution becomes a block; block
 * width is proportional to spool count, so the widest block is
 * visibly where work is piling up (the bottleneck).
 *
 * Purely a rendering of dashboard_summary.json ->
 * current_stage_distribution. No counting happens here.
 */

const SpoolFabline = {

  render(dashboardSummary) {

    const distribution = dashboardSummary.current_stage_distribution;
    const container = document.getElementById("fabline");
    const bottleneckNote = document.getElementById("fabline-bottleneck");

    container.innerHTML = "";

    const order = SPOOL_STATUS_CONFIG.stageOrder.filter(
      (stage) => stage in distribution
    );

    // Bottleneck = the largest WIP stage, excluding the terminal
    // "Completed" bucket and "Dispatch" (already Packed and just
    // awaiting shipment - not a fabrication bottleneck, per the
    // project owner: "any box which is packed is not a bottleneck
    // for the company") and "Production Order Not Released"
    // (fabrication hasn't even started for those spools yet, so
    // they can't be a fabrication bottleneck either - see
    // business_rules.py Rule 0).
    const EXCLUDED_FROM_BOTTLENECK = ["Completed", "Dispatch", "Production Order Not Released"];
    let bottleneckStage = null;
    let bottleneckCount = -1;
    for (const stage of order) {
      if (EXCLUDED_FROM_BOTTLENECK.includes(stage)) continue;
      if (distribution[stage] > bottleneckCount) {
        bottleneckCount = distribution[stage];
        bottleneckStage = stage;
      }
    }

    const maxCount = Math.max(...order.map((s) => distribution[s]), 1);

    for (const stage of order) {
      const count = distribution[stage];
      const isBottleneck = stage === bottleneckStage;
      const isComplete = stage === "Completed";

      const block = document.createElement("div");
      block.className = "fabline__stage";
      if (isBottleneck) block.classList.add("fabline__stage--bottleneck");
      if (isComplete) block.classList.add("fabline__stage--complete");

      const color = SPOOL_STATUS_CONFIG.stageColor[stage] || SPOOL_STATUS_CONFIG.defaultStageColor;
      block.style.setProperty("--stage-color", color);

      // Width proportional to count, with a floor so zero/small
      // stages stay visible and readable.
      const proportion = count / maxCount;
      block.style.flexGrow = String(Math.max(proportion * 10, 0.6));

      const name = document.createElement("span");
      name.className = "fabline__stage-name";
      name.textContent = stage;

      const countEl = document.createElement("span");
      countEl.className = "fabline__stage-count";
      countEl.textContent = new Intl.NumberFormat("en-US").format(count);

      block.appendChild(name);
      if (isBottleneck && count > 0) {
        const badge = document.createElement("span");
        badge.className = "fabline__stage-badge";
        badge.textContent = "Bottleneck";
        block.appendChild(badge);
      }
      block.appendChild(countEl);
      block.title = `${stage}: ${count} spool${count === 1 ? "" : "s"}`;

      container.appendChild(block);
    }

    if (bottleneckStage && bottleneckCount > 0) {
      bottleneckNote.innerHTML =
        `Busiest stage right now: <strong>${bottleneckStage}</strong> — ${new Intl.NumberFormat("en-US").format(bottleneckCount)} spools waiting.`;
    } else {
      bottleneckNote.textContent = "No spools currently in progress.";
    }

    this.renderReworkQuantum(dashboardSummary.rework_quantum);
    this.renderHoldByProjectStage(dashboardSummary.hold_by_project_stage);
  },

  // "Holds & Reworks" reconciliation strip - see
  // src/summary.py -> generate_dashboard_summary()'s
  // "rework_quantum". Sits just under the bottleneck note; hidden
  // entirely if the source data has neither.
  renderReworkQuantum(reworkQuantum) {
    const el = document.getElementById("fabline-rework-quantum");
    if (!el) return;

    const rework = (reworkQuantum && reworkQuantum.rework) || 0;
    const hold = (reworkQuantum && reworkQuantum.hold) || 0;

    if (!rework && !hold) {
      el.hidden = true;
      return;
    }

    const fmt = (n) => new Intl.NumberFormat("en-US").format(n);
    el.hidden = false;
    el.innerHTML = `
      <span class="fabline-rework-quantum__item">
        <span class="fabline-rework-quantum__dot" style="background: var(--status-danger, #C0392B);"></span>
        <span class="fabline-rework-quantum__count">${fmt(rework)}</span> in Rework
      </span>
      <span class="fabline-rework-quantum__item">
        <span class="fabline-rework-quantum__dot" style="background: var(--status-warning);"></span>
        <span class="fabline-rework-quantum__count">${fmt(hold)}</span> on Hold
      </span>
    `;
  },

  /**
   * "Currently on Hold, by Project and stage" (2026-08-21, given by
   * the person: "insert a separate chart for only Hold spools,
   * where we can show Project wise stage wise current Hold
   * quantity"). Source: dashboardSummary.hold_by_project_stage, a
   * {project: {stageName: count}} cross-tab
   * (src/summary.py -> generate_dashboard_summary()) - exactly the
   * population current_stage_distribution above now excludes (see
   * that same function). Stacked bar, reusing the same stage
   * colours as the Fabrication Line itself
   * (SPOOL_STATUS_CONFIG.stageColor) so a project's Hold breakdown
   * visually matches the stage blocks above it.
   */
  renderHoldByProjectStage(holdByProjectStage) {
    const ctx = document.getElementById("chart-hold-by-project-stage");
    const wrapper = document.getElementById("hold-by-project-stage-wrapper");
    const emptyNote = document.getElementById("hold-by-project-stage-empty");
    if (!ctx) return;

    if (this._holdChart) {
      this._holdChart.destroy();
      this._holdChart = null;
    }

    const projects = Object.keys(holdByProjectStage || {});
    if (!projects.length) {
      if (wrapper) wrapper.style.display = "none";
      if (emptyNote) emptyNote.hidden = false;
      return;
    }
    if (wrapper) wrapper.style.display = "";
    if (emptyNote) emptyNote.hidden = true;

    const cfg = SPOOL_STATUS_CONFIG;
    const stageNames = cfg.stageOrder.filter(
      (stage) => projects.some((project) => holdByProjectStage[project][stage])
    );
    // Any stage name the data has that isn't in the known stageOrder
    // (shouldn't normally happen) is still shown, just appended last.
    for (const project of projects) {
      for (const stage of Object.keys(holdByProjectStage[project])) {
        if (!stageNames.includes(stage)) stageNames.push(stage);
      }
    }

    const datasets = stageNames.map((stage) => ({
      label: stage,
      data: projects.map((project) => holdByProjectStage[project][stage] || 0),
      backgroundColor: cfg.stageColor[stage] || cfg.defaultStageColor,
      borderRadius: 2,
    }));

    this._holdChart = new Chart(ctx, {
      type: "bar",
      data: { labels: projects, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          datalabels: { display: false },
          legend: { position: "top", align: "end", labels: { boxWidth: 10, usePointStyle: true, pointStyle: "circle" } },
        },
        scales: {
          x: { stacked: true, grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true } },
          y: {
            stacked: true, beginAtZero: true, grid: { display: false },
            ticks: { precision: 0 },
            title: { display: true, text: "Spool count currently on Hold" },
          },
        },
      },
    });
  },
};
