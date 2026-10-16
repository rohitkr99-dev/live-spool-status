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
  var $ = CS.el, esc = CS.esc, api = CS.api, toast = CS.toast;

  var plans = [];            // plans saved to Drive
  var cur = null;            // the open plan: { rec, base, state } (base = what is saved, state = what the boxes show now)
  var weekIdx = null, weekLoading = false;

  var today = function () { return new Date().toISOString().slice(0, 10); };
  var nk = function (s) { return String(s == null ? '' : s).trim().toLowerCase(); };
  var pid = function (rec, b, j) { return rec.planNo + '|' + b.barcode + '|' + (j + 1); };

  /* ---------- Week lookup from the tracker's published spool data (loaded once, only when a plan is opened) ---------- */
  function loadWeekIdx() {
    if (weekIdx || weekLoading || typeof SPOOL_STATUS_CONFIG === 'undefined') return;
    weekLoading = true;
    fetch(SPOOL_STATUS_CONFIG.publishedDataUrl).then(function (r) { return r.json(); }).then(function (d) {
      var full = {}, ps = {};
      (d.master_spools || []).forEach(function (s) {
        if (!s.Week) return;
        var proj = nk(s['Project Code']), sp = nk(s['Spool No']);
        full[proj + '|' + nk(s['Drawing No']) + '|' + sp] = s.Week; ps[proj + '|' + sp] = s.Week;
      });
      weekIdx = { full: full, ps: ps };
    }).catch(function () { weekIdx = { full: {}, ps: {} }; });
  }
  function weekOf(p) {
    if (!weekIdx) return '';
    var proj = nk(p.project), sp = nk(p.spool);
    return weekIdx.full[proj + '|' + nk(p.drawing) + '|' + sp] || weekIdx.ps[proj + '|' + sp] || '';
  }

  /* ---------- section switch (Cutting Plan <-> Cutting & Beveling Status) ---------- */
  function section(name) {
    if (name !== 'status' && changes().length && !confirm('You have unsaved ticks in Cutting & Beveling Status. Leave without saving?')) return;
    $('secPlan').hidden = name !== 'plan'; $('secStatus').hidden = name !== 'status';
    $('secBtnPlan').className = 'btn ' + (name === 'plan' ? 'btn--primary' : 'btn--ghost');
    $('secBtnStatus').className = 'btn ' + (name === 'status' ? 'btn--primary' : 'btn--ghost');
    if (name === 'status' && !plans.length) loadPlans();
  }
  $('secBtnPlan').onclick = function () { section('plan'); };
  $('secBtnStatus').onclick = function () { section('status'); };

  /* ---------- plan list ---------- */
  function loadPlans() {
    $('stListNote').textContent = 'Loading plans from Drive...'; $('stListNote').className = 'cp-note';
    api('listPlans').then(function (r) { plans = r.plans; renderPlans(); fillProjects(); })
      .catch(function (e) { $('stListNote').textContent = 'Could not load the plans: ' + e.message; $('stListNote').className = 'cp-note cp-bad'; });
  }
  function renderPlans() {
    var q = nk($('stSearch').value), rows = plans.filter(function (p) { return !q || nk(p.planNo).indexOf(q) >= 0 || nk(p.project).indexOf(q) >= 0; });
    $('stPlans').innerHTML = rows.length ? '<tr><th>Plan No.</th><th>Project</th><th>Plan date</th><th class="n">Pipes</th><th class="n">Pieces</th><th>Saved</th><th></th></tr>' + rows.slice(0, 60).map(function (p, i) {
      return '<tr><td><b>' + esc(p.planNo) + '</b></td><td>' + esc(p.project) + '</td><td>' + esc(p.date) + '</td><td class="n">' + p.pipes + '</td><td class="n">' + p.pieces + '</td><td>' + esc(p.savedAt) + '</td><td><button class="btn btn--primary" type="button" data-open="' + esc(p.planNo) + '">Open</button></td></tr>';
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
    api('openPlan', { planNo: planNo }).then(function (r) { setPlan(r.rec, r.status); })
      .catch(function (e) { $('stListNote').textContent = 'Could not open the plan: ' + e.message; $('stListNote').className = 'cp-note cp-bad'; toast(false, 'Could not open the plan: ' + e.message); });
  }
  function setPlan(rec, status) {
    var base = {}, state = {};
    rec.bars.forEach(function (b) {
      b.pieces.forEach(function (p, j) {
        var id = pid(rec, b, j), s = status[id] || {};
        base[id] = { cut: !!s.cut, cutDate: s.cut ? s.cutDate || '' : '', bevel: !!s.bevel, bevelDate: s.bevel ? s.bevelDate || '' : '' };
        state[id] = Object.assign({}, base[id]);
      });
    });
    cur = { rec: rec, base: base, state: state };
    $('stPickBox').hidden = true; $('stView').hidden = false;
    renderPlan();
    window.scrollTo(0, 0);
  }
  $('stBack').onclick = function () {
    if (changes().length && !confirm('Discard unsaved ticks?')) return;
    cur = null; $('stView').hidden = true; $('stPickBox').hidden = false; $('stListNote').textContent = ''; renderPlans();
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
      cur.rec.bars[i].pieces.forEach(function (p, j) { setBox(pid(cur.rec, cur.rec.bars[i], j), t.dataset.all, t.checked); });
      refreshBar(i);
    } else if (t.dataset.k && t.type === 'checkbox') {      // single piece box
      setBox(t.dataset.id, t.dataset.k, t.checked); refreshBar(barIndexOf(t.dataset.id));
    } else if (t.dataset.k && t.type === 'date') {          // editable date
      var s = cur.state[t.dataset.id], k = t.dataset.k.replace('Date', '');
      s[t.dataset.k] = t.value || today(); refreshBar(barIndexOf(t.dataset.id));
    }
    updateBar();
  }
  $('stBars').addEventListener('change', onChange);

  /* ---------- rendering ---------- */
  function renderPlan() {
    var r = cur.rec, pieces = 0;
    r.bars.forEach(function (b) { pieces += b.pieces.length; });
    $('stHead').innerHTML = '<div class="cp-card__head"><h3>Plan ' + esc(r.planNo) + '</h3><span class="cp-hint">Project ' + esc(r.project || '-') + ' &middot; plan date ' + esc(r.date) + ' &middot; ' + r.bars.length + ' pipes &middot; ' + pieces + ' pieces</span></div>' +
      '<div class="cp-row" style="margin-top:0"><button class="btn btn--ghost" id="stBack2" type="button">&larr; All plans</button><span id="stProgress" class="cp-note" style="margin:0"></span></div>' +
      '<p class="cp-note">Tick <b>Cutting</b> and <b>Beveling</b> for each piece, or use the boxes at the top of a pipe to tick all its pieces. Dates start as today and can be changed. Nothing is saved until you press <b>Save changes</b>.</p>';
    $('stBack2').onclick = $('stBack').onclick;
    $('stBars').innerHTML = r.bars.map(function (b, i) { return '<div class="cp-card cp-bar" id="stBar' + i + '"></div>'; }).join('');
    r.bars.forEach(function (b, i) { refreshBar(i); });
    updateBar();
  }
  function barHtml(i) {
    var r = cur.rec, b = r.bars[i], n = b.pieces.length, cut = 0, bev = 0;
    b.pieces.forEach(function (p, j) { var s = cur.state[pid(r, b, j)]; if (s.cut) cut++; if (s.bevel) bev++; });
    var all = function (k, c) { return '<label class="cp-allbox"><input type="checkbox" data-all="' + k + '" data-bar="' + i + '"' + (c === n ? ' checked' : '') + (c > 0 && c < n ? ' data-partial="1"' : '') + '> ' + (k === 'cut' ? 'Cutting' : 'Beveling') + ': all <small>(' + c + '/' + n + ')</small></label>'; };
    var rows = b.pieces.map(function (p, j) {
      var id = pid(r, b, j), s = cur.state[id], o = cur.base[id];
      var cell = function (k) {
        var dirty = s[k] !== o[k] || (s[k] && s[k + 'Date'] !== o[k + 'Date']);
        return '<td class="cp-tick' + (dirty ? ' cp-dirty' : '') + '"><input type="checkbox" data-id="' + esc(id) + '" data-k="' + k + '"' + (s[k] ? ' checked' : '') + ' aria-label="' + (k === 'cut' ? 'Cutting' : 'Beveling') + ' done, piece ' + (j + 1) + '">' +
          (s[k] ? ' <input type="date" class="cp-date" data-id="' + esc(id) + '" data-k="' + k + 'Date" value="' + esc(s[k + 'Date']) + '">' : '') + '</td>';
      };
      return '<tr><td>' + (j + 1) + '</td><td>' + esc(p.project) + '</td><td>' + esc(p.drawing) + '</td><td>' + esc(p.spool) + '</td><td>' + esc(p.group) + '</td><td>' + esc(p.bevel) + '</td><td class="n">' + p.length + '</td>' + cell('cut') + cell('bevel') + '</tr>';
    }).join('');
    return '<div class="cp-barhd"><h3>B' + String(i + 1).padStart(2, '0') + ' &nbsp; ' + esc(b.item) + ' / ' + esc(b.control) + ' / ' + esc(String(b.barcode).slice(-6)) + '</h3><small>Barcode ' + esc(b.barcode) + '</small><small>Heat ' + esc(b.heat) + '</small>' +
      all('cut', cut) + all('bevel', bev) + '</div><div class="cp-tw"><table class="cp-sttbl"><tr><th>#</th><th>Project</th><th>Drawing No.</th><th>Spool No.</th><th>Group</th><th>Bevel</th><th class="n">Length</th><th>Cutting done</th><th>Beveling done</th></tr>' + rows + '</table></div>';
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
    var cut = 0, bev = 0, tot = 0;
    cur && cur.rec.bars.forEach(function (b, i) { b.pieces.forEach(function (p, j) { var s = cur.state[pid(cur.rec, b, j)]; tot++; if (s.cut) cut++; if (s.bevel) bev++; }); });
    if ($('stProgress')) $('stProgress').textContent = 'Cutting done ' + cut + ' of ' + tot + ' pieces  |  Beveling done ' + bev + ' of ' + tot;
  }

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
    }).then(function (r) { btn.disabled = false; btn.textContent = 'Save changes'; setPlan(r.rec, r.status); })
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
    var ws = XLSX.utils.aoa_to_sheet([headers].concat(rows));
    ws['!cols'] = headers.map(function (h) { return { wch: Math.max(10, String(h).length + 2) }; });
    return ws;
  }
  $('rpDownload').onclick = function () {
    var btn = $('rpDownload'), msg = $('rpMsg');
    var f = { project: $('rpProject').value, week: $('rpWeek').value.trim(), from: $('rpFrom').value, to: $('rpTo').value };
    btn.disabled = true; btn.textContent = 'Preparing...'; msg.textContent = ''; msg.className = 'cp-note';
    api('getReport', { type: 'cut', project: f.project, week: f.week, from: f.from, to: f.to, history: $('rpHist').checked }).then(function (r) {
      btn.disabled = false; btn.textContent = 'Download report (Excel)';
      if (!r.rows.length) { msg.textContent = 'No pieces match these filters.'; msg.className = 'cp-note cp-warn'; return; }
      var li = r.headers.indexOf('Length');
      var rows = r.rows.map(function (row) { return row.map(function (v, i) { return i === li && v !== '' && !isNaN(v) ? Number(v) : v; }); });
      var wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, sheetFrom(r.headers, rows), 'Cutting & Beveling Status');
      if (r.history) XLSX.utils.book_append_sheet(wb, sheetFrom(r.historyHeaders, r.history), 'History');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Report', 'Cutting and Beveling Status'], ['Generated', new Date().toLocaleString()], ['Project', f.project || 'All'], ['Week', f.week || 'All'],
        ['Date from', f.from || '-'], ['Date to', f.to || '-'], ['Pieces', rows.length], ['Note', 'Date filter matches pieces whose Cutting Date or Beveling Date is in the range.']]), 'Report info');
      XLSX.writeFile(wb, 'cutting-beveling-status-' + today() + '.xlsx');
      msg.textContent = rows.length + ' pieces downloaded.'; msg.className = 'cp-note cp-ok';
    }).catch(function (e) { btn.disabled = false; btn.textContent = 'Download report (Excel)'; msg.textContent = 'Could not prepare the report: ' + e.message; msg.className = 'cp-note cp-bad'; });
  };
})();
