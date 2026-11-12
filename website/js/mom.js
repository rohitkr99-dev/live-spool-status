/* SIOP Meeting Tracker: the latest update on every project, and each project's
   history. The notes come from mom-data.js (live database, or the published
   tracker as a read-only fallback). All text from the notes is inserted with
   textContent, never as HTML. */
(function () {
  "use strict";

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

  // Structured table (or the plain comment) on top, the full comment one click
  // below it. A note with neither just shows its full comment.
  function remarkBlock(note) {
    var items = note.items;
    var full = note.remarks;
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

  function projects() {
    return MomData.projects().slice().sort(function (a, b) {
      return b.last_updated.localeCompare(a.last_updated) || a.project.localeCompare(b.project);
    });
  }

  function lastMeeting() {
    return MomData.projects().reduce(function (m, p) { return p.last_updated > m ? p.last_updated : m; }, "");
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
    var all = MomData.projects();
    var last = lastMeeting();
    var discussed = all.filter(function (p) { return p.last_updated === last; }).length;
    $("kpi-open").textContent = all.length;
    $("kpi-hold").textContent = discussed;
    $("kpi-new").textContent = all.length - discussed;
    $("kpi-closed").textContent = all.reduce(function (n, p) { return n + p.update_count; }, 0);
    $("data-updated").textContent = last ? "Last meeting " + fmtDate(last) : "—";
  }

  function renderCurrent() {
    var query = $("search").value.trim().toLowerCase();
    var body = $("current-body");
    body.textContent = "";
    var last = lastMeeting();
    var all = projects();
    var shown = all.filter(function (p) {
      var labels = (p.latest.items || []).map(function (i) { return i.label; }).join(" ");
      return !query || [p.project, p.latest.remarks, labels].join(" ").toLowerCase().indexOf(query) !== -1;
    });
    shown.forEach(function (p) {
      var tr = el("tr");
      tr.appendChild(el("td", "mom-project-cell", p.project));
      var remarks = el("td", "mom-remarks");
      remarks.appendChild(remarkBlock(p.latest));
      if (p.latest.dept) remarks.appendChild(el("span", "mom-chip mom-chip--tag", p.latest.dept));
      tr.appendChild(remarks);
      var when = el("td");
      when.appendChild(document.createTextNode(fmtDate(p.last_updated)));
      if (p.last_updated < last) when.appendChild(el("span", "mom-chip mom-chip--hold", "Not discussed at the last meeting"));
      tr.appendChild(when);
      tr.appendChild(el("td", "wq-age", String(p.update_count)));
      var action = el("td");
      var button = el("button", "wq-button", "History");
      button.type = "button";
      button.addEventListener("click", function () { selectProject(p.project); setView("history"); });
      action.appendChild(button);
      tr.appendChild(action);
      body.appendChild(tr);
    });
    $("current-count").textContent = shown.length + " of " + all.length;
    $("current-empty").hidden = shown.length > 0;
  }

  function renderProjects() {
    var list = $("project-list");
    list.textContent = "";
    var all = MomData.projects().slice().sort(function (a, b) { return a.project.localeCompare(b.project); });
    all.forEach(function (p) {
      var button = el("button", "mom-project");
      button.type = "button";
      button.setAttribute("aria-pressed", p.project === selectedProject ? "true" : "false");
      button.appendChild(el("span", "", p.project));
      button.appendChild(el("small", "", p.update_count + (p.update_count === 1 ? " update" : " updates")));
      button.addEventListener("click", function () { selectProject(p.project); });
      list.appendChild(button);
    });
    $("projects-count").textContent = all.length;
  }

  function renderHistory() {
    var list = $("case-list");
    list.textContent = "";
    var project = MomData.projects().filter(function (p) { return p.project === selectedProject; })[0];
    if (!project) {
      $("history-title").textContent = "Select a project";
      $("history-count").textContent = "—";
      list.appendChild(el("p", "wq-muted", "Pick a project to see what was said about it at every meeting, newest first."));
      return;
    }
    $("history-title").textContent = project.project;
    $("history-count").textContent = project.update_count + (project.update_count === 1 ? " update" : " updates") + " since " + fmtDate(project.first_date);
    var timeline = el("ol", "mom-timeline");
    timeline.appendChild(el("li", "", "Loading…"));
    list.appendChild(timeline);

    var token = ++loadToken;
    MomData.loadNotes(project.project).then(function (notes) {
      if (token !== loadToken) return;
      timeline.textContent = "";
      notes.slice().reverse().forEach(function (n) {
        var li = el("li");
        li.appendChild(el("time", "", fmtDate(n.date)));
        if (n.dept) li.appendChild(el("span", "mom-chip mom-chip--tag", n.dept));
        li.appendChild(remarkBlock(n));
        timeline.appendChild(li);
      });
    }, function () {
      if (token !== loadToken) return;
      timeline.textContent = "The history could not be loaded.";
    });
  }

  function selectProject(name) {
    selectedProject = name;
    renderProjects();
    renderHistory();
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
    if (view === "history" && !selectedProject && MomData.projects().length) selectProject(projects()[0].project);
  }

  // Called on the first load and every time the shared notes change.
  function refresh() {
    renderStatusLine();
    renderKpis();
    renderCurrent();
    renderProjects();
    if (selectedProject && !$("view-history").hidden) renderHistory();
    if (window.MomEntry) window.MomEntry.onData();
  }

  function init() {
    $("footer-year").textContent = new Date().getFullYear();
    document.querySelectorAll(".wq-views button").forEach(function (b) {
      b.addEventListener("click", function () { setView(b.getAttribute("data-view")); });
    });
    $("search").addEventListener("input", renderCurrent);
    $("export-excel").addEventListener("click", exportToExcel);
    MomData.onChange(refresh);
    MomData.connect();
  }

  // ---- export to Excel ------------------------------------------------------

  var XLSX_URL = "vendor/xlsx.core.min.js";

  // The Excel library is only fetched when someone asks for an export.
  function loadExcelLibrary() {
    if (window.XLSX) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var script = document.createElement("script");
      script.src = XLSX_URL;
      script.onload = resolve;
      script.onerror = function () { reject(new Error("The Excel library could not be loaded.")); };
      document.head.appendChild(script);
    });
  }

  // A date as an Excel serial number (so it sorts and filters as a date).
  function dateSerial(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
    return m ? Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(1899, 11, 30)) / 86400000) : "";
  }

  function itemLine(i) {
    return (i.indent ? "- " : "") + i.label + (i.count != null ? ": " + i.count + " " + (i.unit || "spools") : "")
      + (i.when ? " (" + i.when + ")" : "") + (i.note ? " [" + i.note + "]" : "");
  }

  function sheetOf(rows, widths, dateColumns) {
    var ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = widths.map(function (w) { return { wch: w }; });
    for (var r = 1; r < rows.length; r++) {
      dateColumns.forEach(function (c) {
        var cell = ws[XLSX.utils.encode_cell({ r: r, c: c })];
        if (cell && cell.t === "n") cell.z = "dd-mmm-yyyy";
      });
    }
    return ws;
  }

  // Three sheets: the latest update per project, every note, and every table line.
  function buildWorkbook(notes) {
    var last = lastMeeting();
    var latest = [["Project", "Last discussed", "Discussed at last meeting", "Updates", "Latest comment", "Latest table"]];
    projects().forEach(function (p) {
      latest.push([p.project, dateSerial(p.last_updated), p.last_updated === last ? "Yes" : "No", p.update_count,
        p.latest.remarks || "", (p.latest.items || []).map(itemLine).join(" | ")]);
    });

    var ordered = notes.slice().sort(function (a, b) {
      return a.project.localeCompare(b.project) || b.date.localeCompare(a.date) || (b.ts || 0) - (a.ts || 0);
    });
    var all = [["Project", "Meeting date", "Department", "Comment", "Table", "Entered by"]];
    var lines = [["Project", "Meeting date", "Level", "What", "How many", "Unit", "By when", "Note"]];
    ordered.forEach(function (n) {
      all.push([n.project, dateSerial(n.date), n.dept || "", n.remarks || "", (n.items || []).map(itemLine).join(" | "), n.by || ""]);
      (n.items || []).forEach(function (i) {
        lines.push([n.project, dateSerial(n.date), i.group ? "Total" : i.indent ? "Part" : "Line", i.label,
          i.count != null ? i.count : "", i.count != null ? (i.unit || "spools") : "", i.when || "", i.note || ""]);
      });
    });

    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheetOf(latest, [22, 15, 14, 9, 70, 70], [1]), "Latest updates");
    XLSX.utils.book_append_sheet(wb, sheetOf(all, [22, 15, 14, 70, 70, 28], [1]), "All updates");
    XLSX.utils.book_append_sheet(wb, sheetOf(lines, [22, 15, 8, 40, 10, 10, 20, 40], [1]), "Table lines");
    return wb;
  }

  function exportWorkbook() {
    return Promise.all([loadExcelLibrary(), MomData.loadAllNotes()]).then(function (r) { return buildWorkbook(r[1]); });
  }

  function exportToExcel() {
    var button = $("export-excel");
    var label = button.textContent;
    button.disabled = true;
    button.textContent = "Preparing…";
    exportWorkbook().then(function (wb) {
      var d = new Date();
      d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
      XLSX.writeFile(wb, "SIOP-meeting-tracker-" + d.toISOString().slice(0, 10) + ".xlsx");
      button.textContent = label;
    }, function (error) {
      button.textContent = "Export failed, try again";
      setTimeout(function () { button.textContent = label; }, 4000);
      if (window.console) console.error(error);
    }).then(function () { button.disabled = false; });
  }

  // What the Add update screen (mom-entry.js) needs from this page.
  window.MomPage = { exportWorkbook: exportWorkbook, projects: function () { return MomData.projects(); }, remarkBlock: remarkBlock, el: el, fmtDate: fmtDate };

  init();
})();
