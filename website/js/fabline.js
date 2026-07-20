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
    // "Completed" bucket (that's the goal state, not a jam) and
    // "Production Order Not Released" (fabrication hasn't even
    // started for those spools yet, so they can't be a fabrication
    // bottleneck - see business_rules.py Rule 0).
    const EXCLUDED_FROM_BOTTLENECK = ["Completed", "Production Order Not Released"];
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
  },
};
