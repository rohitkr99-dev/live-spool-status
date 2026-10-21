/*
 * cutting-status.js - "Cutting & Beveling Status" section of the Cutting Station page.
 * Lists the cutting plans saved to Drive, lets the user tick Cutting done / Beveling done per piece (or per pipe),
 * saves only the changed boxes to the master Google Sheet (through the Drive script, with the user's site login),
 * and downloads a report as Excel. Helpers (api, esc, toast) come from cutting-plan.js via window.CutStation.
 */
(function () {
  'use strict';
  var CS = window.CutStation;
  if (!CS) return;
  var $ = CS.el, esc = CS.esc, api = CS.api, toast = CS.toast, D = CS.D;

  var plans = [];            // plans saved to Drive
  var cur = null;            // the open plan: { rec, base, state } (base = what is saved, state = what the boxes show now)
  var weekIdx = null, weekLoading = false;

  var today = D.todayIso;
  var nk = function (s) { return String(s == null ? '' : s).trim().toLowerCase(); };
  var pid = function (rec, b, j) { return rec.planNo + '|' + b.barcode + '|' + (j + 1); };

  /* ---------- tracker's published spool data: downloaded once (large), shared with the Material Handover section ---------- */
  var spoolsPromise = null;
  CS.spools = function () {
    if (spoolsPromise) return spoolsPromise;
    if (typeof SPOOL_STATUS_CONFIG === 'undefined') return Promise.reject(new Error('The tracker data is not available on this page.'));
    spoolsPromise = fetch(SPOOL_STATUS_CONFIG.publishedDataUrl).then(function (r) { return r.json(); }).then(function (d) {
      return (d.master_spools || []).map(function (s) {
        return { project: s['Project Code'], projectName: s['Project Name'], drawing: s['Drawing No'], spool: s['Spool No'], week: s.Week || '', group: s.Group || '', oldHandover: s['Material Handover'] || '' };
      });
    });
    spoolsPromise.catch(function () { spoolsPromise = null; });
    return spoolsPromise;
  };
  /* Week lookup (Project + Drawing + Spool, falling back to Project + Spool) */
  function loadWeekIdx() {
    if (weekIdx || weekLoading) return;
    weekLoading = true;
    CS.spools().then(function (list) {
      var full = {}, ps = {};
      list.forEach(function (s) {
        if (!s.week) return;
        var proj = nk(s.project), sp = nk(s.spool);
        full[proj + '|' + nk(s.drawing) + '|' + sp] = s.week; ps[proj + '|' + sp] = s.week;
      });
      weekIdx = { full: full, ps: ps };
    }).catch(function () { weekIdx = { full: {}, ps: {} }; });
  }
  function weekOf(p) {
    if (!weekIdx) return '';
    var proj = nk(p.project), sp = nk(p.spool);
    return weekIdx.full[proj + '|' + nk(p.drawing) + '|' + sp] || weekIdx.ps[proj + '|' + sp] || '';
  }

  /* ---------- sections: Cutting Plan / Cutting & Beveling Status / Material Handover ---------- */
  var curSec = 'plan';
  CS.dirtyFns = [function () { return changes().length > 0; }];
  CS.sectionHooks = { status: function () { if (!plans.length) loadPlans(); loadReleased(); } };
  function section(name) {
    if (name === curSec) return;
    if (CS.dirtyFns.some(function (f) { return f(); }) && !confirm('You have unsaved ticks. Leave without saving?')) return;
    curSec = name;
    ['plan', 'status', 'handover'].forEach(function (n) {
      var cap = n.charAt(0).toUpperCase() + n.slice(1);
      $('sec' + cap).hidden = n !== name; $('secBtn' + cap).className = 'btn ' + (n === name ? 'btn--primary' : 'btn--ghost');
    });
    if (CS.sectionHooks[name]) CS.sectionHooks[name]();
  }
  $('secBtnPlan').onclick = function () { section('plan'); };
  $('secBtnStatus').onclick = function () { section('status'); };
  $('secBtnHandover').onclick = function () { section('handover'); };

  /* ---------- plan list ---------- */
  function loadPlans() {
    $('stListNote').textContent = 'Loading plans from Drive...'; $('stListNote').className = 'cp-note';
    api('listPlans').then(function (r) { plans = r.plans; renderPlans(); fillProjects(); })
      .catch(function (e) { $('stListNote').textContent = 'Could not load the plans: ' + e.message; $('stListNote').className = 'cp-note cp-bad'; });
  }
  function renderPlans() {
    var q = nk($('stSearch').value), rows = plans.filter(function (p) { return !q || nk(p.planNo).indexOf(q) >= 0 || nk(p.project).indexOf(q) >= 0; });
    $('stPlans').innerHTML = rows.length ? '<tr><th>Plan No.</th><th>Project</th><th>Plan date</th><th class="n">Pipes</th><th class="n">Pieces</th><th>Saved</th><th></th></tr>' + rows.slice(0, 60).map(function (p, i) {
      return '<tr><td><b>' + esc(p.planNo) + '</b></td><td>' + esc(p.project) + '</td><td>' + esc(D.dmy(p.date)) + '</td><td class="n">' + p.pipes + '</td><td class="n">' + p.pieces + '</td><td>' + esc(D.dmy(p.savedAt)) + '</td><td><button class="btn btn--primary" type="button" data-open="' + esc(p.planNo) + '">Open</button></td></tr>';
    }).join('') : '';
    $('stListNote').className = 'cp-note';
    $('stListNote').textContent = plans.length ? (rows.length > 60 ? 'Showing the newest 60 of ' + rows.length + ' matching plans. Type in the search box to narrow down.' : rows.length + ' plan' + (rows.length === 1 ? '' : 's')) :
      'No plans have been saved to Drive yet. Create a plan, accept it, and use Save to Drive in the Cutting Plan section.';
    Array.prototype.forEach.call($('stPlans').querySelectorAll('[data-open]'), function (b) { b.onclick = function () { openPlan(b.dataset.open); }; });
  }
  $('stSearch').addEventListener('input', renderPlans);
  $('stRefresh').onclick = function () { if (!changes().length || confirm('Discard unsaved ticks?')) { loadPlans(); } };

  /* ---------- open a plan ---------- */
  function openPlan(planNo) {
    if (changes().length && !confirm('Discard unsaved ticks in the open plan?')) return;
    $('stListNote').textContent = 'Opening ' + planNo + '...'; $('stListNote').className = 'cp-note';
    loadWeekIdx();
    api('openPlan', { planNo: planNo }).then(function (r) { setPlan(r.rec, r.status, r.released); })
      .catch(function (e) { $('stListNote').textContent = 'Could not open the plan: ' + e.message; $('stListNote').className = 'cp-note cp-bad'; toast(false, 'Could not open the plan: ' + e.message); });
  }
  function setPlan(rec, status, released) {
    var base = {}, state = {};
    rec.bars.forEach(function (b) {
      b.pieces.forEach(function (p, j) {
        var id = pid(rec, b, j), s = status[id] || {};
        base[id] = { cut: !!s.cut, cutDate: s.cut ? D.iso(s.cutDate) : '', bevel: !!s.bevel, bevelDate: s.bevel ? D.iso(s.bevelDate) : '' };
        state[id] = Object.assign({}, base[id]);
      });
    });
    cur = { rec: rec, base: base, state: state, released: released || {} };
    $('stPickBox').hidden = true; $('stRelBox').hidden = true; $('stView').hidden = false;
    renderPlan();
    window.scrollTo(0, 0);
  }
  $('stBack').onclick = function () {
    if (changes().length && !confirm('Discard unsaved ticks?')) return;
    cur = null; $('stView').hidden = true; $('stPickBox').hidden = false; $('stRelBox').hidden = false; loadReleased(); $('stListNote').textContent = ''; renderPlans();
  };

  /* ---------- ticking ---------- */
  function changes() {
    var out = [];
    if (!cur) return out;
    cur.rec.bars.forEach(function (b) {
      b.pieces.forEach(function (p, j) {
        var id = pid(cur.rec, b, j), s = cur.state[id], o = cur.base[id];
        ['cut', 'bevel'].forEach(function (k) {
          if (s[k] !== o[k] || (s[k] && s[k + 'Date'] !== o[k + 'Date'])) out.push({ id: id, kind: k, done: s[k], date: s[k] ? s[k + 'Date'] : '', bar: b, piece: p });
        });
      });
    });
    return out;
  }
  function setBox(id, kind, on) {
    var s = cur.state[id];
    s[kind] = on;
    if (on) { if (!s[kind + 'Date']) s[kind + 'Date'] = today(); } else s[kind + 'Date'] = '';
  }
  function barIndexOf(id) { var n = -1; cur.rec.bars.forEach(function (b, i) { if (id.indexOf(cur.rec.planNo + '|' + b.barcode + '|') === 0) n = i; }); return n; }

  function onChange(e) {
    var t = e.target;
    if (t.dataset.all) {                                   // pipe-level box: tick or untick every piece of this pipe
      var i = +t.dataset.bar;
      cur.rec.bars[i].pieces.forEach(function (p, j) { var id = pid(cur.rec, cur.rec.bars[i], j); if (!cur.released[id]) setBox(id, t.dataset.all, t.checked); });
      refreshBar(i);
    } else if (t.dataset.k && t.type === 'checkbox') {      // single piece box
      setBox(t.dataset.id, t.dataset.k, t.checked); refreshBar(barIndexOf(t.dataset.id));
    } else if (t.dataset.k && t.classList.contains('cp-date')) {   // editable date, typed as DD-MM-YYYY
      var s = cur.state[t.dataset.id], iso = D.iso(t.value);
      if (iso || !t.value.trim()) s[t.dataset.k] = iso || today(); else toast(false, 'Type the date as DD-MM-YYYY, for example ' + D.dmy(today()) + '.');
      refreshBar(barIndexOf(t.dataset.id));
    }
    updateBar();
  }
  $('stBars').addEventListener('change', onChange);
  $('stHead').addEventListener('change', function (e) {   // plan-level box: tick or untick every piece of every pipe
    var k = e.target.id === 'stAllCut' ? 'cut' : e.target.id === 'stAllBevel' ? 'bevel' : '';
    if (!k) return;
    cur.rec.bars.forEach(function (b, i) { b.pieces.forEach(function (p, j) { var id = pid(cur.rec, b, j); if (!cur.released[id]) setBox(id, k, e.target.checked); }); refreshBar(i); });
    updateBar();
  });

  /* ---------- rendering ---------- */
  function renderPlan() {
    var r = cur.rec, pieces = 0;
    r.bars.forEach(function (b) { pieces += b.pieces.length; });
    $('stHead').innerHTML = '<div class="cp-card__head"><h3>Plan ' + esc(r.planNo) + '</h3><span class="cp-hint">Project ' + esc(r.project || '-') + ' &middot; plan date ' + esc(D.dmy(r.date)) + ' &middot; ' + r.bars.length + ' pipes &middot; ' + pieces + ' pieces</span></div>' +
      '<div class="cp-row" style="margin-top:0"><button class="btn btn--ghost" id="stBack2" type="button">&larr; All plans</button><button class="btn btn--ghost" id="stPdf" type="button">Download plan (PDF)</button><span id="stProgress" class="cp-note" style="margin:0"></span></div>' +
      '<div class="cp-row"><b>Whole plan:</b> <label class="cp-allbox"><input type="checkbox" id="stAllCut"> Cutting: all pipes</label> <label class="cp-allbox"><input type="checkbox" id="stAllBevel"> Beveling: all pipes</label></div>' +
      '<p class="cp-note">Tick <b>Cutting</b> and <b>Beveling</b> for each piece, or use the boxes at the top of a pipe (or <b>Whole plan</b>) to tick many at once. If a piece cannot be cut, use <b>Release</b> on its row. Dates start as today and can be changed. Nothing is saved until you press <b>Save changes</b>.</p>';
    $('stBack2').onclick = $('stBack').onclick;
    $('stPdf').onclick = function () { var n = Object.keys(cur.released).length; CS.pdfFor(cur.rec, cur.released).save('cutting-plan-' + cur.rec.planNo.replace(/[^\w-]+/g, '_') + (n ? '-revised' : '') + '.pdf'); };
    $('stBars').innerHTML = r.bars.map(function (b, i) { return '<div class="cp-card cp-bar" id="stBar' + i + '"></div>'; }).join('');
    r.bars.forEach(function (b, i) { refreshBar(i); });
    updateBar();
  }
  function barHtml(i) {
    var r = cur.rec, b = r.bars[i], R = cur.released, n = 0, cut = 0, bev = 0, ret = 0;
    b.pieces.forEach(function (p, j) { var id = pid(r, b, j), s = cur.state[id]; if (R[id]) { ret += Number(R[id].returned) || 0; return; } n++; if (s.cut) cut++; if (s.bevel) bev++; });
    var all = function (k, c) { return '<label class="cp-allbox"><input type="checkbox" data-all="' + k + '" data-bar="' + i + '"' + (n && c === n ? ' checked' : '') + (c > 0 && c < n ? ' data-partial="1"' : '') + '> ' + (k === 'cut' ? 'Cutting' : 'Beveling') + ': all <small>(' + c + '/' + n + ')</small></label>'; };
    var rows = b.pieces.map(function (p, j) {
      var id = pid(r, b, j), s = cur.state[id], o = cur.base[id], x = R[id];
      var head = '<tr' + (x ? ' class="cp-rel"' : '') + '><td>' + (j + 1) + '</td><td>' + esc(p.project) + '</td><td>' + esc(p.drawing) + '</td><td>' + esc(p.spool) + '</td><td>' + esc(p.group) + '</td><td>' + esc(p.bevel) + '</td><td class="n">' + p.length + '</td>';
      if (x) return head + '<td colspan="3" class="cp-relcell"><b class="cp-bad">RELEASED</b> ' + esc(x.reason) + (x.remark ? ' - ' + esc(x.remark) : '') + ' <small>(' + esc(D.dmy(x.at)) + ', ' + esc(x.by) + '; ' + (Number(x.returned) ? x.returned + ' mm back to the pipe' : 'scrap') + ')</small> <button class="btn btn--ghost" data-unrel="' + esc(id) + '" type="button">Undo release</button></td></tr>';
      var cell = function (k) {
        var dirty = s[k] !== o[k] || (s[k] && s[k + 'Date'] !== o[k + 'Date']);
        return '<td class="cp-tick' + (dirty ? ' cp-dirty' : '') + '"><input type="checkbox" data-id="' + esc(id) + '" data-k="' + k + '"' + (s[k] ? ' checked' : '') + ' aria-label="' + (k === 'cut' ? 'Cutting' : 'Beveling') + ' done, piece ' + (j + 1) + '">' +
          (s[k] ? ' <input type="text" class="cp-date" size="10" maxlength="10" placeholder="DD-MM-YYYY" data-id="' + esc(id) + '" data-k="' + k + 'Date" value="' + esc(D.dmy(s[k + 'Date'])) + '">' : '') + '</td>';
      };
      return head + cell('cut') + cell('bevel') + '<td><button class="btn btn--ghost" data-rel="' + i + ',' + j + '" type="button"' + (s.cut || s.bevel ? ' disabled title="Untick cutting and beveling first"' : '') + '>Release</button></td></tr>';
    }).join('');
    return '<div class="cp-barhd"><h3>B' + String(i + 1).padStart(2, '0') + ' &nbsp; ' + esc(b.item) + ' / ' + esc(b.control) + ' / ' + esc(String(b.barcode).slice(-6)) + '</h3><small>Barcode ' + esc(b.barcode) + '</small><small>Heat ' + esc(b.heat) + '</small>' +
      '<small>Remain <b>' + (b.remain + ret) + '</b>' + (ret ? ' <span class="cp-warn">(planned ' + b.remain + ', +' + ret + ' returned)</span>' : '') + '</small>' +
      all('cut', cut) + all('bevel', bev) + '</div><div class="cp-tw"><table class="cp-sttbl"><tr><th>#</th><th>Project</th><th>Drawing No.</th><th>Spool No.</th><th>Group</th><th>Bevel</th><th class="n">Length</th><th>Cutting done</th><th>Beveling done</th><th>Release</th></tr>' + rows + '</table></div>';
  }
  function refreshBar(i) {
    var el = $('stBar' + i);
    if (!el || i < 0) return;
    el.innerHTML = barHtml(i);
    Array.prototype.forEach.call(el.querySelectorAll('[data-partial]'), function (c) { c.indeterminate = true; });
  }
  function updateBar() {
    var n = changes().length, bar = $('stSaveBar');
    bar.hidden = n === 0;
    $('stDirty').textContent = n + ' unsaved change' + (n === 1 ? '' : 's');
    var cut = 0, bev = 0, tot = 0, rel = 0;
    cur && cur.rec.bars.forEach(function (b, i) { b.pieces.forEach(function (p, j) { var id = pid(cur.rec, b, j), s = cur.state[id]; if (cur.released[id]) { rel++; return; } tot++; if (s.cut) cut++; if (s.bevel) bev++; }); });
    [['stAllCut', cut], ['stAllBevel', bev]].forEach(function (x) { var c = $(x[0]); if (c) { c.checked = tot > 0 && x[1] === tot; c.indeterminate = x[1] > 0 && x[1] < tot; } });
    if ($('stProgress')) $('stProgress').textContent = 'Cutting done ' + cut + ' of ' + tot + ' pieces  |  Beveling done ' + bev + ' of ' + tot + (rel ? '  |  Released ' + rel : '');
  }

  /* ---------- release a piece that cannot be cut ---------- */
  var rel = null, dlg = $('relDlg');
  var barNow = function () { var b = cur.rec.bars[rel.i], ret = 0; b.pieces.forEach(function (p, j) { var x = cur.released[pid(cur.rec, b, j)]; if (x) ret += Number(x.returned) || 0; }); return b.remain + ret; };
  function relRemain() {
    var back = +$('relRet').value || 0;
    $('relRemain').textContent = 'Pipe remain: ' + barNow() + ' mm now, ' + (barNow() + back) + ' mm after this release.';
  }
  $('stBars').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.dataset.rel) {
      if (changes().length) return toast(false, 'Save or discard your unsaved ticks first, then release the piece.');
      var ij = b.dataset.rel.split(','), i = +ij[0], j = +ij[1], p = cur.rec.bars[i].pieces[j];
      rel = { i: i, j: j, id: pid(cur.rec, cur.rec.bars[i], j), full: p.length + (+cur.rec.kerf || 0) };
      $('relWhat').innerHTML = 'Pipe B' + String(i + 1).padStart(2, '0') + ' piece ' + (j + 1) + ': <b>' + esc(p.drawing) + ' / ' + esc(p.spool) + '</b>, length ' + p.length + ' mm.';
      $('relReason').value = ''; $('relRemark').value = ''; $('relBack').checked = true; $('relRet').disabled = false; $('relRet').value = rel.full; relRemain(); dlg.showModal();
    } else if (b.dataset.unrel) {
      if (changes().length) return toast(false, 'Save or discard your unsaved ticks first.');
      if (!confirm('Undo this release? The piece is planned for cutting again and the length goes back to the plan.')) return;
      api('undoRelease', { id: b.dataset.unrel }).then(function () { toast(true, 'Release undone.'); return reopen(); }).catch(function (er) { toast(false, 'NOT saved: ' + er.message); });
    }
  });
  $('relBack').onchange = $('relScrap').onchange = function () { $('relRet').disabled = $('relScrap').checked; $('relRet').value = $('relScrap').checked ? 0 : rel.full; relRemain(); };
  $('relRet').oninput = relRemain;
  $('relCancel').onclick = function () { dlg.close(); };
  function reopen() { var no = cur.rec.planNo; return api('openPlan', { planNo: no }).then(function (r) { setPlan(r.rec, r.status, r.released); }); }
  $('relOk').onclick = function () {
    var reason = $('relReason').value, btn = $('relOk');
    if (!reason) return toast(false, 'Choose a reason.');
    var b = cur.rec.bars[rel.i], p = b.pieces[rel.j];
    btn.disabled = true; btn.textContent = 'Saving...';
    api('releasePiece', { id: rel.id, planNo: cur.rec.planNo, reason: reason, remark: $('relRemark').value.trim(), plannedRemain: b.remain, returned: $('relScrap').checked ? 0 : (+$('relRet').value || 0),
      piece: { barcode: b.barcode, control: b.control, heat: b.heat, item: b.item, project: p.project, drawing: p.drawing, spool: p.spool, length: p.length, group: p.group, bevel: p.bevel } }).then(function () {
      dlg.close(); toast(true, 'Piece released. It is listed under Released pieces for re-planning.'); return reopen();
    }).catch(function (er) { toast(false, 'NOT saved: ' + er.message); }).then(function () { btn.disabled = false; btn.textContent = 'Release piece'; });
  };

  /* ---------- released pieces list (to re-plan) ---------- */
  var relRows = [], relHead = [];
  var rv = function (r, name) { return r[relHead.indexOf(name)]; };
  function loadReleased() {
    api('getReleases').then(function (r) { relHead = r.headers; relRows = r.rows; renderReleased(); })
      .catch(function (e) { $('stRelNote').textContent = 'Could not load released pieces: ' + e.message; $('stRelNote').className = 'cp-note cp-bad'; });
  }
  function relShown() { var q = nk($('stRelQ').value); return relRows.filter(function (r) { return !q || [rv(r, 'Plan No'), rv(r, 'Drawing No.'), rv(r, 'Spool No.')].some(function (v) { return nk(v).indexOf(q) >= 0; }); }); }
  function renderReleased() {
    var rows = relShown();
    $('stRelTbl').innerHTML = rows.length ? '<tr><th>Project</th><th>Drawing No.</th><th>Spool No.</th><th>Item Code</th><th class="n">Length</th><th>Group</th><th>Bevel</th><th>Plan No.</th><th>Reason</th><th>Released</th></tr>' + rows.slice(0, 100).map(function (r) {
      return '<tr><td>' + esc(rv(r, 'Project')) + '</td><td>' + esc(rv(r, 'Drawing No.')) + '</td><td>' + esc(rv(r, 'Spool No.')) + '</td><td>' + esc(rv(r, 'Item Code')) + '</td><td class="n">' + esc(rv(r, 'Length')) + '</td><td>' + esc(rv(r, 'Group')) + '</td><td>' + esc(rv(r, 'Bevel')) + '</td><td>' + esc(rv(r, 'Plan No')) + '</td><td>' + esc(rv(r, 'Reason')) + '</td><td>' + esc(D.dmy(rv(r, 'Released At')).slice(0, 10)) + '</td></tr>';
    }).join('') : '';
    $('stRelNote').className = 'cp-note';
    $('stRelNote').textContent = relRows.length ? rows.length + ' released piece' + (rows.length === 1 ? '' : 's') + (rows.length > 100 ? ' (first 100 shown; the Excel has all)' : '') : 'No released pieces.';
  }
  $('stRelQ').addEventListener('input', renderReleased);
  $('stRelXl').onclick = function () {
    var rows = relShown(); if (!rows.length) return toast(false, 'No released pieces to download.');
    var xs = function (aoa) { return D.fixDates(XLSX.utils.aoa_to_sheet(aoa.map(function (r) { return r.map(function (v) { return typeof v === 'string' ? D.dmy(v) : v; }); }))); };
    var num = function (v) { return v !== '' && !isNaN(v) ? Number(v) : v; };
    var cutList = [['Project', 'Drawing No.', 'Spool No.', 'Item Code', 'Length', 'Group', 'Bevel']], spools = [['Project Code', 'Drawing No.', 'Spool No', 'Item Code', 'Length', 'Group', 'Bevel', 'OLD CUTTING PLAN', 'STATUS', 'Reason', 'Released on']];
    rows.forEach(function (r) {
      cutList.push([rv(r, 'Project'), rv(r, 'Drawing No.'), rv(r, 'Spool No.'), rv(r, 'Item Code'), num(rv(r, 'Length')), rv(r, 'Group'), rv(r, 'Bevel')]);
      spools.push([rv(r, 'Project'), rv(r, 'Drawing No.'), rv(r, 'Spool No.'), rv(r, 'Item Code'), num(rv(r, 'Length')), rv(r, 'Group'), rv(r, 'Bevel'), rv(r, 'Plan No'), 'RELEASED - TO RE-PLAN', rv(r, 'Reason'), D.dmy(rv(r, 'Released At')).slice(0, 10)]);
    });
    var pipes = {}, order = [];
    relRows.forEach(function (r) {          // pipe totals use every active release of that pipe, not only the filtered ones
      var k = rv(r, 'Plan No') + '|' + rv(r, 'Pipe Barcode'), o = pipes[k];
      if (!o) { o = pipes[k] = { plan: rv(r, 'Plan No'), barcode: rv(r, 'Pipe Barcode'), item: rv(r, 'Item Code'), control: rv(r, 'Control No'), heat: rv(r, 'Heat No'), planned: Number(rv(r, 'Pipe Planned Remain')) || 0, back: 0, shown: false }; order.push(k); }
      o.back += Number(rv(r, 'Returned To Pipe')) || 0;
    });
    rows.forEach(function (r) { pipes[rv(r, 'Plan No') + '|' + rv(r, 'Pipe Barcode')].shown = true; });
    var pipeRows = [['Barcode', 'Item Code', 'Control No', 'Heat No', 'C.PLAN NO.', 'Remain in plan', 'Returned to pipe', 'REMAIN NOW']];
    order.forEach(function (k) { var o = pipes[k]; if (o.shown) pipeRows.push([o.barcode, o.item, o.control, o.heat, o.plan, o.planned, o.back, o.planned + o.back]); });
    var wb = XLSX.utils.book_new();
    [['Re-plan cut list', cutList], ['Master - spools', spools], ['Master - pipes', pipeRows]].forEach(function (x) { XLSX.utils.book_append_sheet(wb, xs(x[1]), x[0]); });
    XLSX.writeFile(wb, 'released-pieces-' + D.dmy(today()) + '.xlsx');
  };

  /* ---------- save ---------- */
  $('stDiscard').onclick = function () { if (!cur) return; cur.rec.bars.forEach(function (b, i) { b.pieces.forEach(function (p, j) { var id = pid(cur.rec, b, j); cur.state[id] = Object.assign({}, cur.base[id]); }); }); renderPlan(); };
  $('stSave').onclick = function () {
    var ch = changes();
    if (!ch.length) return;
    var pieces = {}, payload = ch.map(function (c) {
      pieces[c.id] = { planNo: cur.rec.planNo, barcode: c.bar.barcode, control: c.bar.control, heat: c.bar.heat, project: c.piece.project, drawing: c.piece.drawing, spool: c.piece.spool,
        item: c.bar.item || c.piece.item, length: c.piece.length, group: c.piece.group, bevel: c.piece.bevel, week: weekOf(c.piece) };
      return { id: c.id, kind: c.kind, done: c.done, date: c.date };
    });
    var btn = $('stSave'); btn.disabled = true; btn.textContent = 'Saving...';
    var planNo = cur.rec.planNo;
    api('saveCut', { pieces: pieces, changes: payload }).then(function (r) {
      toast(true, 'Saved: ' + r.changed + ' change' + (r.changed === 1 ? '' : 's') + ' in plan ' + planNo + '.');
      return api('openPlan', { planNo: planNo });
    }).then(function (r) { btn.disabled = false; btn.textContent = 'Save changes'; setPlan(r.rec, r.status, r.released); })
      .catch(function (e) { btn.disabled = false; btn.textContent = 'Save changes'; toast(false, 'NOT saved: ' + e.message); });
  };
  window.addEventListener('beforeunload', function (e) { if (changes().length) { e.preventDefault(); e.returnValue = ''; } });

  /* ---------- report (Excel built here from the master's data) ---------- */
  function fillProjects() {
    var seen = {}, opts = '<option value="">All projects</option>';
    plans.forEach(function (p) { if (p.project && !seen[p.project]) { seen[p.project] = 1; opts += '<option value="' + esc(p.project) + '">' + esc(p.project) + '</option>'; } });
    var cur_ = $('rpProject').value; $('rpProject').innerHTML = opts; $('rpProject').value = cur_;
  }
  function sheetFrom(headers, rows) {
    var ws = D.fixDates(XLSX.utils.aoa_to_sheet([headers].concat(rows.map(function (r) { return r.map(function (v) { return typeof v === 'string' ? D.dmy(v) : v; }); }))));
    ws['!cols'] = headers.map(function (h) { return { wch: Math.max(10, String(h).length + 2) }; });
    return ws;
  }
  $('rpDownload').onclick = function () {
    var btn = $('rpDownload'), msg = $('rpMsg');
    var f = { project: $('rpProject').value, week: $('rpWeek').value.trim(), from: D.field('rpFrom'), to: D.field('rpTo') };
    if (f.from === null || f.to === null) { msg.textContent = 'Type the dates as DD-MM-YYYY, for example ' + D.dmy(today()) + '.'; msg.className = 'cp-note cp-bad'; return; }
    btn.disabled = true; btn.textContent = 'Preparing...'; msg.textContent = ''; msg.className = 'cp-note';
    api('getReport', { type: 'cut', project: f.project, week: f.week, from: f.from, to: f.to, history: $('rpHist').checked }).then(function (r) {
      btn.disabled = false; btn.textContent = 'Download report (Excel)';
      if (!r.rows.length) { msg.textContent = 'No pieces match these filters.'; msg.className = 'cp-note cp-warn'; return; }
      var li = r.headers.indexOf('Length');
      var rows = r.rows.map(function (row) { return row.map(function (v, i) { return i === li && v !== '' && !isNaN(v) ? Number(v) : v; }); });
      var wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, sheetFrom(r.headers, rows), 'Cutting & Beveling Status');
      if (r.released && r.released.length) XLSX.utils.book_append_sheet(wb, sheetFrom(r.releasedHeaders, r.released), 'Released pieces');
      if (r.history) XLSX.utils.book_append_sheet(wb, sheetFrom(r.historyHeaders, r.history), 'History');
      XLSX.utils.book_append_sheet(wb, D.fixDates(XLSX.utils.aoa_to_sheet([['Report', 'Cutting and Beveling Status'], ['Generated', D.now()], ['Project', f.project || 'All'], ['Week', f.week || 'All'],
        ['Date from', D.dmy(f.from) || '-'], ['Date to', D.dmy(f.to) || '-'], ['Pieces', rows.length], ['Note', 'Date filter matches pieces whose Cutting Date or Beveling Date is in the range.']])), 'Report info');
      XLSX.writeFile(wb, 'cutting-beveling-status-' + D.dmy(today()) + '.xlsx');
      msg.textContent = rows.length + ' pieces downloaded.'; msg.className = 'cp-note cp-ok';
    }).catch(function (e) { btn.disabled = false; btn.textContent = 'Download report (Excel)'; msg.textContent = 'Could not prepare the report: ' + e.message; msg.className = 'cp-note cp-bad'; });
  };
})();
