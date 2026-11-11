/* SIOP Meeting Tracker: current actions + history by project.
   Reads the published bundle written by mom_main.py. All text from the
   workbook is inserted with textContent, never as HTML. */
(function () {
  "use strict";

  var DATA_URL = "data/c7d41e98ab.json";
  var CLOSED = { closed: true, cancelled: true };

  var bundle = null;
  var selectedProject = "";
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

  function chip(status) {
    var key = String(status || "Open").toLowerCase();
    return el("span", "mom-chip" + (key === "hold" || key === "closed" || key === "cancelled" ? " mom-chip--" + key : ""), status || "Open");
  }

  function setStatus(text, state) {
    var box = $("data-status");
    box.textContent = text;
    if (state) box.setAttribute("data-state", state); else box.removeAttribute("data-state");
  }

  function allCases() {
    var list = [];
    bundle.history.projects.forEach(function (p) {
      p.cases.forEach(function (c) { list.push({ project: p.project, c: c }); });
    });
    return list;
  }

  function renderKpis() {
    var current = bundle.current_cases;
    var last = bundle.history.meetings[bundle.history.meetings.length - 1];
    var raised = 0, closed = 0;
    allCases().forEach(function (x) {
      if (x.c.first_raised === last) raised++;
      if (x.c.last_updated === last && CLOSED[String(x.c.status).toLowerCase()]) closed++;
    });
    $("kpi-open").textContent = current.length;
    $("kpi-hold").textContent = current.filter(function (c) { return String(c.status).toLowerCase() === "hold"; }).length;
    $("kpi-new").textContent = raised;
    $("kpi-closed").textContent = closed;
    $("data-updated").textContent = "Last meeting " + fmtDate(last);
  }

  function fillDeptFilter() {
    var select = $("dept-filter");
    var depts = {};
    bundle.current_cases.forEach(function (c) { if (c.dept) depts[c.dept] = true; });
    Object.keys(depts).sort().forEach(function (d) {
      var option = el("option", "", d);
      option.value = d;
      select.appendChild(option);
    });
  }

  function renderCurrent() {
    var query = $("search").value.trim().toLowerCase();
    var dept = $("dept-filter").value;
    var body = $("current-body");
    body.textContent = "";
    var shown = bundle.current_cases.filter(function (c) {
      if (dept && c.dept !== dept) return false;
      return !query || [c.case_id, c.project, c.dept, c.remarks].join(" ").toLowerCase().indexOf(query) !== -1;
    });
    shown.forEach(function (c) {
      var tr = el("tr");
      tr.appendChild(el("td", "mom-case", c.case_id));
      tr.appendChild(el("td", "", c.project));
      tr.appendChild(el("td", "", c.dept));
      var status = el("td"); status.appendChild(chip(c.status)); tr.appendChild(status);
      tr.appendChild(el("td", "mom-remarks", c.remarks));
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
    $("current-count").textContent = shown.length + " of " + bundle.current_cases.length;
    $("current-empty").hidden = shown.length > 0;
  }

  function renderProjects() {
    var list = $("project-list");
    list.textContent = "";
    bundle.history.projects.forEach(function (p) {
      var button = el("button", "mom-project");
      button.type = "button";
      button.setAttribute("aria-pressed", p.project === selectedProject ? "true" : "false");
      button.appendChild(el("span", "", p.project));
      button.appendChild(el("small", "", p.open + " open · " + p.closed + " closed"));
      button.addEventListener("click", function () { selectProject(p.project); });
      list.appendChild(button);
    });
    $("projects-count").textContent = bundle.history.projects.length;
  }

  function renderCases(openCaseId) {
    var list = $("case-list");
    list.textContent = "";
    var project = bundle.history.projects.filter(function (p) { return p.project === selectedProject; })[0];
    if (!project) return;
    $("history-title").textContent = project.project;
    $("history-count").textContent = project.cases.length + (project.cases.length === 1 ? " case" : " cases");
    project.cases.forEach(function (c) {
      var item = el("details", "mom-case-item");
      if (c.case_id && c.case_id === openCaseId) item.open = true;
      var summary = el("summary");
      summary.appendChild(el("span", "mom-case", c.case_id || "No case ID"));
      summary.appendChild(chip(c.status));
      if (c.dept) summary.appendChild(el("span", "mom-case-meta", c.dept));
      summary.appendChild(el("span", "mom-case-meta", "Raised " + fmtDate(c.first_raised) + " · last update " + fmtDate(c.last_updated) + " · " + c.updates.length + (c.updates.length === 1 ? " update" : " updates")));
      summary.appendChild(el("span", "mom-case-latest", c.updates[c.updates.length - 1].remarks));
      item.appendChild(summary);
      var timeline = el("ol", "mom-timeline");
      c.updates.slice().reverse().forEach(function (u) {
        var li = el("li");
        var time = el("time", "", fmtDate(u.date));
        li.appendChild(time);
        li.appendChild(chip(u.status));
        li.appendChild(el("p", "", u.remarks));
        timeline.appendChild(li);
      });
      item.appendChild(timeline);
      list.appendChild(item);
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
    if (view === "history" && !selectedProject && bundle.history.projects.length) {
      selectProject(bundle.history.projects[0].project);
    }
  }

  function init() {
    $("footer-year").textContent = new Date().getFullYear();
    document.querySelectorAll(".wq-views button").forEach(function (b) {
      b.addEventListener("click", function () { setView(b.getAttribute("data-view")); });
    });
    $("search").addEventListener("input", renderCurrent);
    $("dept-filter").addEventListener("change", renderCurrent);

    fetch(DATA_URL, { cache: "no-cache" })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (data) {
        bundle = data;
        renderKpis();
        fillDeptFilter();
        renderCurrent();
        renderProjects();
        setStatus("Source: " + bundle.source_file + " · published " + bundle.generated_at.slice(0, 10), "ok");
      })
      .catch(function () {
        setStatus("The SIOP meeting notes are not published yet.", "error");
      });
  }

  init();
})();
