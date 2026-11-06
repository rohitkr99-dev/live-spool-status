/*
 * remain-inventory.js - "Remain inventory" section of the Cutting Station page: the leftover pieces of pipes (latest remain after the
 * newest plan saved to Drive), a Scrap tick box per piece, and a separate Scrap list with Bring back. List only: nothing here changes
 * the Cutting Plan. The data lives in the sheet "Inventory" of the Cutting master (Apps Script getInventory / setScrap); only people on
 * the Allowed list can tick Scrap or Bring back (the script checks it; the page only greys the controls out).
 */
(function () {
  'use strict';
  var CS = window.CutStation;
  if (!CS) return;
  var $ = CS.el, esc = CS.esc, toast = CS.toast, D = CS.D;
  // columns of a row as the script sends them
  var C = { code: 0, item: 1, desc: 2, control: 3, heat: 4, project: 5, orig: 6, remain: 7, plan: 8, date: 9, created: 10, updated: 11, scrap: 12, by: 13, at: 14 };
  var rows = [], view = 'remain', loaded = false;

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
    $('invTabRemain').className = 'btn ' + (view === 'remain' ? 'btn--primary' : 'btn--ghost'); $('invTabScrap').className = 'btn ' + (view === 'scrap' ? 'btn--primary' : 'btn--ghost');
    var sel = $('invProj'), cur = sel.value, seen = {}, opts = '<option value="">All projects</option>';
    rows.forEach(function (r) { var p = r[C.project]; if (p && !seen[p]) { seen[p] = 1; opts += '<option value="' + esc(p) + '">' + esc(p) + '</option>'; } });
    sel.innerHTML = opts; sel.value = seen[cur] ? cur : '';
    var list = filtered();
    $('invCount').textContent = 'Showing ' + list.length + ' of ' + (view === 'scrap' ? nScrap : nRemain) + ' pipes' + (view === 'remain' ? ', sorted by item code, then longest remain first' : '');
    $('invHint').textContent = view === 'scrap' ? 'Pieces marked as scrap. They are not in the cut piece remain list. Press Bring back to return a piece to it.' :
      'Leftover pieces of pipes, updated when a plan is saved to Drive. Tick Scrap on a row to move that piece to the Scrap list.';
    if (view === 'remain') {
      $('invTbl').innerHTML = '<tr><th>Item Code</th><th>Description</th><th>Barcode</th><th>Control No</th><th>Heat No</th><th class="n">Original length</th><th class="n">Remain (mm)</th><th>Last plan</th><th>Plan date</th><th>Scrap</th></tr>' +
        list.map(function (r) {
          return '<tr><td><b>' + esc(r[C.item]) + '</b></td><td>' + esc(r[C.desc]) + '</td><td>' + esc(r[C.code]) + '</td><td>' + esc(r[C.control]) + '</td><td>' + esc(r[C.heat]) + '</td><td class="n">' + esc(r[C.orig]) +
            '</td><td class="n"><b>' + esc(r[C.remain]) + '</b></td><td>' + esc(r[C.plan]) + '</td><td>' + esc(D.dmy(r[C.date])) + '</td><td><input type="checkbox" data-scrap="' + esc(r[C.code]) + '" aria-label="Scrap ' + esc(r[C.code]) + '"></td></tr>';
        }).join('');
    } else {
      $('invTbl').innerHTML = '<tr><th>Item Code</th><th>Description</th><th>Barcode</th><th class="n">Remain (mm)</th><th>Marked scrap by</th><th>On</th><th></th></tr>' +
        list.map(function (r) {
          return '<tr><td><b>' + esc(r[C.item]) + '</b></td><td>' + esc(r[C.desc]) + '</td><td>' + esc(r[C.code]) + '</td><td class="n"><b>' + esc(r[C.remain]) + '</b></td><td>' + esc(r[C.by]) + '</td><td>' + esc(dayOf(r[C.at])) +
            '</td><td><button class="btn btn--ghost" type="button" data-bring="' + esc(r[C.code]) + '">Bring back</button></td></tr>';
        }).join('');
    }
    Array.prototype.forEach.call($('invTbl').querySelectorAll('[data-scrap]'), function (b) { b.onchange = function () { setScrap(b.dataset.scrap, true, b); }; });
    Array.prototype.forEach.call($('invTbl').querySelectorAll('[data-bring]'), function (b) { b.onclick = function () { setScrap(b.dataset.bring, false, b); }; });
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

  $('invTabRemain').onclick = function () { view = 'remain'; render(); };
  $('invTabScrap').onclick = function () { view = 'scrap'; render(); };
  ['invItem', 'invBar', 'invFrom', 'invTo'].forEach(function (id) { $(id).oninput = render; });
  $('invProj').onchange = render;
  $('invClear').onclick = function () { ['invItem', 'invBar', 'invFrom', 'invTo'].forEach(function (id) { $(id).value = ''; }); $('invProj').value = ''; render(); };
  $('invXl').onclick = download;
  CS.sectionHooks.inventory = function () { load(loaded); };       // reload every time the section is opened (quietly when it is already on screen)
})();
