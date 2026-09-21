/**
 * fabline.js
 * ---------------------------------------------------------
 * Renders the "Fabrication Line" - the dashboard's signature visual.
 * Each stage from current_stage_distribution becomes a block in a
 * uniform grid, always exactly 2 rows (2026-09-21, per the person:
 * "Make 2 rows and make the cards of equal shape and size so that it
 * looks balanced and good"). Column count is computed here and set
 * on the container's inline style; every card's own size comes from
 * CSS (website/css/styles.css -> .fabline / .fabline__stage), not
 * from spool count - the "widest block = bottleneck" idea this
 * section used before (proportional flex-grow widths) reliably
 * overflowed its container once an 11th stage card was added, with
 * nothing to catch the overflow. The Bottleneck badge + count number
 * carry that signal now instead of width.
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

    // Exactly 2 rows, whatever the stage count turns out to be -
    // the mobile breakpoint overrides this (with !important, since
    // it has to beat this inline style) to a narrower, more-rows
    // layout instead.
    container.style.gridTemplateColumns = `repeat(${Math.ceil(order.length / 2)}, 1fr)`;

    // Bottleneck = the largest WIP stage, excluding the terminal
    // "Completed" bucket and "Dispatch" (already Packed and just
    // awaiting shipment - not a fabrication bottleneck, per the
    // project owner: "any box which is packed is not a bottleneck
    // for the company"), "Production Order Not Released"
    // (fabrication hasn't even started for those spools yet, so
    // they can't be a fabrication bottleneck either - see
    // business_rules.py Rule 0), and "Spools Planned in Next Week"
    // (2026-09-21, same reasoning - on schedule and not yet due, not
    // a real backlog - see summary.py -> PLANNED_NEXT_WEEK_LABEL).
    const EXCLUDED_FROM_BOTTLENECK = [
      "Completed", "Dispatch", "Production Order Not Released", "Spools Planned in Next Week",
    ];
    let bottleneckStage = null;
    let bottleneckCount = -1;
    for (const stage of order) {
      if (EXCLUDED_FROM_BOTTLENECK.includes(stage)) continue;
      if (distribution[stage] > bottleneckCount) {
        bottleneckCount = distribution[stage];
        bottleneckStage = stage;
      }
    }

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
};
