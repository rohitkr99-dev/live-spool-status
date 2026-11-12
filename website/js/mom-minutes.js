/* SIOP Meeting Tracker: lays out the Excel export.

   Sheet 1 is the minutes of ONE meeting (the project-by-project record that can be
   shared with management); sheets 2 and 3 are the full record (every note, and every
   table line). Pure functions: notes in, sheet descriptions out (see mom-xlsx.js).

   notes: [{ project, date 'YYYY-MM-DD', remarks, items, dept, by, ts }] */
(function (root) {
  "use strict";

  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  // A date as an Excel serial number (so it sorts and filters as a date).
  function dateSerial(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
    return m ? Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(1899, 11, 30)) / 86400000) : "";
  }

  function longDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
    var names = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    return m ? +m[3] + " " + names[+m[2] - 1] + " " + m[1] : iso;
  }

  function shortDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
    return m ? +m[3] + "-" + MONTHS[+m[2] - 1] + "-" + m[1] : iso;
  }

  function itemText(i) {
    var unit = i.unit || "spools";
    if (i.count === 1) unit = unit.replace(/s$/, "");   // "1 spool", not "1 spools"
    return i.label + (i.count != null ? ": " + i.count + " " + unit : "")
      + (i.when ? " (" + i.when + ")" : "") + (i.note ? " [" + i.note + "]" : "");
  }

  // The table of a note as readable lines: totals and lines with a bullet, parts indented under them.
  function discussionText(note) {
    return (note.items || []).map(function (i) { return (i.indent ? "      – " : "• ") + itemText(i); }).join("\n");
  }

  function band(text, style, width) {
    var row = [{ v: text, s: style }];
    while (row.length < width) row.push({ s: style });
    return row;
  }

  function byProjectThenNewest(a, b) {
    return a.project.localeCompare(b.project) || b.date.localeCompare(a.date) || (b.ts || 0) - (a.ts || 0);
  }

  function hasNotesOn(notes, meeting) {
    return notes.some(function (n) { return n.date === meeting; });
  }

  function buildSheets(notes, meeting, todayIso) {
    var projectNames = {};
    notes.forEach(function (n) { projectNames[n.project] = true; });

    var atMeeting = notes.filter(function (n) { return n.date === meeting; }).sort(function (a, b) {
      return a.project.localeCompare(b.project) || (a.ts || 0) - (b.ts || 0);
    });
    var discussed = {};
    atMeeting.forEach(function (n) { discussed[n.project] = true; });
    var skipped = Object.keys(projectNames).sort().filter(function (name) { return !discussed[name]; }).map(function (name) {
      var earlier = notes.filter(function (n) { return n.project === name && n.date < meeting; })
        .map(function (n) { return n.date; }).sort();
      return earlier.length ? { project: name, last: earlier[earlier.length - 1] } : null;
    }).filter(Boolean);

    var minutes = [
      band("DEE Piping Systems — SIOP Meeting", "title", 4),
      band("Minutes of Meeting · " + longDate(meeting), "subtitle", 4),
      [],
      [{ v: "Meeting date", s: "label" }, null, { v: dateSerial(meeting), s: "date" }],
      // Out of the projects that already had a note by that meeting.
      [{ v: "Projects discussed", s: "label" }, null, Object.keys(discussed).length + " of " + (Object.keys(discussed).length + skipped.length)],
      [{ v: "Generated on", s: "label" }, null, { v: dateSerial(todayIso), s: "date" }],
      [],
      [{ v: "No.", s: "head" }, { v: "Project", s: "head" }, { v: "Discussion", s: "head" }, { v: "Remarks", s: "head" }]
    ];
    atMeeting.forEach(function (n, index) {
      var table = discussionText(n);
      minutes.push([
        { v: index + 1, s: "num" }, { v: n.project, s: "bodyBold" },
        { v: table || n.remarks || "", s: "body" }, { v: table ? n.remarks || "" : "", s: "body" }
      ]);
    });
    if (skipped.length) {
      minutes.push([], band("Not discussed at this meeting", "section", 4));
      skipped.forEach(function (s, index) {
        minutes.push([{ v: index + 1, s: "num" }, { v: s.project, s: "bodyBold" }, { v: "Last discussed " + shortDate(s.last), s: "body" }, { s: "body" }]);
      });
    }
    minutes.push([], [{ v: "Generated from the SIOP Meeting Tracker on " + longDate(todayIso), s: "muted" }]);

    var head = function (labels) { return labels.map(function (v) { return { v: v, s: "head" }; }); };
    var history = [head(["Project", "Meeting date", "Department", "Discussion", "Remarks", "Entered by"])];
    var lines = [head(["Project", "Meeting date", "Level", "What", "How many", "Unit", "By when", "Note"])];
    notes.slice().sort(byProjectThenNewest).forEach(function (n) {
      var table = discussionText(n);
      history.push([
        { v: n.project, s: "bodyBold" }, { v: dateSerial(n.date), s: "date" }, { v: n.dept || "", s: "body" },
        { v: table || n.remarks || "", s: "body" }, { v: table ? n.remarks || "" : "", s: "body" }, { v: n.by || "", s: "body" }
      ]);
      (n.items || []).forEach(function (i) {
        lines.push([
          { v: n.project, s: "bodyBold" }, { v: dateSerial(n.date), s: "date" }, { v: i.group ? "Total" : i.indent ? "Part" : "Line", s: "body" },
          { v: i.label, s: "body" }, { v: i.count != null ? i.count : "", s: "num" }, { v: i.count != null ? i.unit || "spools" : "", s: "body" },
          { v: i.when || "", s: "body" }, { v: i.note || "", s: "body" }
        ]);
      });
    });

    return [
      { name: "MOM " + shortDate(meeting), cols: [6, 24, 70, 55], rows: minutes, hideGrid: true, rowHeights: { 1: 30, 2: 24, 8: 26 } },
      { name: "History", cols: [22, 14, 14, 70, 55, 28], rows: history, freezeRow: 1, filterRow: 1 },
      { name: "Table lines", cols: [22, 14, 9, 40, 10, 10, 22, 40], rows: lines, freezeRow: 1, filterRow: 1 }
    ];
  }

  var api = { buildSheets: buildSheets, hasNotesOn: hasNotesOn, shortDate: shortDate };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MomMinutes = api;
})(typeof window !== "undefined" ? window : this);
