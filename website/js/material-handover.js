/*
 * material-handover.js - "Material Handover" section of the Cutting Station page.
 * One tick per spool. The spool list comes from the tracker's published spool data (shared download in cutting-status.js);
 * the saved state lives in the "Material Handover - MASTER" Google Sheet, reached through the Drive script with the user's site login.
 * Received By starts as the spool's Group; the date starts as today. Saving warns (but never blocks) when a spool's pipe pieces are
 * not all cut and bevelled in the Cutting and Beveling master.
 */
(function () {
  'use strict';
  var CS = window.CutStation;
  if (!CS || !CS.spools) return;
  var $ = CS.el, esc = CS.esc, api = CS.api, toast = CS.toast, D = CS.D;
  var PAGE = 100;

  var spools = null;      // tracker spool list
  var saved = {};         // key -> saved handover row (from the master)
  var cutSum = {};        // normalised key -> [pieces, cut, bevelled]
  var edits = {};         // key -> edited handover state (only for spools the user touched)
  var filtered = [], shown = PAGE, loading = false;

  var today = D.todayIso;
  var nk = function (s) { return String(s == null ? '' : s).trim().toLowerCase(); };
  var keyOf = function (s) { return s.project + '|' + s.drawing + '|' + s.spool; };
  var baseOf = function (s) {
    var r = saved[keyOf(s)];
    return r ? { handed: !!r.handed, date: r.handed ? D.iso(r.date) : '', receivedBy: r.receivedBy || '', remark: r.remark || '' } : { handed: false, date: '', receivedBy: '', remark: '' };
  };
  var stateOf = function (s) { return edits[keyOf(s)] || baseOf(s); };
  var differs = function (a, b) { return a.handed !== b.handed || a.date !== b.date || a.receivedBy !== b.receivedBy || a.remark !== b.remark; };
  var dirtyKeys = function () { return Object.keys(edits).filter(function (k) { var s = specOf[k]; return s && differs(edits[k], baseOf(s)); }); };
  var specOf = {};        // key -> spool

  CS.dirtyFns.push(function () { return dirtyKeys().length > 0; });
  CS.sectionHooks.handover = init;

  /* ---------- loading ---------- */
  function init() {
    if (spools || loading) return;
    loading = true;
    $('hNote').className = 'cp-note'; $('hNote').textContent = 'Loading the spool list (a large file, the first time only) and the saved handovers...';
    Promise.all([CS.spools(), api('getHandover'), api('getCutSummary')]).then(function (r) {
      spools = r[0];
      spools.forEach(function (s) { specOf[keyOf(s)] = s; });
      r[1].rows.forEach(function (x) { saved[x.project + '|' + x.drawing + '|' + x.spool] = x; });
      indexCut(r[2].summary);
      fillFilters(); loading = false; $('hNote').textContent = ''; apply();
    }).catch(function (e) {
      loading = false; $('hNote').className = 'cp-note cp-bad'; $('hNote').textContent = 'Could not load: ' + e.message;
    });
  }
  function indexCut(summary) {   // cut-list names may differ a little from the tracker's, so also match on Project + Spool
    cutSum = {};
    Object.keys(summary).forEach(function (k) {
      var p = k.split('|'), v = summary[k];
      [nk(p[0]) + '|' + nk(p[1]) + '|' + nk(p[2]), nk(p[0]) + '|' + nk(p[2])].forEach(function (nkk) {
        var o = cutSum[nkk] || (cutSum[nkk] = [0, 0, 0]); o[0] += v[0]; o[1] += v[1]; o[2] += v[2];
      });
    });
  }
  function cutOf(s) { return cutSum[nk(s.project) + '|' + nk(s.drawing) + '|' + nk(s.spool)] || cutSum[nk(s.project) + '|' + nk(s.spool)] || null; }

  /* ---------- filters ---------- */
  function uniq(list, f) { var m = {}; list.forEach(function (s) { var v = f(s); if (v) m[v] = 1; }); return Object.keys(m); }
  function fillFilters() {
    var projects = {};
    spools.forEach(function (s) { if (s.project) projects[s.project] = s.projectName || ''; });
    $('hProject').innerHTML = '<option value="">All projects</option>' + Object.keys(projects).sort().map(function (p) { return '<option value="' + esc(p) + '">' + esc(p + (projects[p] ? ' - ' + projects[p] : '')) + '</option>'; }).join('');
    var num = function (w) { var m = /(\d+)/.exec(w); return m ? +m[1] : 9999; };
    $('hWeek').innerHTML = '<option value="">All weeks</option>' + uniq(spools, function (s) { return s.week; }).sort(function (a, b) { return num(a) - num(b) || a.localeCompare(b); }).map(function (w) { return '<option value="' + esc(w) + '">' + esc(w) + '</option>'; }).join('');
    $('hGroup').innerHTML = '<option value="">All groups</option>' + uniq(spools, function (s) { return s.group; }).sort().map(function (g) { return '<option value="' + esc(g) + '">' + esc(g) + '</option>'; }).join('');
  }
  var timer = null;
  ['hProject', 'hWeek', 'hGroup', 'hStatus'].forEach(function (id) { $(id).addEventListener('change', function () { shown = PAGE; apply(); }); });
  ['hDrawing', 'hSpool'].forEach(function (id) { $(id).addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(function () { shown = PAGE; apply(); }, 250); }); });

  function apply() {
    if (!spools) return;
    var p = $('hProject').value, w = $('hWeek').value, g = $('hGroup').value, st = $('hStatus').value, d = nk($('hDrawing').value), sp = nk($('hSpool').value);
    filtered = spools.filter(function (s) {
      if (p && s.project !== p) return false;
      if (w && s.week !== w) return false;
      if (g && s.group !== g) return false;
      if (d && nk(s.drawing).indexOf(d) < 0) return false;
      if (sp && nk(s.spool).indexOf(sp) < 0) return false;
      if (st && (stateOf(s).handed ? 'yes' : 'no') !== st) return false;
      return true;
    });
    render();
  }

  /* ---------- table ---------- */
  function cutCell(s) {
    var c = cutOf(s);
    if (!c) return '<span class="cp-note" style="margin:0">no cutting record</span>';
    var done = c[1] === c[0] && c[2] === c[0];
    return '<span class="' + (done ? 'cp-ok' : 'cp-warn') + '">' + c[1] + '/' + c[0] + ' cut &middot; ' + c[2] + '/' + c[0] + ' bevelled</span>';
  }
  function rowHtml(s, i) {
    var st = stateOf(s), dirty = differs(st, baseOf(s)), k = esc(keyOf(s));
    return '<tr data-i="' + i + '"' + (dirty ? ' class="cp-dirtyrow"' : '') + '><td class="cp-tick"><input type="checkbox" data-f="handed" data-k="' + k + '"' + (st.handed ? ' checked' : '') + ' aria-label="Handed over: ' + esc(s.spool) + '"></td>' +
      '<td>' + esc(s.project) + '</td><td>' + esc(s.drawing) + '</td><td>' + esc(s.spool) + '</td><td>' + esc(s.week) + '</td><td>' + esc(s.group) + '</td><td>' + cutCell(s) + '</td>' +
      '<td>' + esc(s.oldHandover ? D.dmy(D.iso(s.oldHandover)) || String(s.oldHandover).slice(0, 10) : '') + '</td>' +
      '<td>' + (st.handed ? '<input type="text" class="cp-date" size="10" maxlength="10" placeholder="DD-MM-YYYY" data-f="date" data-k="' + k + '" value="' + esc(D.dmy(st.date)) + '">' : '') + '</td>' +
      '<td><input type="text" class="cp-cell" data-f="receivedBy" data-k="' + k + '" value="' + esc(st.receivedBy) + '" placeholder="' + esc(s.group) + '"' + (st.handed ? '' : ' disabled') + '></td>' +
      '<td><input type="text" class="cp-cell" data-f="remark" data-k="' + k + '" value="' + esc(st.remark) + '" placeholder="Remark"></td></tr>';
  }
  function render() {
    $('hListCard').hidden = false;
    var rows = filtered.slice(0, shown);
    $('hTable').innerHTML = '<tr><th class="cp-tick"><input type="checkbox" id="hAll" aria-label="Tick all shown spools"></th><th>Project</th><th>Drawing No.</th><th>Spool No.</th><th>Week</th><th>Group</th><th>Cutting &amp; beveling</th><th title="Date in the old Material Handover workbook">Old sheet</th><th>Handover date</th><th>Received by</th><th>Remark</th></tr>' +
      (rows.length ? rows.map(rowHtml).join('') : '<tr><td colspan="11" class="cp-note">No spools match these filters.</td></tr>');
    $('hCount').textContent = 'Showing ' + rows.length + ' of ' + filtered.length + ' spools';
    $('hMore').hidden = filtered.length <= shown; $('hMore').textContent = 'Show ' + Math.min(PAGE, filtered.length - shown) + ' more';
    var all = $('hAll'); if (all) { var n = rows.filter(function (s) { return stateOf(s).handed; }).length; all.checked = rows.length > 0 && n === rows.length; all.indeterminate = n > 0 && n < rows.length; }
    updateBar();
  }
  $('hMore').onclick = function () { shown += PAGE; render(); };

  function setHanded(s, on) {
    var st = Object.assign({}, stateOf(s));
    st.handed = on;
    if (on) { if (!st.date) st.date = today(); if (!st.receivedBy) st.receivedBy = s.group || ''; } else { st.date = ''; st.receivedBy = ''; }
    edits[keyOf(s)] = st;
  }
  $('hTable').addEventListener('change', function (e) {
    var t = e.target;
    if (t.id === 'hAll') { filtered.slice(0, shown).forEach(function (s) { setHanded(s, t.checked); }); render(); return; }
    var k = t.dataset.k, s = k && specOf[k];
    if (!s) return;
    if (t.dataset.f === 'handed') { setHanded(s, t.checked); render(); }
    else if (t.dataset.f === 'date') {
      var iso = D.iso(t.value);
      if (iso || !t.value.trim()) edits[k] = Object.assign({}, stateOf(s), { date: iso || today() }); else toast(false, 'Type the date as DD-MM-YYYY, for example ' + D.dmy(today()) + '.');
      render();
    }
  });
  $('hTable').addEventListener('input', function (e) {       // typing: update the state without redrawing (keeps the cursor)
    var t = e.target, k = t.dataset.k, s = k && specOf[k];
    if (!s || (t.dataset.f !== 'receivedBy' && t.dataset.f !== 'remark')) return;
    var st = Object.assign({}, stateOf(s)); st[t.dataset.f] = t.value; edits[k] = st;
    var tr = t.closest('tr'); if (tr) tr.className = differs(st, baseOf(s)) ? 'cp-dirtyrow' : '';
    updateBar();
  });
  function updateBar() { var n = dirtyKeys().length; $('hSaveBar').hidden = n === 0; $('hDirty').textContent = n + ' unsaved change' + (n === 1 ? '' : 's'); }

  /* ---------- save ---------- */
  $('hDiscard').onclick = function () { edits = {}; render(); };
  $('hSave').onclick = function () {
    var keys = dirtyKeys();
    if (!keys.length) return;
    var warn = [];
    keys.forEach(function (k) {
      var s = specOf[k], st = edits[k];
      if (st.handed && !baseOf(s).handed) { var c = cutOf(s); if (c && (c[1] < c[0] || c[2] < c[0])) warn.push(s.spool + ': ' + c[1] + '/' + c[0] + ' cut, ' + c[2] + '/' + c[0] + ' bevelled'); }
    });
    if (warn.length && !confirm('Not all pipe pieces are cut and bevelled for ' + warn.length + ' spool' + (warn.length === 1 ? '' : 's') + ':\n\n' + warn.slice(0, 8).join('\n') + (warn.length > 8 ? '\n...and ' + (warn.length - 8) + ' more' : '') + '\n\nSave the handover anyway?')) return;
    var rows = keys.map(function (k) {
      var s = specOf[k], st = edits[k];
      return { project: s.project, drawing: s.drawing, spool: s.spool, week: s.week, group: s.group, handed: st.handed, date: st.date, receivedBy: st.receivedBy, remark: st.remark };
    });
    var btn = $('hSave'); btn.disabled = true; btn.textContent = 'Saving...';
    var reset = function () { btn.disabled = false; btn.textContent = 'Save changes'; };
    api('saveHandover', { rows: rows }).then(function (r) {
      toast(true, 'Saved: ' + r.changed + ' handover change' + (r.changed === 1 ? '' : 's') + '.');
      return api('getHandover');
    }).then(function (r) {
      saved = {}; r.rows.forEach(function (x) { saved[x.project + '|' + x.drawing + '|' + x.spool] = x; });
      edits = {}; reset(); apply();
    }).catch(function (e) { reset(); toast(false, 'NOT saved: ' + e.message); });
  };
  window.addEventListener('beforeunload', function (e) { if (dirtyKeys().length) { e.preventDefault(); e.returnValue = ''; } });

  /* ---------- report ---------- */
  $('hrDownload').onclick = function () {
    var btn = $('hrDownload'), msg = $('hrMsg');
    var f = { project: $('hrProject').value.trim(), week: $('hrWeek').value.trim(), from: D.field('hrFrom'), to: D.field('hrTo') };
    if (f.from === null || f.to === null) { msg.textContent = 'Type the dates as DD-MM-YYYY, for example ' + D.dmy(today()) + '.'; msg.className = 'cp-note cp-bad'; return; }
    btn.disabled = true; btn.textContent = 'Preparing...'; msg.textContent = ''; msg.className = 'cp-note';
    var done = function () { btn.disabled = false; btn.textContent = 'Download report (Excel)'; };
    api('getReport', { type: 'handover', project: f.project, week: f.week, from: f.from, to: f.to, history: $('hrHist').checked }).then(function (r) {
      done();
      if (!r.rows.length) { msg.textContent = 'No spools match these filters.'; msg.className = 'cp-note cp-warn'; return; }
      var sheet = function (h, rows) { var ws = D.fixDates(XLSX.utils.aoa_to_sheet([h].concat(rows.map(function (r) { return r.map(function (v) { return typeof v === 'string' ? D.dmy(v) : v; }); })))); ws['!cols'] = h.map(function (x) { return { wch: Math.max(11, String(x).length + 2) }; }); return ws; };
      var wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, sheet(r.headers, r.rows), 'Material Handover');
      if (r.history) XLSX.utils.book_append_sheet(wb, sheet(r.historyHeaders, r.history), 'History');
      XLSX.utils.book_append_sheet(wb, D.fixDates(XLSX.utils.aoa_to_sheet([['Report', 'Material Handover'], ['Generated', D.now()], ['Project', f.project || 'All'], ['Week', f.week || 'All'],
        ['Handover date from', D.dmy(f.from) || '-'], ['Handover date to', D.dmy(f.to) || '-'], ['Spools', r.rows.length], ['Note', 'The date filter matches the Handover Date. Spools never handed over have no date and appear only when no dates are set.']])), 'Report info');
      XLSX.writeFile(wb, 'material-handover-' + D.dmy(today()) + '.xlsx');
      msg.textContent = r.rows.length + ' spools downloaded.'; msg.className = 'cp-note cp-ok';
    }).catch(function (e) { done(); msg.textContent = 'Could not prepare the report: ' + e.message; msg.className = 'cp-note cp-bad'; });
  };
})();
