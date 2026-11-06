/*
 * remain-inventory.js - "Remain inventory" section of the Cutting Station page: the leftover pieces of pipes (latest remain after the
 * newest plan saved to Drive), a Scrap tick box per piece, and a separate Scrap list with Bring back. List only: nothing here changes
 * the Cutting Plan. The data lives in the sheet "Inventory" of the Cutting master (Apps Script getInventory / setScrap); only people on
 * the Allowed list can tick Scrap or Bring back (the script checks it; the page only greys the controls out).
 * History of a pipe (its main length): a History button on every row and a "Barcode history" tab (getPipeHistory / findPipes) show every
 * plan that used the pipe (length before, pieces cut, remain after) and its other events (release, scrap, bring back).
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
    }).sort(function (a, b) { return String(a[C.item]).localeCompare(String(b[C.item])) || Number(b[C.remain]) - Number(a[C.remain]) || String(a[C.code]).localeCompare(String(b[C.code])); });
  }
  function dayOf(t) { return D.dmy(String(t || '').slice(0, 10)); }

  function render() {
    var nRemain = rows.filter(function (r) { return !isScrap(r) && Number(r[C.remain]) > 0; }).length, nScrap = rows.filter(isScrap).length;
    $('invTabRemain').textContent = 'Cut piece remain list (' + nRemain + ')'; $('invTabScrap').textContent = 'Scrap list (' + nScrap + ')';
    ['Remain', 'Scrap', 'Hist'].forEach(function (k) { $('invTab' + k).className = 'btn ' + (view === k.toLowerCase() ? 'btn--primary' : 'btn--ghost'); });
    $('invListBox').hidden = view === 'hist'; $('invSearch').hidden = view !== 'hist';
    if (view === 'hist') { $('invHint').textContent = 'Type a barcode to see everything that happened to that pipe: every plan that used it and its other events.'; return; }
    var sel = $('invProj'), cur = sel.value, seen = {}, opts = '<option value="">All projects</option>';
    rows.forEach(function (r) { var p = r[C.project]; if (p && !seen[p]) { seen[p] = 1; opts += '<option value="' + esc(p) + '">' + esc(p) + '</option>'; } });
    sel.innerHTML = opts; sel.value = seen[cur] ? cur : '';
    var list = filtered();
    $('invCount').textContent = 'Showing ' + list.length + ' of ' + (view === 'scrap' ? nScrap : nRemain) + ' pipes' + (view === 'remain' ? ', sorted by item code, then longest remain first' : '');
    $('invHint').textContent = view === 'scrap' ? 'Pieces marked as scrap. They are not in the cut piece remain list. Press Bring back to return a piece to it.' :
      'Leftover pieces of pipes, updated when a plan is saved to Drive. Tick Scrap on a row to move that piece to the Scrap list.';
    var hb = function (r) { return '<button class="btn btn--ghost cp-small" type="button" data-hist="' + esc(r[C.code]) + '">History</button>'; };
    if (view === 'remain') {
      $('invTbl').innerHTML = '<tr><th>Item Code</th><th>Description</th><th>Barcode</th><th>Control No</th><th>Heat No</th><th class="n">Original length</th><th class="n">Remain (mm)</th><th>Last plan</th><th>Plan date</th><th>Scrap</th><th></th></tr>' +
        list.map(function (r) {
          return '<tr><td><b>' + esc(r[C.item]) + '</b></td><td>' + esc(r[C.desc]) + '</td><td>' + esc(r[C.code]) + '</td><td>' + esc(r[C.control]) + '</td><td>' + esc(r[C.heat]) + '</td><td class="n">' + esc(r[C.orig]) +
            '</td><td class="n"><b>' + esc(r[C.remain]) + '</b></td><td>' + esc(r[C.plan]) + '</td><td>' + esc(D.dmy(r[C.date])) + '</td><td><input type="checkbox" data-scrap="' + esc(r[C.code]) + '" aria-label="Scrap ' + esc(r[C.code]) + '"></td><td>' + hb(r) + '</td></tr>';
        }).join('');
    } else {
      $('invTbl').innerHTML = '<tr><th>Item Code</th><th>Description</th><th>Barcode</th><th class="n">Remain (mm)</th><th>Marked scrap by</th><th>On</th><th></th><th></th></tr>' +
        list.map(function (r) {
          return '<tr><td><b>' + esc(r[C.item]) + '</b></td><td>' + esc(r[C.desc]) + '</td><td>' + esc(r[C.code]) + '</td><td class="n"><b>' + esc(r[C.remain]) + '</b></td><td>' + esc(r[C.by]) + '</td><td>' + esc(dayOf(r[C.at])) +
            '</td><td><button class="btn btn--ghost" type="button" data-bring="' + esc(r[C.code]) + '">Bring back</button></td><td>' + hb(r) + '</td></tr>';
        }).join('');
    }
    Array.prototype.forEach.call($('invTbl').querySelectorAll('[data-scrap]'), function (b) { b.onchange = function () { setScrap(b.dataset.scrap, true, b); }; });
    Array.prototype.forEach.call($('invTbl').querySelectorAll('[data-bring]'), function (b) { b.onclick = function () { setScrap(b.dataset.bring, false, b); }; });
    Array.prototype.forEach.call($('invTbl').querySelectorAll('[data-hist]'), function (b) { b.onclick = function () { openHistory(b.dataset.hist); }; });
  }

  function setScrap(code, scrap, el) {
    if (scrap && !confirm('Move pipe ' + code + ' to the Scrap list?')) { el.checked = false; return; }
    el.disabled = true;
    CS.api('setScrap', { barcode: code, scrap: scrap }).then(function () {
      rows.forEach(function (r) { if (r[C.code] === code) { r[C.scrap] = scrap ? 'Yes' : 'No'; r[C.by] = scrap ? 'you' : ''; r[C.at] = scrap ? D.todayIso() : ''; } });
      toast(true, scrap ? 'Pipe ' + code + ' moved to the Scrap list.' : 'Pipe ' + code + ' brought back to the cut piece remain list.');
      render(); load(true);
    }).catch(function (e) { toast(false, 'NOT saved: ' + e.message); el.disabled = false; if (el.type === 'checkbox') el.checked = false; });
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
  // Barcode history tab: find a pipe by (part of) its barcode, also pipes with nothing left
  function searchPipe() {
    var q = $('invHistQ').value.trim(), pick = $('invPick');
    if (q.length < 3) { pick.hidden = false; pick.innerHTML = '<p class="cp-note">Type at least 3 characters of the barcode.</p>'; return; }
    pick.hidden = false; pick.innerHTML = '<p class="cp-note">Searching...</p>';
    CS.api('findPipes', { q: q }).then(function (r) {
      var f = r.rows || [];
      if (!f.length) { pick.innerHTML = '<p class="cp-note">No pipe found with this barcode. Only pipes that were in a plan saved to Drive are known.</p>'; $('invHist').hidden = true; return; }
      if (f.length === 1) { pick.hidden = true; openHistory(f[0][0]); return; }
      pick.innerHTML = '<p class="cp-note">' + f.length + ' pipes match. Choose one:</p><div class="cp-tw"><table class="cp-sttbl"><tr><th>Barcode</th><th>Item Code</th><th class="n">Remain (mm)</th><th></th></tr>' +
        f.map(function (x) { return '<tr><td>' + esc(x[0]) + '</td><td>' + esc(x[1]) + '</td><td class="n">' + esc(x[2]) + (x[3] === 'Yes' ? ' (scrap)' : '') + '</td><td><button class="btn btn--ghost cp-small" type="button" data-pick="' + esc(x[0]) + '">History</button></td></tr>'; }).join('') + '</table></div>';
      Array.prototype.forEach.call(pick.querySelectorAll('[data-pick]'), function (b) { b.onclick = function () { openHistory(b.dataset.pick); }; });
    }).catch(function (e) { pick.innerHTML = '<p class="cp-note cp-bad">' + esc(e.message) + '</p>'; });
  }

  $('invTabRemain').onclick = function () { view = 'remain'; $('invHist').hidden = true; render(); };
  $('invTabScrap').onclick = function () { view = 'scrap'; $('invHist').hidden = true; render(); };
  $('invTabHist').onclick = function () { view = 'hist'; $('invHist').hidden = true; render(); $('invHistQ').focus(); };
  $('invHistGo').onclick = searchPipe;
  $('invHistQ').onkeydown = function (e) { if (e.key === 'Enter') searchPipe(); };
  ['invItem', 'invBar', 'invFrom', 'invTo'].forEach(function (id) { $(id).oninput = render; });
  $('invProj').onchange = render;
  $('invClear').onclick = function () { ['invItem', 'invBar', 'invFrom', 'invTo'].forEach(function (id) { $(id).value = ''; }); $('invProj').value = ''; render(); };
  $('invXl').onclick = download;
  CS.sectionHooks.inventory = function () { load(loaded); };       // reload every time the section is opened (quietly when it is already on screen)
})();
