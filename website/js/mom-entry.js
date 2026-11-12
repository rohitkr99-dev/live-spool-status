/* SIOP Meeting Tracker: "Add update" screen for use during the meeting.
   Kept deliberately small: pick the project, type a total and how it splits,
   add another line if needed, optionally add a comment. No status, no numbers.
   Saving goes through mom-data.js to the shared database.
   All text is inserted with textContent, never as HTML. */
(function () {
  "use strict";

  // The projects of the SIOP tracker's Lists sheet. A project that is not here
  // yet (or has no notes) is added by adding its name to this list.
  var PROJECT_NAMES = ["NE Vicksburg", "NE Franklin Farms", "VOGT Bison", "NE Gregory", "VOGT Tallgrass 1", "Siemens",
    "NE Viola", "VOGT Tallgrass 2", "General", "VOGT Urquhart", "NE Taweelah"];

  var page = null;
  var selected = "";   // a project name, or ""
  var lines = [];
  var notice = "";
  var busy = false;
  var pending = [];    // projects added on this screen that have no note saved yet
  var adding = null;   // the "Add project" steps, or null

  var $ = function (id) { return document.getElementById(id); };
  var el = function (tag, cls, text) { return page.el(tag, cls, text); };

  function today() {
    var d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  }

  // Every project, with its record if it has notes yet.
  function projectRows() {
    var byName = {};
    page.projects().forEach(function (p) { byName[p.project] = p; });
    var names = PROJECT_NAMES.concat(pending);
    Object.keys(byName).forEach(function (n) { if (names.indexOf(n) === -1) names.push(n); });
    return names.sort().map(function (n) { return { name: n, record: byName[n] || null }; });
  }

  function findRecord(name) {
    return page.projects().filter(function (p) { return p.project === name; })[0] || null;
  }

  // ---- left: the projects --------------------------------------------------

  function renderList() {
    var box = $("entry-cases");
    box.textContent = "";
    var rows = projectRows();
    rows.forEach(function (row) {
      var button = el("button", "mom-project");
      button.type = "button";
      button.setAttribute("aria-pressed", selected === row.name ? "true" : "false");
      button.appendChild(el("span", "", row.name));
      button.appendChild(el("small", "", row.record ? "last " + page.fmtDate(row.record.last_updated) : "no updates yet"));
      button.addEventListener("click", function () { selectProject(row.name); });
      box.appendChild(button);
    });
    $("entry-count").textContent = rows.length;
  }

  function selectProject(name) {
    adding = null;
    selected = name;
    lines = newBlock();
    notice = "";
    render();
  }

  // ---- form pieces ---------------------------------------------------------

  function field(labelText, input, id) {
    var wrap = el("div", "mom-field");
    var label = el("label", "", labelText);
    input.id = id;
    label.htmlFor = id;
    wrap.appendChild(label);
    wrap.appendChild(input);
    return wrap;
  }

  // One "line" = a total and the parts it splits into. Leave a part empty to skip it.
  function newLine(type) { return { type: type, label: "", count: "", when: "" }; }
  function newBlock() { return [newLine("total"), newLine("part"), newLine("part")]; }

  function lineRow(ln, i) {
    var frag = document.createDocumentFragment();
    var row = el("div", "mom-line mom-line--" + ln.type);

    function input(key, placeholder, label, type) {
      var node = el("input");
      node.type = type || "text";
      if (type === "number") { node.min = "0"; node.inputMode = "numeric"; }
      node.value = ln[key];
      node.placeholder = placeholder;
      node.setAttribute("aria-label", label);
      node.addEventListener("input", function () { ln[key] = node.value; updateChecks(); });
      row.appendChild(node);
    }
    var isTotal = ln.type === "total";
    input("label", isTotal ? "Total, e.g. Planned up to Week 32" : "Part, e.g. Carried forward to Week 34", isTotal ? "Total" : "Part", "text");
    input("count", "How many", "How many", "number");
    input("when", "By when / why", "By when or why", "text");

    var actions = el("div", "mom-line__actions");
    if (isTotal) {
      var addPart = el("button", "wq-button", "+ Part");
      addPart.type = "button";
      addPart.addEventListener("click", function () { addPartTo(i); });
      actions.appendChild(addPart);
    }
    var remove = el("button", "wq-button", "×");
    remove.type = "button";
    remove.setAttribute("aria-label", isTotal ? "Remove this line and its parts" : "Remove this part");
    remove.addEventListener("click", function () { removeLine(i); });
    actions.appendChild(remove);
    row.appendChild(actions);
    frag.appendChild(row);

    if (isTotal) {
      var check = el("div", "mom-linecheck");
      check.setAttribute("data-i", String(i));
      frag.appendChild(check);
    }
    return frag;
  }

  function renderLines() {
    var box = $("mom-lines");
    box.textContent = "";
    if (lines.length) {
      var head = el("div", "mom-line mom-line--head");
      ["Total / part", "How many", "By when / why", ""].forEach(function (t) { head.appendChild(el("span", "", t)); });
      box.appendChild(head);
    }
    lines.forEach(function (ln, i) { box.appendChild(lineRow(ln, i)); });
    updateChecks();
  }

  function updateChecks() {
    lines.forEach(function (ln, i) {
      if (ln.type !== "total") return;
      var chip = document.querySelector('.mom-linecheck[data-i="' + i + '"]');
      if (!chip) return;
      var sum = 0, parts = 0;
      for (var j = i + 1; j < lines.length && lines[j].type === "part"; j++) {
        if (lines[j].count !== "") { sum += Number(lines[j].count) || 0; parts++; }
      }
      var total = Number(ln.count);
      var cls = "mom-linecheck", text = "";
      if (ln.count !== "" && parts) {
        if (sum === total) {
          text = "✓ The parts add up to the total (" + total + ").";
          cls += " mom-linecheck--ok";
        } else if (sum < total) {
          text = "The parts add up to " + sum + " of " + total + ": " + (total - sum) + " not accounted for.";
          cls += " mom-linecheck--gap";
        } else {
          text = "The parts add up to " + sum + ", more than the total of " + total + ".";
          cls += " mom-linecheck--over";
        }
      }
      chip.className = cls;
      chip.textContent = text;
    });
  }

  function addPartTo(i) {
    var at = i + 1;
    while (at < lines.length && lines[at].type === "part") at++;
    lines.splice(at, 0, newLine("part"));
    renderLines();
  }

  function removeLine(i) {
    var count = 1;
    if (lines[i].type === "total") while (lines[i + count] && lines[i + count].type === "part") count++;
    lines.splice(i, count);
    renderLines();
  }

  // The colour is picked from the words used, so nobody has to choose one.
  function kindFor(type, text) {
    if (type === "total") return "info";
    var t = text.toLowerCase();
    // "to be cleared", "will close" are still to do, not done.
    var future = /\bto be\b|\bwill\b|\bto (close|clear|offer|complete|finish|pack)\b/.test(t);
    if (/hold|stuck|blocked|waiting/.test(t)) return "hold";
    if (/late|rework|impact|delay|overdue|behind/.test(t)) return "late";
    if (!future && /done|complete|offered|closed|cleared|finished|packed/.test(t)) return "done";
    return "cf";
  }

  function hasContent(ln) { return ln.label.trim() || ln.count !== "" || ln.when.trim(); }

  function toItems() {
    var items = [];
    var grouped = false;   // does the current total have at least one filled part?
    lines.forEach(function (ln, i) {
      if (ln.type === "total") {
        grouped = false;
        for (var j = i + 1; j < lines.length && lines[j].type === "part"; j++) if (hasContent(lines[j])) grouped = true;
      }
      if (!hasContent(ln)) return;
      var label = ln.label.trim();
      var when = ln.when.trim();
      var isGroup = ln.type === "total" && grouped;
      // A total with no parts is just a plain line, coloured by its words.
      var item = { kind: isGroup ? "info" : kindFor("line", label), label: label || "—" };
      if (ln.count !== "") item.count = Number(ln.count);
      // A short text is a date / week chip; anything longer is a reason.
      if (when) item[when.length <= 22 ? "when" : "note"] = when;
      if (isGroup) item.group = true;
      else if (ln.type === "part") item.indent = true;
      items.push(item);
    });
    return items;
  }

  // ---- the form ------------------------------------------------------------

  // Shown instead of the form when notes cannot be saved (yet).
  function renderBlocked(body) {
    var mode = window.MomData.mode();
    if (mode === "empty") {
      body.appendChild(el("p", "mom-hint", "The shared database is connected but empty. Copy the existing tracker history into it once, then everyone can add updates here."));
      var box = el("div", "mom-form__actions");
      var button = el("button", "wq-primary", "Import the existing history");
      button.type = "button";
      button.addEventListener("click", function () {
        button.disabled = true;
        button.textContent = "Importing…";
        window.MomData.importHistory().then(function (r) {
          notice = "Imported " + r.projects + " projects and " + r.notes + " updates.";
        }, function (error) {
          notice = "The import failed: " + (error && error.message ? error.message : error);
          button.disabled = false;
          button.textContent = "Import the existing history";
        }).then(renderForm);
      });
      box.appendChild(button);
      body.appendChild(box);
    } else {
      body.appendChild(el("p", "mom-hint", "Updates can't be saved right now. " + window.MomData.note()));
    }
  }

  function renderForm() {
    var body = $("entry-body");
    body.textContent = "";
    var title = $("entry-title");
    var sub = $("entry-sub");

    if (notice) {
      var banner = el("p", "mom-notice", notice);
      banner.setAttribute("role", "status");
      body.appendChild(banner);
    }
    if (window.MomData.mode() !== "live") {
      title.textContent = "Add an update";
      sub.textContent = "";
      renderBlocked(body);
      return;
    }
    if (!selected) {
      title.textContent = "Add an update";
      sub.textContent = "";
      if (adding) { title.textContent = "Add a project"; renderAddProject(body); }
      else body.appendChild(el("p", "wq-muted", "Pick a project on the left."));
      return;
    }

    var record = findRecord(selected);
    title.textContent = selected;
    sub.textContent = "";

    if (record) {
      var last = el("section", "mom-last");
      last.appendChild(el("h3", "", "Last update · " + page.fmtDate(record.latest.date)));
      last.appendChild(page.remarkBlock(record.latest));
      body.appendChild(last);
    } else {
      body.appendChild(el("p", "mom-hint", "No updates for this project yet. This will be the first."));
    }

    var form = el("form", "mom-form");
    form.noValidate = true;
    // Enter in a box must not save the update half-way through typing.
    form.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && e.target.tagName === "INPUT") e.preventDefault();
    });
    form.addEventListener("submit", function (e) { e.preventDefault(); save(); });

    var top = el("div", "mom-form__row");
    var date = el("input");
    date.type = "date";
    date.value = today();
    top.appendChild(field("Meeting date", date, "mom-date"));
    form.appendChild(top);

    var linesBox = el("div", "mom-field");
    linesBox.appendChild(el("span", "mom-label", "Total and how it splits"));
    var linesList = el("div", "mom-lines");
    linesList.id = "mom-lines";
    linesBox.appendChild(linesList);
    var add = el("button", "wq-button", "+ Add line");
    add.type = "button";
    add.addEventListener("click", function () { lines = lines.concat(newBlock()); renderLines(); });
    var tools = el("div", "mom-tools");
    tools.appendChild(add);
    linesBox.appendChild(tools);
    linesBox.appendChild(el("p", "mom-hint", "Leave a part empty if you don't need it. Colours follow your words (hold, done, late…)."));
    form.appendChild(linesBox);

    var comment = el("textarea");
    comment.rows = 3;
    comment.maxLength = 2000;
    comment.placeholder = "Optional: the full comment, as you would write it in the tracker";
    form.appendChild(field("Comment (optional)", comment, "mom-comment"));

    var error = el("p", "mom-error");
    error.id = "mom-error";
    error.setAttribute("role", "alert");
    error.hidden = true;
    form.appendChild(error);

    var actions = el("div", "mom-form__actions");
    var saveButton = el("button", "wq-primary", "Save update");
    saveButton.type = "submit";
    saveButton.id = "mom-save";
    var cancel = el("button", "wq-secondary", "Cancel");
    cancel.type = "button";
    cancel.addEventListener("click", function () { selected = ""; notice = ""; render(); });
    actions.appendChild(saveButton);
    actions.appendChild(cancel);
    form.appendChild(actions);

    body.appendChild(form);
    renderLines();
  }

  // ---- adding a project ----------------------------------------------------

  // Capitals, spaces and punctuation do not make a different project.
  function norm(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, ""); }

  function distance(a, b) {
    var d = [];
    var i, j;
    for (i = 0; i <= a.length; i++) d[i] = [i];
    for (j = 1; j <= b.length; j++) d[0][j] = j;
    for (i = 1; i <= a.length; i++) {
      for (j = 1; j <= b.length; j++) {
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
    }
    return d[a.length][b.length];
  }

  // The same project (exact) or one it looks like (near: contained in it, or a typo away).
  function similarTo(name) {
    var n = norm(name);
    var exact = null;
    var near = null;
    projectRows().forEach(function (row) {
      var m = norm(row.name);
      if (m === n) exact = row.name;
      else if (!near && n.length >= 3 && (m.indexOf(n) !== -1 || n.indexOf(m) !== -1 || (n.length >= 4 && distance(n, m) <= 2))) near = row.name;
    });
    return { exact: exact, near: near };
  }

  function startAdding() {
    selected = "";
    notice = "";
    adding = { step: "name", name: "", message: "", found: "" };
    render();
  }

  function renderAddProject(body) {
    var form = el("form", "mom-form");
    form.noValidate = true;
    var actions = el("div", "mom-form__actions");
    function button(text, cls, handler, submit) {
      var b = el("button", cls, text);
      b.type = submit ? "submit" : "button";
      if (handler) b.addEventListener("click", handler);
      actions.appendChild(b);
    }
    function go(step) { adding.step = step; renderForm(); }

    if (adding.step === "name") {
      var input = el("input");
      input.type = "text";
      input.maxLength = 80;
      input.value = adding.name;
      input.placeholder = "The exact project name, e.g. NE Franklin Farms 2";
      form.appendChild(field("Project name", input, "mom-newname"));
      setTimeout(function () { input.focus(); }, 0);
      if (adding.message) form.appendChild(el("p", "mom-error", adding.message));
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var name = input.value.replace(/\s+/g, " ").trim();
        adding.name = name;
        adding.message = "";
        if (name.length < 2) { adding.message = "Type the project name."; return renderForm(); }
        var s = similarTo(name);
        adding.found = s.exact || s.near || "";
        go(s.exact ? "exists" : s.near ? "near" : "confirm");
      });
      button("Continue", "wq-primary", null, true);
      button("Cancel", "wq-secondary", function () { adding = null; render(); });
    } else if (adding.step === "exists") {
      form.appendChild(el("p", "mom-lead", "“" + adding.found + "” is already in the list. Capitals and spacing don't make a different project."));
      button("Open " + adding.found, "wq-primary", function () { selectProject(adding.found); });
      button("Back", "wq-secondary", function () { go("name"); });
    } else if (adding.step === "near") {
      form.appendChild(el("p", "mom-lead", "Did you mean “" + adding.found + "”? It looks very like “" + adding.name + "”."));
      button("Yes, use " + adding.found, "wq-primary", function () { selectProject(adding.found); });
      button("No, it's a new project", "wq-secondary", function () { go("confirm"); });
      button("Back", "wq-secondary", function () { go("name"); });
    } else {
      form.appendChild(el("p", "mom-lead", "This creates a new project called “" + adding.name + "”. Projects can't be deleted from the page, so check the spelling. It joins the list for everyone when you save its first update."));
      button("Create project", "wq-primary", function () {
        var name = adding.name;
        pending.push(name);
        selectProject(name);
      });
      button("Back", "wq-secondary", function () { go("name"); });
    }
    form.appendChild(actions);
    body.appendChild(form);
  }

  // ---- saving --------------------------------------------------------------

  function save() {
    if (busy) return;
    var fail = function (message) {
      var box = $("mom-error");
      box.textContent = message;
      box.hidden = false;
    };
    var comment = $("mom-comment").value.trim();
    var items = toItems();
    var date = $("mom-date").value;
    if (!date) return fail("Pick the meeting date.");
    if (!comment && !items.length) return fail("Type a total or a comment first.");

    var project = selected;
    busy = true;
    var saveButton = $("mom-save");
    saveButton.disabled = true;
    saveButton.textContent = "Saving…";
    window.MomData.saveNote({ project: project, date: date, remarks: comment, items: items }).then(function () {
      notice = project + ": update saved for " + page.fmtDate(date) + ".";
      selected = "";
      lines = [];
      busy = false;
      render();
    }, function (error) {
      busy = false;
      saveButton.disabled = false;
      saveButton.textContent = "Save update";
      fail(error && error.code === "permission-denied"
        ? "The database refused this update. The rules may not be published yet."
        : "Could not save: " + (error && error.message ? error.message : error));
    });
  }

  function render() {
    renderList();
    renderForm();
  }

  function open() {
    page = window.MomPage;
    render();
  }

  // Someone saved (maybe this screen): refresh the list, never the form being typed in.
  function onData() {
    if ($("view-entry").hidden) return;
    page = window.MomPage;
    renderList();
    if (!busy && window.MomData.mode() !== "live") renderForm();
  }

  document.addEventListener("DOMContentLoaded", function () {
    $("add-project").addEventListener("click", function () {
      page = window.MomPage;
      if (window.MomData.mode() === "live") startAdding();
    });
  });

  window.MomEntry = { open: open, onData: onData };
})();
