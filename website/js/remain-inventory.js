/*
 * remain-inventory.js - "Remain inventory" section of the Cutting Station page: the leftover pieces of pipes (latest remain after the
 * newest plan saved to Drive), a Scrap tick box per piece, and a separate Scrap list with Bring back. List only: nothing here changes
 * the Cutting Plan. The data lives in the sheet "Inventory" of the Cutting master (Apps Script getInventory / setScrap); only people on
 * the Allowed list can tick Scrap or Bring back (the script checks it; the page only greys the controls out). Columns sort by click; ticks are
 * collected and saved together with one Save (like the Material Handover section).
 * History of a pipe (its main length): a History button on every row (getPipeHistory) shows every plan that used the pipe
 * (length before, pieces cut, remain after) and its other events (release, scrap, bring back).
 */
(function () {
  'use strict';
  var CS = window.CutStation;
  if (!CS) return;
  var $ = CS.el, esc = CS.esc, toast = CS.toast, D = CS.D;
  // columns of a row as the script sends them
  var C = { code: 0, item: 1, desc: 2, control: 3, heat: 4, project: 5, orig: 6, remain: 7, plan: 8, date: 9, created: 10, updated: 11, scrap: 12, by: 13, at: 14 };
  var rows = [], view = 'remain', loaded = false, histData = null;

  function isScrap(r) { return r[C.scrap] === 'Yes'; }
  function inView(r) { return view === 'scrap' ? isScrap(r) : (!isScrap(r) && Number(r[C.remain]) > 0); }
  function filtered() {
    var it = $('invItem').value.trim().toLowerCase(), bc = $('invBar').value.trim().toLowerCase(), pr = $('invProj').value;
    var from = parseFloat($('invFrom').value), to = parseFloat($('invTo').value);
    return rows.filter(function (r) {
      var n = Number(r[C.remain]);
      return inView(r) && (!it || String(r[C.item]).toLowerCase().indexOf(it) >= 0) && (!bc || String(r[C.code]).toLowerCase().indexOf(bc) >= 0) &&
        (!pr || r[C.project] === pr) && (isNaN(from) || n >= from) && (isNaN(to) || n <= to);
    }).sort(cmp);
  }
  function dayOf(t) { return D.dmy(String(t || '').slice(0, 10)); }

  // ---- sorting (click a column heading; click again to reverse) and ticking several pipes before one Save ----
  var sortKey = '', sortDir = 1, pend = {};
  var COLS = {      // view -> [heading, sort key, type: t text, n number, d date]
    remain: [['Item Code', 'item', 't'], ['Description', 'desc', 't'], ['Barcode', 'code', 't'], ['Control No', 'control', 't'], ['Heat No', 'heat', 't'], ['Original length', 'orig', 'n'], ['Remain (mm)', 'remain', 'n'], ['Last plan', 'plan', 't'], ['Plan date', 'date', 'd']],
    scrap: [['Item Code', 'item', 't'], ['Description', 'desc', 't'], ['Barcode', 'code', 't'], ['Remain (mm)', 'remain', 'n'], ['Marked scrap by', 'by', 't'], ['On', 'at', 'd']]
  };
  function typeOf(key) { var t = 't'; COLS[view].forEach(function (c) { if (c[1] === key) t = c[2]; }); return t; }
  function sortVal(r, key, t) { var v = r[C[key]]; return t === 'n' ? Number(v) || 0 : t === 'd' ? (D.iso(String(v || '').slice(0, 10)) || '') : String(v == null ? '' : v).toLowerCase(); }
  function cmp(a, b) {
    if (!sortKey) return String(a[C.item]).localeCompare(String(b[C.item])) || Number(b[C.remain]) - Number(a[C.remain]) || String(a[C.code]).localeCompare(String(b[C.code]));
    var t = typeOf(sortKey), x = sortVal(a, sortKey, t), y = sortVal(b, sortKey, t), d = t === 't' ? x.localeCompare(y, undefined, { numeric: true }) : (x < y ? -1 : x > y ? 1 : 0);
    return d ? d * sortDir : String(a[C.code]).localeCompare(String(b[C.code]));
  }
  function pendCount() { return Object.keys(pend).length; }
  function th(c) { return '<th class="cp-sort' + (c[2] === 'n' ? ' n' : '') + '" data-sort="' + c[1] + '" title="Click to sort">' + esc(c[0]) + (sortKey === c[1] ? (sortDir > 0 ? ' \u25B2' : ' \u25BC') : '') + '</th>'; }
  function syncBar(list) {
    var n = pendCount();
    $('invSaveBar').hidden = !n;
    $('invDirty').textContent = n + (n === 1 ? ' pipe' : ' pipes') + (view === 'remain' ? ' will move to the Scrap list' : ' will be brought back to the cut piece remain list') + '. Not saved yet.';
    var all = $('invAll'); if (all) all.checked = !!list.length && list.every(function (r) { return pend[r[C.code]]; });
  }

  function render() {
    var nRemain = rows.filter(function (r) { return !isScrap(r) && Number(r[C.remain]) > 0; }).length, nScrap = rows.filter(isScrap).length;
    $('invTabRemain').textContent = 'Cut piece remain list (' + nRemain + ')'; $('invTabScrap').textContent = 'Scrap list (' + nScrap + ')';
    ['Remain', 'Scrap'].forEach(function (k) { $('invTab' + k).className = 'btn ' + (view === k.toLowerCase() ? 'btn--primary' : 'btn--ghost'); });
    var sel = $('invProj'), cur = sel.value, seen = {}, opts = '<option value="">All projects</option>';
    rows.forEach(function (r) { var p = r[C.project]; if (p && !seen[p]) { seen[p] = 1; opts += '<option value="' + esc(p) + '">' + esc(p) + '</option>'; } });
    sel.innerHTML = opts; sel.value = seen[cur] ? cur : '';
    var list = filtered();
    $('invCount').textContent = 'Showing ' + list.length + ' of ' + (view === 'scrap' ? nScrap : nRemain) + ' pipes' + (sortKey ? '' : (view === 'remain' ? ', sorted by item code, then longest remain first' : '')) + '. Click a column heading to sort.';
    $('invHint').textContent = view === 'scrap' ? 'Pieces marked as scrap. Tick the pipes to bring back (or tick all shown), then press Save changes.' :
      'Leftover pieces of pipes, updated when a plan is saved to Drive. Tick the pipes to scrap (or tick all shown), then press Save changes.';
    var hb = function (r) { return '<button class="btn btn--ghost cp-small" type="button" data-hist="' + esc(r[C.code]) + '">History</button>'; };
    var box = function (r, attr) { var c = r[C.code]; return '<td><input type="checkbox" data-tick="' + esc(c) + '" ' + attr + '="' + esc(c) + '"' + (pend[c] ? ' checked' : '') + ' aria-label="' + esc(c) + '"></td>'; };
    var tr = function (r, inner) { return '<tr' + (pend[r[C.code]] ? ' class="cp-pend"' : '') + '>' + inner + '</tr>'; };
    if (view === 'remain') {
      $('invTbl').innerHTML = '<tr>' + COLS.remain.map(th).join('') + '<th><label class="cp-allbox"><input type="checkbox" id="invAll" data-all> Scrap</label></th><th></th></tr>' +
        list.map(function (r) {
          return tr(r, '<td><b>' + esc(r[C.item]) + '</b></td><td>' + esc(r[C.desc]) + '</td><td>' + esc(r[C.code]) + '</td><td>' + esc(r[C.control]) + '</td><td>' + esc(r[C.heat]) + '</td><td class="n">' + esc(r[C.orig]) +
            '</td><td class="n"><b>' + esc(r[C.remain]) + '</b></td><td>' + esc(r[C.plan]) + '</td><td>' + esc(D.dmy(r[C.date])) + '</td>' + box(r, 'data-scrap') + '<td>' + hb(r) + '</td>');
        }).join('');
    } else {
      $('invTbl').innerHTML = '<tr>' + COLS.scrap.map(th).join('') + '<th><label class="cp-allbox"><input type="checkbox" id="invAll" data-all> Bring back</label></th><th></th></tr>' +
        list.map(function (r) {
          return tr(r, '<td><b>' + esc(r[C.item]) + '</b></td><td>' + esc(r[C.desc]) + '</td><td>' + esc(r[C.code]) + '</td><td class="n"><b>' + esc(r[C.remain]) + '</b></td><td>' + esc(r[C.by]) + '</td><td>' + esc(dayOf(r[C.at])) +
            '</td>' + box(r, 'data-bring') + '<td>' + hb(r) + '</td>');
        }).join('');
    }
    Array.prototype.forEach.call($('invTbl').querySelectorAll('[data-sort]'), function (h) {
      h.onclick = function () { if (sortKey === h.dataset.sort) sortDir = -sortDir; else { sortKey = h.dataset.sort; sortDir = 1; } render(); };
    });
    Array.prototype.forEach.call($('invTbl').querySelectorAll('[data-tick]'), function (b) {
      b.onchange = function () { if (b.checked) pend[b.dataset.tick] = 1; else delete pend[b.dataset.tick]; b.closest('tr').classList.toggle('cp-pend', b.checked); syncBar(list); };
    });
    $('invAll').onchange = function () { var on = this.checked; list.forEach(function (r) { if (on) pend[r[C.code]] = 1; else delete pend[r[C.code]]; }); render(); };
    Array.prototype.forEach.call($('invTbl').querySelectorAll('[data-hist]'), function (b) { b.onclick = function () { openHistory(b.dataset.hist); }; });
    syncBar(list);
  }

  // one Save for all ticked pipes: one request, one message
  function saveChanges() {
    var codes = Object.keys(pend), scrap = view === 'remain';
    if (!codes.length) return;
    $('invSave').disabled = true;
    CS.api('setScrap', { barcodes: codes, scrap: scrap }).then(function () {
      rows.forEach(function (r) { if (pend[r[C.code]]) { r[C.scrap] = scrap ? 'Yes' : 'No'; r[C.by] = scrap ? 'you' : ''; r[C.at] = scrap ? D.todayIso() : ''; } });
      pend = {};
      toast(true, codes.length + (codes.length === 1 ? ' pipe' : ' pipes') + (scrap ? ' moved to the Scrap list.' : ' brought back to the cut piece remain list.'));
      render(); load(true);
    }).catch(function (e) { toast(false, 'NOT saved: ' + e.message); }).then(function () { $('invSave').disabled = false; });
  }
  function switchView(v) {
    if (v === view) return;
    if (pendCount() && !confirm('You have unsaved ticks. Leave without saving?')) return;
    pend = {}; view = v; sortKey = ''; sortDir = 1; $('invHist').hidden = true; render();
  }

  // descriptions of plans saved before the description existed are filled in from the BOM in the background
  function fillDescriptions() {
    var byProject = {};
    rows.forEach(function (r) { if (!r[C.desc] && r[C.project]) (byProject[r[C.project]] = byProject[r[C.project]] || []).push(r); });
    Object.keys(byProject).forEach(function (p) {
      if (!CS.bomSpecs) return;
      CS.bomSpecs(p).then(function (map) {
        if (!map) return;
        byProject[p].forEach(function (r) { if (!r[C.desc]) r[C.desc] = map[String(r[C.item]).trim().toUpperCase()] || ''; });
        render();
      });
    });
  }

  function load(quiet) {
    if (!quiet) $('invCount').textContent = 'Loading...';
    CS.api('getInventory').then(function (r) { rows = r.rows || []; loaded = true; render(); fillDescriptions(); })
      .catch(function (e) { if (!quiet) $('invCount').textContent = ''; toast(false, 'Could not load the inventory: ' + e.message); });
  }

  function download() {
    var list = filtered();
    if (!list.length) return toast(false, 'Nothing to download. Check the filters.');
    var head = view === 'scrap' ? ['Item Code', 'Description', 'Barcode', 'Control No', 'Heat No', 'Project', 'Remain (mm)', 'Marked scrap by', 'Marked scrap on'] :
      ['Item Code', 'Description', 'Barcode', 'Control No', 'Heat No', 'Project', 'Original length', 'Remain (mm)', 'Last plan', 'Plan date', 'Updated'];
    var aoa = [head].concat(list.map(function (r) {
      return view === 'scrap' ? [r[C.item], r[C.desc], r[C.code], r[C.control], r[C.heat], r[C.project], Number(r[C.remain]), r[C.by], dayOf(r[C.at])] :
        [r[C.item], r[C.desc], r[C.code], r[C.control], r[C.heat], r[C.project], Number(r[C.orig]), Number(r[C.remain]), r[C.plan], D.dmy(r[C.date]), r[C.updated]];
    }));
    var ws = D.fixDates(XLSX.utils.aoa_to_sheet(aoa)); ws['!cols'] = head.map(function (h, i) { return { wch: i === 1 ? 38 : 16 }; });
    var wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, view === 'scrap' ? 'Scrap list' : 'Cut piece remain list');
    XLSX.writeFile(wb, (view === 'scrap' ? 'scrap-list-' : 'cut-piece-remain-list-') + D.dmy(D.todayIso()) + '.xlsx');
  }

  /* ---------- history of one pipe ---------- */
  // plan rows from the script: [barcode, planNo, planDate, createdAt, lengthBefore, pieces, piecesText, totalCut, remainAfter, savedBy, savedAt]
  // event rows: [timestamp, user, action, barcode, item, remain, planNo]
  function openHistory(code) {
    var box = $('invHist'); box.hidden = false; box.innerHTML = '<p class="cp-note">Loading the history of pipe ' + esc(code) + '...</p>';
    box.scrollIntoView({ block: 'nearest' });
    CS.api('getPipeHistory', { barcode: code }).then(function (r) { histData = { code: code, pipe: r.pipe, plans: r.plans || [], events: r.events || [] }; renderHistory(); })
      .catch(function (e) { box.hidden = true; toast(false, 'Could not load the history: ' + e.message); });
  }
  function evClass(a) { return /^Plan saved/.test(a) ? 'ok' : /scrap|undone/i.test(a) ? 'warn' : 'info'; }
  function renderHistory() {
    var h = histData, box = $('invHist'), p = h.pipe, pl = h.plans;
    var pieces = pl.reduce(function (n, r) { return n + (Number(r[5]) || 0); }, 0), cut = pl.reduce(function (n, r) { return n + (Number(r[7]) || 0); }, 0);
    var orig = pl.length ? pl[0][4] : (p ? p[C.orig] : ''), now = p ? p[C.remain] : (pl.length ? pl[pl.length - 1][8] : '');
    var status = !p && !pl.length ? 'No saved plan has used this pipe' : p && isScrap(p) ? 'In the Scrap list' : Number(now) > 0 ? 'In the cut piece remain list' : 'Nothing left (0 mm)';
    var info = p ? [p[C.item], p[C.desc], p[C.control] && 'Control ' + p[C.control], p[C.heat] && 'Heat ' + p[C.heat]].filter(Boolean).join(' - ') : '';
    var th = '<tr><th>#</th><th>Date</th><th>Plan</th><th class="n">Length before</th><th>Pieces cut</th><th class="n">Total cut</th><th class="n">Remain after</th><th>Saved by</th></tr>';
    var body = pl.map(function (r, i) {
      return '<tr><td>' + (i + 1) + '</td><td>' + esc(D.dmy(r[2])) + '</td><td>' + esc(r[1]) + '</td><td class="n">' + esc(r[4]) + '</td><td>' + esc(r[6]) + ' (' + esc(r[5]) + (Number(r[5]) === 1 ? ' piece' : ' pieces') + ')</td><td class="n">' + esc(r[7]) +
        '</td><td class="n"><b>' + esc(r[8]) + '</b></td><td>' + esc(r[9]) + '</td></tr>';
    }).join('');
    var ev = h.events.map(function (e) {
      return '<div class="cp-hev"><span class="cp-hev__tag cp-hev__tag--' + evClass(e[2]) + '">' + esc(e[2]) + '</span> ' + esc(String(e[0]).slice(0, 16)) + (e[6] ? ' - ' + esc(e[6]) : '') + (e[5] !== '' ? ' - remain ' + esc(e[5]) : '') + ' - ' + esc(e[1]) + '</div>';
    }).join('');
    box.innerHTML = '<div class="cp-card__head"><h3>History of pipe ' + esc(h.code) + '</h3><span class="cp-hint">' + esc(info) + '</span></div>' +
      '<div class="cp-hfacts"><div><b>Original length</b>' + esc(orig) + ' mm</div><div><b>Plans</b>' + pl.length + '</div><div><b>Total cut</b>' + cut + ' mm (' + pieces + (pieces === 1 ? ' piece' : ' pieces') + ')</div><div><b>Remain now</b><strong>' + esc(now) + ' mm</strong></div><div><b>Status</b>' + esc(status) + '</div></div>' +
      (pl.length ? '<p class="cp-note">One row per saved plan that used this pipe, oldest first:</p><div class="cp-tw"><table class="cp-sttbl">' + th + body + '</table></div>' :
        '<p class="cp-note">No plan history is stored for this pipe. Plans saved to Drive before this feature are added when the history is first filled.</p>') +
      (h.events.length ? '<p class="cp-note"><b>Other events on this pipe</b></p>' + ev : '') +
      '<div class="cp-row"><button class="btn btn--ghost" id="invHistXl" type="button">Download this history (Excel)</button><button class="btn btn--ghost" id="invHistClose" type="button">Close</button></div>';
    $('invHistClose').onclick = function () { box.hidden = true; };
    $('invHistXl').onclick = histExcel;
  }
  function histExcel() {
    var h = histData;
    var plans = [['Barcode', 'Date', 'Plan', 'Length before', 'Pieces', 'Pieces cut', 'Total cut', 'Remain after', 'Saved by', 'Saved at']].concat(h.plans.map(function (r) {
      return [h.code, D.dmy(r[2]), r[1], Number(r[4]), Number(r[5]), r[6], Number(r[7]), Number(r[8]), r[9], r[10]];
    }));
    var events = [['Barcode', 'Time', 'User', 'Event', 'Plan', 'Remain']].concat(h.events.map(function (e) { return [h.code, e[0], e[1], e[2], e[6], e[5] === '' ? '' : Number(e[5])]; }));
    var wb = XLSX.utils.book_new();
    [['Plans', plans], ['Events', events]].forEach(function (x) {
      var ws = D.fixDates(XLSX.utils.aoa_to_sheet(x[1])); ws['!cols'] = x[1][0].map(function () { return { wch: 18 }; });
      XLSX.utils.book_append_sheet(wb, ws, x[0]);
    });
    XLSX.writeFile(wb, 'pipe-history-' + h.code + '-' + D.dmy(D.todayIso()) + '.xlsx');
  }
  $('invTabRemain').onclick = function () { switchView('remain'); };
  $('invTabScrap').onclick = function () { switchView('scrap'); };
  $('invSave').onclick = saveChanges;
  $('invDiscard').onclick = function () { pend = {}; render(); };
  CS.dirtyFns.push(function () { return pendCount() > 0; });
  ['invItem', 'invBar', 'invFrom', 'invTo'].forEach(function (id) { $(id).oninput = render; });
  $('invProj').onchange = render;
  $('invClear').onclick = function () { ['invItem', 'invBar', 'invFrom', 'invTo'].forEach(function (id) { $(id).value = ''; }); $('invProj').value = ''; render(); };
  $('invXl').onclick = download;
  CS.sectionHooks.inventory = function () { load(loaded); };       // reload every time the section is opened (quietly when it is already on screen)
})();
