/**
 * spool-traveler.js
 * ---------------------------------------------------------
 * Spool search for the Spool Traveler page. Reads the same published
 * spool records every other dashboard page already loads
 * (SpoolData.fetchPublished(), see data.js) and adds no new data
 * file, endpoint or stored copy.
 *
 * Identity: Project + Drawing + Spool is the unique item key
 * (the record's "Composite Key"). A query that matches more than one
 * item shows candidates and waits for the user to pick one; only the
 * picked record is ever rendered, so records from different drawings
 * or spools can never mix.
 *
 * Joint-level fit-up/welding rows are NOT available: they would come
 * from joint-level source data that the site has no signed-in-only
 * path for (the published bundles are static files). The joint
 * section says so instead of showing anything - see
 * docs/spool-traveler-joint-data.md. Fit-up and welding dates are
 * deliberately not taken from the spool record either.
 */
(function () {
  "use strict";

  const MIN_QUERY = 2;
  const MAX_CANDIDATES = 50;

  // Date fields are the spool record's own stage dates: Release, PDQC,
  // Ready for Painting, Painting, Packing and Dispatch come from the
  // DPR; Material is the Material Handover date; Plan is the Planned
  // Start date. A field the published data does not carry at all (not even as blank) shows "No date published"
  // rather than "Not yet". Owner labels follow the plant's rule: PDQC
  // belongs to Production, Ready for Painting to QC.
  const STAGES = [
    { id: "release", field: "Prod Order Release", at: ["Production Order Not Released"] },
    { id: "material", field: "Material Handover" },
    { id: "plan", field: "Planned Start" },
    { id: "pdqc", field: "PDQC", owner: "Production", at: ["PDQC"] },
    { id: "rfp", field: "RFP", owner: "QC", at: ["Ready for Painting"] },
    { id: "painting", field: "PDI", at: ["Under Painting"] },
    { id: "packing", field: "Packing", at: ["Packing"] },
    { id: "dispatch", field: "Dispatch", at: ["Dispatch", "Completed"] },
  ];

  const $ = (id) => document.getElementById(id);
  const state = { records: [], selectedKey: null, results: [] };

  const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });

  function formatDate(value) {
    if (!value) return null;
    const parsed = new Date(String(value).slice(0, 10) + "T00:00:00Z");
    return Number.isNaN(parsed.getTime()) ? String(value) : dateFormat.format(parsed);
  }

  function text(value) {
    return value === null || value === undefined || value === "" ? "—" : String(value);
  }

  function el(tag, className, content) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content !== undefined) node.textContent = content;
    return node;
  }

  function setNote(message, kind) {
    const note = $("spool-note");
    note.textContent = message;
    note.dataset.kind = kind || "";
  }

  // ---------------------------------------------------------
  // Search
  // ---------------------------------------------------------

  function haystack(record) {
    return [record["Project Code"], record["Project Name"], record["Drawing No"], record["Spool No"]]
      .map((part) => String(part || "").toLowerCase())
      .join("\u0001");
  }

  function search(query) {
    const terms = query.toLowerCase().replace(/\|/g, " ").split(/\s+/).filter(Boolean);
    if (!terms.length) return [];

    const matches = [];
    for (const record of state.records) {
      const hay = record._hay;
      if (!terms.every((term) => hay.includes(term))) continue;

      // Exact drawing/spool/project hits sort ahead of partial ones.
      let rank = 2;
      const fields = [record["Drawing No"], record["Spool No"], record["Project Code"], record["Project Name"]]
        .map((v) => String(v || "").toLowerCase());
      if (terms.some((term) => fields.includes(term))) rank = 0;
      else if (terms.some((term) => fields.some((f) => f.startsWith(term)))) rank = 1;
      matches.push({ record, rank });
    }

    matches.sort((a, b) =>
      a.rank - b.rank
      || String(a.record["Project Name"] || "").localeCompare(String(b.record["Project Name"] || ""))
      || String(a.record["Drawing No"] || "").localeCompare(String(b.record["Drawing No"] || ""), undefined, { numeric: true })
      || String(a.record["Spool No"] || "").localeCompare(String(b.record["Spool No"] || ""), undefined, { numeric: true }));
    return matches.map((m) => m.record);
  }

  function runSearch(event) {
    event.preventDefault();
    const query = $("spool-search").value.trim();

    // A new search always clears the previous selection first, so a
    // stale item can never sit beside new candidates.
    clearSelection();
    hideResults();

    if (query.length < MIN_QUERY) {
      setNote(`Enter at least ${MIN_QUERY} characters of a Project, Drawing, or Spool.`, "warn");
      return;
    }

    const found = search(query);
    state.results = found;

    if (!found.length) {
      setNote(`No spool matches “${query}”. Check the Project, Drawing, or Spool and try again.`, "warn");
      return;
    }

    if (found.length === 1) {
      setNote("1 spool found.", "ok");
      select(found[0]);
      return;
    }

    setNote(`${found.length.toLocaleString()} spools match. Select one to see its status.`, "ok");
    showCandidates(found);
  }

  // ---------------------------------------------------------
  // Candidates
  // ---------------------------------------------------------

  function hideResults() {
    $("spool-results").hidden = true;
    $("spool-candidates").replaceChildren();
  }

  function showCandidates(found) {
    const shown = found.slice(0, MAX_CANDIDATES);
    $("spool-results-title").textContent = found.length > shown.length
      ? `Showing the first ${shown.length} of ${found.length.toLocaleString()} matches. Narrow the search to see the rest.`
      : `${found.length.toLocaleString()} matches. Choose one.`;

    const list = $("spool-candidates");
    list.replaceChildren();
    for (const record of shown) {
      const item = el("li");
      const button = el("button", "st-candidate");
      button.type = "button";
      button.dataset.key = record["Composite Key"];
      button.setAttribute("aria-pressed", "false");
      button.append(
        el("span", "st-cand-project", `${text(record["Project Name"])} · ${text(record["Project Code"])}`),
        el("span", "st-cand-main", `${text(record["Drawing No"])}  /  ${text(record["Spool No"])}`),
        el("span", "st-cand-stage", text(record["Current Stage"])),
      );
      button.addEventListener("click", () => select(record));
      item.append(button);
      list.append(item);
    }
    $("spool-results").hidden = false;
  }

  function markSelectedCandidate(key) {
    for (const button of document.querySelectorAll(".st-candidate")) {
      button.setAttribute("aria-pressed", String(button.dataset.key === key));
    }
  }

  // ---------------------------------------------------------
  // Selected item: only this one record is read from here on.
  // ---------------------------------------------------------

  function clearSelection() {
    state.selectedKey = null;
    $("trail-tag").textContent = "Awaiting spool selection";
    $("joints-tag").textContent = "No item selected";
    $("st-summary").hidden = true;
    $("st-summary").replaceChildren();
    $("stage-empty").hidden = false;
    $("joints-empty").textContent = "Joint records will appear here after a spool is selected.";
    $("joints-note").hidden = true;
    $("joints-note").textContent = "";
    for (const li of document.querySelectorAll("#st-stages li")) {
      li.className = "";
      li.querySelector(".st-stage-meta").textContent = "";
    }
  }

  function select(record) {
    clearSelection();
    state.selectedKey = record["Composite Key"];
    markSelectedCandidate(state.selectedKey);

    const identity = `${text(record["Drawing No"])} / ${text(record["Spool No"])}`;
    $("trail-tag").textContent = identity;
    $("joints-tag").textContent = "Joint details unavailable";
    $("stage-empty").hidden = true;

    renderSummary(record);
    renderStages(record);
    renderJoints(record, identity);

    const heading = $("trail-title");
    heading.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    heading.focus({ preventScroll: true });
  }

  function renderSummary(record) {
    const summary = $("st-summary");
    const rows = [
      ["Project", `${text(record["Project Name"])} (${text(record["Project Code"])})`],
      ["Drawing", text(record["Drawing No"])],
      ["Spool", text(record["Spool No"])],
      ["Latest stage", text(record["Current Stage"])],
      ["Days in stage", record["Stage Age"] === null || record["Stage Age"] === undefined ? "—" : String(record["Stage Age"])],
      ["Joints on spool", text(record["Total Joints"])],
      ["Material", text(record["Material"])],
      ["Status", text(record["Status Message"])],
    ];
    summary.replaceChildren();
    for (const [label, value] of rows) {
      const group = el("div", "st-summary-item");
      group.append(el("dt", null, label), el("dd", null, value));
      summary.append(group);
    }
    summary.hidden = false;
  }

  function renderStages(record) {
    const current = String(record["Current Stage"] || "");
    for (const stage of STAGES) {
      const li = document.querySelector(`#st-stages li[data-stage="${stage.id}"]`);
      const meta = li.querySelector(".st-stage-meta");
      meta.replaceChildren();

      const published = !!stage.field && stage.field in record;
      const date = published ? formatDate(record[stage.field]) : null;
      const isCurrent = !!stage.at && stage.at.includes(current);

      if (date) li.classList.add("is-done");
      else if (!published) li.classList.add("is-na");
      if (isCurrent) li.classList.add("is-current");

      if (stage.owner) meta.append(el("span", "st-stage-owner", stage.owner));
      if (date) meta.append(el("span", "st-stage-date", date));
      else if (!published) meta.append(el("span", "st-stage-date", "No date published"));
      else if (isCurrent) meta.append(el("span", "st-stage-date", "Current stage"));
      else meta.append(el("span", "st-stage-date", "Not yet"));
    }
  }

  function renderJoints(record, identity) {
    $("joints-empty").textContent = "Joint details unavailable";
    const note = $("joints-note");
    note.textContent =
      `Joint-wise fit-up and welding records for ${identity} are not connected yet. ` +
      "Joint records need a data connection that only signed-in users can read, and the site does not have one. " +
      "Spool search and the stage trail above are not affected.";
    note.hidden = false;
  }

  // ---------------------------------------------------------
  // Data
  // ---------------------------------------------------------

  async function load() {
    setNote("Loading spool records…", "");
    $("spool-search").disabled = true;
    $("spool-go").disabled = true;

    let store = null;
    try {
      store = (await SpoolData.fetchPublished()).store;
    } catch (error) {
      console.error("Could not load published spool data", error);
      try {
        const saved = await SpoolData.restorePersisted();
        store = saved ? saved.store : null;
      } catch (restoreError) {
        console.warn("Could not read saved spool data", restoreError);
      }
    }

    // Controls come back either way. Searching is only meaningful with
    // records, so the failure message says what to do next.
    $("spool-search").disabled = false;
    $("spool-go").disabled = false;

    if (!store || !Array.isArray(store.masterSpools) || !store.masterSpools.length) {
      state.records = [];
      setNote("Spool records could not be loaded. Check your connection and select Find spool to try again.", "error");
      state.needsReload = true;
      return;
    }

    state.needsReload = false;
    state.records = store.masterSpools.map((record) => Object.assign(record, { _hay: haystack(record) }));
    setNote(`${state.records.length.toLocaleString()} spools ready to search.`, "");
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("spool-form").addEventListener("submit", (event) => {
      if (state.needsReload) {
        event.preventDefault();
        load();
        return;
      }
      runSearch(event);
    });
    load();
  });
})();
