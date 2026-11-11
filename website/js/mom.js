/* SIOP Meeting Tracker: current actions + history by project.
   The notes come from mom-data.js (live database, or the published tracker as a
   read-only fallback). All text from the notes is inserted with textContent,
   never as HTML. */
(function () {
  "use strict";

  var CLOSED = { closed: true, cancelled: true };

  var selectedProject = "";
  var loadToken = 0;
  var $ = function (id) { return document.getElementById(id); };

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function fmtDate(iso) {
    if (!iso) return "—";
    var d = new Date(iso + "T00:00:00");
    return isNaN(d) ? iso : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  }

  function daysSince(iso) {
    if (!iso) return null;
    var d = new Date(iso + "T00:00:00");
    if (isNaN(d)) return null;
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.max(0, Math.round((today - d) / 86400000));
  }

  function isOpen(c) { return !CLOSED[String(c.status).toLowerCase()]; }

  function chip(status) {
    var key = String(status || "Open").toLowerCase();
    return el("span", "mom-chip" + (key === "hold" || key === "closed" || key === "cancelled" ? " mom-chip--" + key : ""), status || "Open");
  }

  function setStatus(text, state) {
    var box = $("data-status");
    box.textContent = text;
    if (state) box.setAttribute("data-state", state); else box.removeAttribute("data-state");
  }

  // ---- structured summary: what / how many / by when or why ----------------

  // The indented rows right under a group row (a total) are its parts.
  function partsOf(items, index) {
    var parts = [];
    for (var j = index + 1; j < items.length && items[j].indent; j++) parts.push(items[j]);
    return parts;
  }

  // One bar for a total, split into its parts; what is left of the track is
  // the part of the total nobody accounted for.
  function stackedBar(parts, total, sum) {
    var bar = el("span", "mom-bar mom-bar--stack");
    var scale = Math.max(total, sum, 1);
    parts.forEach(function (p) {
      var segment = el("span", "mom-bar__fill mom-bar__fill--" + (p.kind || "info"));
      segment.style.width = (p.count / scale * 100) + "%";
      bar.appendChild(segment);
    });
    return bar;
  }

  // Bars compare spool counts within the same update only.
  function itemsTable(items) {
    var max = items.reduce(function (m, i) {
      return !i.indent && (i.unit || "spools") === "spools" && i.count > m ? i.count : m;
    }, 1);
    var groupTotal = 1;
    var table = el("table", "mom-items");
    var headRow = el("tr");
    ["What", "How many", "By when / why"].forEach(function (t) { headRow.appendChild(el("th", "", t)); });
    table.appendChild(el("thead")).appendChild(headRow);
    var body = el("tbody");
    items.forEach(function (i, index) {
      var kind = i.kind || "info";
      var unit = i.unit || "spools";
      var tr = el("tr", i.group ? "mom-group" : i.indent ? "mom-child" : "");
      var parts = i.group ? partsOf(items, index) : [];
      var partsSum = parts.reduce(function (s, p) { return s + (p.count || 0); }, 0);
      if (i.group) groupTotal = i.count || 1;
      var what = el("td", "mom-items__what");
      what.appendChild(el("span", "mom-dot mom-dot--" + kind));
      what.appendChild(document.createTextNode(i.label));
      tr.appendChild(what);
      var count = el("td", "mom-items__count");
      if (i.count != null) {
        var figure = el("span", "mom-items__figure");
        figure.appendChild(el("strong", "", String(i.count)));
        figure.appendChild(el("small", "", unit));
        count.appendChild(figure);
        if (i.group && parts.length) {
          count.appendChild(stackedBar(parts, i.count, partsSum));
        } else if (unit === "spools" || i.indent) {
          var bar = el("span", "mom-bar");
          var fill = el("span", "mom-bar__fill mom-bar__fill--" + kind);
          fill.style.width = Math.max(4, Math.round(i.count / (i.indent ? groupTotal : max) * 100)) + "%";
          bar.appendChild(fill);
          count.appendChild(bar);
        }
      } else {
        count.appendChild(el("span", "mom-items__none", "—"));
      }
      tr.appendChild(count);
      var when = el("td", "mom-items__when");
      if (i.when) when.appendChild(el("span", "mom-when", i.when));
      if (i.note) when.appendChild(el("span", "mom-items__note", i.note));
      if (parts.length && partsSum !== i.count) {
        var gap = i.count - partsSum;
        when.appendChild(el("span", "mom-when mom-when--" + (gap > 0 ? "gap" : "over"),
          gap > 0 ? gap + " not accounted for" : "parts exceed total by " + (-gap)));
      }
      tr.appendChild(when);
      body.appendChild(tr);
    });
    table.appendChild(body);
    return table;
  }

  // One-line version of the same facts for a collapsed case.
  function headline(update) {
    var box = el("span", "mom-case-latest");
    var counted = (update.items || []).filter(function (i) { return i.count != null; }).slice(0, 4);
    if (!counted.length) {
      box.textContent = update.remarks;
      return box;
    }
    counted.forEach(function (i) {
      box.appendChild(el("span", "mom-pill mom-pill--" + (i.kind || "info"), i.count + " " + (i.unit || "spools") + " · " + i.label));
    });
    return box;
  }

  // Structured table (or the plain comment) on top, the full comment one click
  // below it. An update with neither just shows its full comment.
  function remarkBlock(update) {
    var items = update.items;
    var full = update.remarks;
    var box = el("div", "mom-remark-block");
    if (items && items.length) {
      box.appendChild(itemsTable(items));
    } else {
      box.appendChild(el("p", "mom-full", full));
      return box;
    }
    if (!full) return box;
    var details = el("details", "mom-fullcomment");
    details.appendChild(el("summary", "", "Full comment"));
    details.appendChild(el("p", "mom-full", full));
    box.appendChild(details);
    return box;
  }

  // ---- data ----------------------------------------------------------------

  function cases() { return MomData.cases(); }

  function projectsList() {
    var byName = {};
    cases().forEach(function (c) { (byName[c.project] = byName[c.project] || []).push(c); });
    return Object.keys(byName).sort().map(function (name) {
      var list = byName[name].slice().sort(function (a, b) {
        return b.last_updated.localeCompare(a.last_updated) || b.case_id.localeCompare(a.case_id);
      });
      var open = list.filter(isOpen).length;
      return { project: name, open: open, closed: list.length - open, cases: list };
    });
  }

  function renderStatusLine() {
    var mode = MomData.mode();
    var user = MomData.user();
    if (mode === "live") setStatus("Live notes, shared with everyone signed in" + (user && user.email ? " · you are " + user.email : ""), "ok");
    else if (mode === "empty") setStatus("The shared database is connected but has no notes yet. Showing the last published tracker (read-only). Import it on the Add update tab.", "");
    else if (mode === "published") setStatus("Showing the last published tracker (read-only). " + MomData.note(), "error");
    else setStatus("Loading the latest SIOP meeting notes…", "");
  }

  function renderKpis() {
    var all = cases();
    var open = all.filter(isOpen);
    var last = all.reduce(function (m, c) { return c.last_updated > m ? c.last_updated : m; }, "");
    var raised = all.filter(function (c) { return c.first_raised === last; }).length;
    var closed = all.filter(function (c) { return c.last_updated === last && !isOpen(c); }).length;
    $("kpi-open").textContent = open.length;
    $("kpi-hold").textContent = open.filter(function (c) { return String(c.status).toLowerCase() === "hold"; }).length;
    $("kpi-new").textContent = raised;
    $("kpi-closed").textContent = closed;
    $("data-updated").textContent = last ? "Last meeting " + fmtDate(last) : "—";
  }

  function fillDeptFilter() {
    var select = $("dept-filter");
    var keep = select.value;
    var depts = {};
    cases().filter(isOpen).forEach(function (c) { if (c.dept) depts[c.dept] = true; });
    select.textContent = "";
    var all = el("option", "", "All departments");
    all.value = "";
    select.appendChild(all);
    Object.keys(depts).sort().forEach(function (d) {
      var option = el("option", "", d);
      option.value = d;
      select.appendChild(option);
    });
    select.value = depts[keep] ? keep : "";
  }

  function renderCurrent() {
    var query = $("search").value.trim().toLowerCase();
    var dept = $("dept-filter").value;
    var body = $("current-body");
    body.textContent = "";
    var open = cases().filter(isOpen).sort(function (a, b) { return a.case_id.localeCompare(b.case_id); });
    var shown = open.filter(function (c) {
      if (dept && c.dept !== dept) return false;
      var labels = (c.latest.items || []).map(function (i) { return i.label; }).join(" ");
      return !query || [c.case_id, c.project, c.dept, c.latest.remarks, labels].join(" ").toLowerCase().indexOf(query) !== -1;
    });
    shown.forEach(function (c) {
      var tr = el("tr");
      tr.appendChild(el("td", "mom-case", c.case_id));
      tr.appendChild(el("td", "", c.project));
      tr.appendChild(el("td", "", c.dept));
      var status = el("td"); status.appendChild(chip(c.status)); tr.appendChild(status);
      var remarks = el("td", "mom-remarks");
      remarks.appendChild(remarkBlock(c.latest));
      tr.appendChild(remarks);
      tr.appendChild(el("td", "", fmtDate(c.last_updated)));
      var age = daysSince(c.first_raised);
      tr.appendChild(el("td", "wq-age", age == null ? "—" : age + " d"));
      var action = el("td");
      var button = el("button", "wq-button", "History");
      button.type = "button";
      button.addEventListener("click", function () { selectProject(c.project, c.case_id); setView("history"); });
      action.appendChild(button);
      tr.appendChild(action);
      body.appendChild(tr);
    });
    $("current-count").textContent = shown.length + " of " + open.length;
    $("current-empty").hidden = shown.length > 0;
  }

  function renderProjects() {
    var list = $("project-list");
    list.textContent = "";
    var projects = projectsList();
    projects.forEach(function (p) {
      var button = el("button", "mom-project");
      button.type = "button";
      button.setAttribute("aria-pressed", p.project === selectedProject ? "true" : "false");
      button.appendChild(el("span", "", p.project));
      button.appendChild(el("small", "", p.open + " open · " + p.closed + " closed"));
      button.addEventListener("click", function () { selectProject(p.project); });
      list.appendChild(button);
    });
    $("projects-count").textContent = projects.length;
  }

  function fillTimeline(timeline, updates) {
    timeline.textContent = "";
    updates.slice().reverse().forEach(function (u) {
      var li = el("li");
      li.appendChild(el("time", "", fmtDate(u.date)));
      li.appendChild(chip(u.status));
      li.appendChild(remarkBlock(u));
      timeline.appendChild(li);
    });
  }

  function renderCases(openCaseId) {
    var list = $("case-list");
    var wasOpen = {};
    list.querySelectorAll(".mom-case-item[open]").forEach(function (d) { wasOpen[d.getAttribute("data-id")] = true; });
    list.textContent = "";
    var project = projectsList().filter(function (p) { return p.project === selectedProject; })[0];
    if (!project) {
      $("history-title").textContent = "Select a project";
      $("history-count").textContent = "—";
      list.appendChild(el("p", "wq-muted", "Pick a project to see every case raised for it, newest first."));
      return;
    }
    $("history-title").textContent = project.project;
    $("history-count").textContent = project.cases.length + (project.cases.length === 1 ? " case" : " cases");

    var timelines = {};
    project.cases.forEach(function (c) {
      var item = el("details", "mom-case-item");
      item.setAttribute("data-id", c.case_id);
      if ((c.case_id && c.case_id === openCaseId) || wasOpen[c.case_id]) item.open = true;
      var summary = el("summary");
      summary.appendChild(el("span", "mom-case", c.case_id || "No case ID"));
      summary.appendChild(chip(c.status));
      if (c.dept) summary.appendChild(el("span", "mom-case-meta", c.dept));
      summary.appendChild(el("span", "mom-case-meta", "Raised " + fmtDate(c.first_raised) + " · last update " + fmtDate(c.last_updated) + " · " + c.update_count + (c.update_count === 1 ? " update" : " updates")));
      summary.appendChild(headline(c.latest));
      item.appendChild(summary);
      var timeline = el("ol", "mom-timeline");
      timeline.appendChild(el("li", "", "Loading…"));
      timelines[c.case_id] = timeline;
      item.appendChild(timeline);
      list.appendChild(item);
    });

    var token = ++loadToken;
    MomData.loadUpdates(project.project).then(function (byCase) {
      if (token !== loadToken) return;
      project.cases.forEach(function (c) { fillTimeline(timelines[c.case_id], byCase[c.case_id] || [c.latest]); });
    }, function () {
      if (token !== loadToken) return;
      project.cases.forEach(function (c) { timelines[c.case_id].textContent = "The history could not be loaded."; });
    });
  }

  function selectProject(name, openCaseId) {
    selectedProject = name;
    renderProjects();
    renderCases(openCaseId);
  }

  function setView(view) {
    document.querySelectorAll(".wq-views button").forEach(function (b) {
      b.setAttribute("aria-pressed", b.getAttribute("data-view") === view ? "true" : "false");
    });
    $("view-current").hidden = view !== "current";
    $("view-history").hidden = view !== "history";
    $("current-filters").hidden = view !== "current";
    $("view-entry").hidden = view !== "entry";
    if (view === "entry" && window.MomEntry) window.MomEntry.open();
    if (view === "history" && !selectedProject && projectsList().length) selectProject(projectsList()[0].project);
  }

  // Called on the first load and every time the shared notes change.
  function refresh() {
    renderStatusLine();
    renderKpis();
    fillDeptFilter();
    renderCurrent();
    renderProjects();
    if (selectedProject && !$("view-history").hidden) renderCases();
    if (window.MomEntry) window.MomEntry.onData();
  }

  function init() {
    $("footer-year").textContent = new Date().getFullYear();
    document.querySelectorAll(".wq-views button").forEach(function (b) {
      b.addEventListener("click", function () { setView(b.getAttribute("data-view")); });
    });
    $("search").addEventListener("input", renderCurrent);
    $("dept-filter").addEventListener("change", renderCurrent);
    MomData.onChange(refresh);
    MomData.connect();
  }

  // What the Add update screen (mom-entry.js) needs from this page.
  window.MomPage = { cases: cases, isOpen: isOpen, remarkBlock: remarkBlock, el: el, fmtDate: fmtDate, chip: chip };

  init();
})();
