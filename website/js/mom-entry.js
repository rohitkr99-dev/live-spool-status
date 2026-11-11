/* SIOP Meeting Tracker: "Add update" screen for use during the meeting.
   Kept deliberately small: pick a case, set the status, type a total and how
   it splits, add another line if needed, optionally add a comment.
   Saving goes through mom-data.js to the shared database.
   All text is inserted with textContent, never as HTML. */
(function () {
  "use strict";

  var PROJECTS = ["NE Vicksburg", "NE Franklin Farms", "VOGT Bison", "NE Gregory", "VOGT Tallgrass 1", "Siemens",
    "NE Viola", "VOGT Tallgrass 2", "General", "VOGT Urquhart", "NE Taweelah"];
  var DEPTS = ["Production", "Painting", "QC", "PDI", "Projects", "Stores", "Procurement", "Design", "Dispatch"];
  var STATUSES = ["Open", "Hold", "Closed", "Cancelled"];
  var CLOSED = { closed: true, cancelled: true };

  var page = null;
  var selected = null;   // a case id, "NEW", or null
  var status = "Open";
  var lines = [];
  var notice = "";
  var busy = false;

  var $ = function (id) { return document.getElementById(id); };
  var el = function (tag, cls, text) { return page.el(tag, cls, text); };

  function today() {
    var d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  }

  function openCases() {
    return page.cases().filter(page.isOpen).sort(function (a, b) {
      return a.project.localeCompare(b.project) || a.case_id.localeCompare(b.case_id);
    });
  }

  function findCase(id) {
    return page.cases().filter(function (c) { return c.case_id === id; })[0];
  }

  // ---- left: open cases ----------------------------------------------------

  function renderList() {
    var box = $("entry-cases");
    box.textContent = "";
    var open = openCases();
    open.forEach(function (c) {
      var button = el("button", "mom-project");
      button.type = "button";
      button.setAttribute("aria-pressed", selected === c.case_id ? "true" : "false");
      var left = el("span");
      left.appendChild(el("strong", "", c.case_id));
      left.appendChild(document.createTextNode(" · " + c.project));
      button.appendChild(left);
      button.appendChild(page.chip(c.status));
      button.addEventListener("click", function () { selectCase(c.case_id); });
      box.appendChild(button);
    });
    $("entry-count").textContent = open.length;
  }

  function selectCase(id) {
    selected = id;
    var found = id === "NEW" ? null : findCase(id);
    status = found ? found.status : "Open";
    lines = newBlock();
    notice = "";
    render();
  }

  // ---- form pieces ---------------------------------------------------------

  function selectEl(options, value) {
    var s = el("select");
    options.forEach(function (o) {
      var option = el("option", "", Array.isArray(o) ? o[1] : o);
      option.value = Array.isArray(o) ? o[0] : o;
      s.appendChild(option);
    });
    if (value) s.value = value;
    return s;
  }

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
          notice = "Imported " + r.cases + " cases and " + r.updates + " updates.";
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
      body.appendChild(el("p", "wq-muted", "Pick an open case on the left, or start a new case."));
      return;
    }

    var found = selected === "NEW" ? null : findCase(selected);
    title.textContent = found ? found.case_id + " · " + found.project : "New case";
    sub.textContent = found ? found.dept : "";

    if (found) {
      var last = el("section", "mom-last");
      last.appendChild(el("h3", "", "Last update · " + page.fmtDate(found.latest.date)));
      last.appendChild(page.remarkBlock(found.latest));
      body.appendChild(last);
    }

    var form = el("form", "mom-form");
    form.noValidate = true;
    // Enter in a box must not save the update half-way through typing.
    form.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && e.target.tagName === "INPUT") e.preventDefault();
    });
    form.addEventListener("submit", function (e) { e.preventDefault(); save(); });

    var top = el("div", "mom-form__row");
    if (!found) {
      top.appendChild(field("Project", selectEl([["", "Choose…"]].concat(PROJECTS.map(function (p) { return [p, p]; }))), "mom-project"));
      top.appendChild(field("Department", selectEl([["", "Choose…"]].concat(DEPTS.map(function (d) { return [d, d]; }))), "mom-dept"));
    }
    var date = el("input");
    date.type = "date";
    date.value = today();
    top.appendChild(field("Meeting date", date, "mom-date"));
    form.appendChild(top);

    var statusBox = el("div", "mom-field");
    statusBox.appendChild(el("span", "mom-label", "Status after this meeting"));
    var seg = el("div", "mom-seg");
    seg.setAttribute("role", "radiogroup");
    seg.setAttribute("aria-label", "Status after this meeting");
    STATUSES.forEach(function (s) {
      var radio = el("input");
      radio.type = "radio";
      radio.name = "mom-status";
      radio.id = "mom-status-" + s;
      radio.value = s;
      radio.checked = s === status;
      radio.addEventListener("change", function () { status = s; });
      var label = el("label", "mom-seg__opt mom-seg__opt--" + s.toLowerCase(), s);
      label.htmlFor = radio.id;
      seg.appendChild(radio);
      seg.appendChild(label);
    });
    statusBox.appendChild(seg);
    form.appendChild(statusBox);

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
    cancel.addEventListener("click", function () { selected = null; notice = ""; render(); });
    actions.appendChild(saveButton);
    actions.appendChild(cancel);
    form.appendChild(actions);

    body.appendChild(form);
    renderLines();
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
    if (selected === "NEW" && (!$("mom-project").value || !$("mom-dept").value)) return fail("Choose the project and department for the new case.");
    if (!comment && !items.length) return fail("Type a total or a comment first.");

    var entry = { date: date, status: status, remarks: comment, items: items };
    if (selected === "NEW") {
      entry.project = $("mom-project").value;
      entry.dept = $("mom-dept").value;
    } else {
      entry.case_id = selected;
    }

    busy = true;
    var saveButton = $("mom-save");
    saveButton.disabled = true;
    saveButton.textContent = "Saving…";
    window.MomData.saveUpdate(entry).then(function (caseId) {
      notice = caseId + " saved. It is now " + status + (CLOSED[status.toLowerCase()] ? " and has left the Current actions list." : ".");
      selected = null;
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
    $("new-case").addEventListener("click", function () {
      page = window.MomPage;
      if (window.MomData.mode() === "live") selectCase("NEW");
    });
  });

  window.MomEntry = { open: open, onData: onData };
})();
