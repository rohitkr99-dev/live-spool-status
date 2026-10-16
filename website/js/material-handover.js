/* Material Handover section (item level): every spool shows its BOM items; the user ticks what was RECEIVED (from store / cutting station)
 * and what was HANDED OVER to the groups. Pipes are filled in from the Cutting & Beveling Status (a pipe line counts as received when its
 * pieces are cut AND bevelled), everything else is ticked by the user.
 *
 * Only one project is loaded at a time, after the user picks the filters and presses Load data. The BOM comes from small per-project
 * files in Drive (built daily from the Drawing Line List by scripts/build_bom.py); only ticked items are saved, to the private
 * "Material Handover - MASTER" sheet in Drive (sheet Items), through the Apps Script (Firebase login check).
 */
(function () {
  'use strict';
  var CS = window.CutStation;
  if (!CS || !CS.spools) return;
  var $ = CS.el, esc = CS.esc, api = CS.api, toast = CS.toast, D = CS.D;
  var PAGE = 50, CHUNK = 2000;

  var nk = function (s) { return String(s == null ? '' : s).trim().toLowerCase(); };
  var pn = function (s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ''); };
  var fmtN = function (n) { return Number(n).toLocaleString('en-US'); };
  var today = D.todayIso;

  var manifest = null;
  var spoolsList = [];     // [{key, drawing, spool, week, group, lines:[line]}] of the loaded project
  var project = '';        // loaded project code
  var base = {};           // item key -> saved state
  var edits = {};          // item key -> changed state (not saved yet)
  var pipeAuto = {};       // item key -> true when the pipe line is cut AND bevelled
  var lineByKey = {}, spoolByKey = {}, toOf = {};
  var filtered = [], shown = PAGE, open = {};
  var loadingNow = false;

  var blank = { recv: false, recvDate: '', hand: false, handDate: '', handTo: '' };
  var stateOf = function (l) { return edits[l.k] || base[l.k] || blank; };
  var differs = function (a, b) { return a.recv !== b.recv || a.recvDate !== b.recvDate || a.hand !== b.hand || a.handDate !== b.handDate || a.handTo !== b.handTo; };
  var dirtyKeys = function () { return Object.keys(edits).filter(function (k) { return differs(edits[k], base[k] || blank); }); };
  CS.dirtyFns.push(function () { return dirtyKeys().length > 0; });
  CS.sectionHooks.handover = init;

  var isRecv = function (l) { return l.pipe ? !!pipeAuto[l.k] : stateOf(l).recv; };
  var tickDate = function () { return D.iso($('hDate').value) || today(); };

  /* ---------- start: only the (small) list of projects is loaded ---------- */
  function init() {
    if (manifest || loadingNow) return;
    if (!$('hDate').value) $('hDate').value = D.dmy(today());
    loadingNow = true;
    $('hNote').className = 'cp-note'; $('hNote').textContent = 'Loading the list of projects...';
    api('getBomManifest').then(function (r) {
      manifest = r.manifest;
      var ps = Object.keys(manifest.projects || {}).sort();
      $('hProject').innerHTML = '<option value="">- choose a project -</option>' + ps.map(function (p) { return '<option value="' + esc(p) + '">' + esc(p) + ' (' + fmtN(manifest.projects[p].spools) + ' spools)</option>'; }).join('');
      $('hBomInfo').textContent = 'BOM: ' + manifest.source + ' (built ' + D.fromMs(Date.parse(manifest.built)) + ')';
      $('hNote').textContent = '';
    }).catch(function (e) { $('hNote').className = 'cp-note cp-bad'; $('hNote').textContent = 'Could not load the project list: ' + e.message; })
      .then(function () { loadingNow = false; });
  }

  /* ---------- Load data ---------- */
  $('hLoad').onclick = function () {
    var p = $('hProject').value;
    if (!p) { $('hNote').className = 'cp-note cp-warn'; $('hNote').textContent = 'Choose a project first.'; return; }
    if (dirtyKeys().length && !confirm('You have unsaved ticks. Load again and lose them?')) return;
    var btn = $('hLoad');
    btn.disabled = true; btn.textContent = 'Loading...'; $('hNote').className = 'cp-note'; $('hNote').textContent = 'Loading the BOM, saved ticks and cutting status of ' + p + '...';
    Promise.all([api('getBomProject', { project: p }), api('getItemStates', { project: p }), api('getPipeStatus', { project: p }), CS.spools()]).then(function (r) {
      build(p, r[0].bom, r[1].rows, r[2].pieces, r[3]);
      $('hNote').textContent = ''; $('hBody').hidden = false; shown = PAGE; open = {}; apply();
    }).catch(function (e) { $('hNote').className = 'cp-note cp-bad'; $('hNote').textContent = 'Could not load: ' + e.message; })
      .then(function () { btn.disabled = false; btn.textContent = 'Load data'; });
  };

  function build(p, bom, stateRows, pieces, tracker) {
    project = p; edits = {}; base = {}; pipeAuto = {}; lineByKey = {}; spoolByKey = {}; toOf = {}; spoolsList = [];
    var wk = {};
    tracker.forEach(function (t) { if (pn(t.project) === pn(p)) wk[nk(t.drawing) + '|' + nk(t.spool)] = t; });
    var pcs = {};
    pieces.forEach(function (x) { (pcs[nk(x[0]) + '|' + nk(x[1])] = pcs[nk(x[0]) + '|' + nk(x[1])] || []).push({ code: nk(x[2]), len: x[3], done: !!x[4], used: false }); });
    var weeks = {}, groups = {};
    Object.keys(bom.spools).forEach(function (sk) {
      var parts = sk.split('|'), drawing = parts[0], spool = parts.slice(1).join('|'), t = wk[nk(drawing) + '|' + nk(spool)] || {}, seen = {}, lines = [];
      bom.spools[sk].forEach(function (a) {
        var code = a[1] || a[2] || 'NOCODE', n = (seen[code] = (seen[code] || 0) + 1);
        var l = { k: p + '|' + drawing + '|' + spool + '|' + code + '|' + n, code: code, n: n, serial: a[0], desc: a[2], qty: a[3], uom: a[4], cat: a[5], size: a[6], pipe: a[4] === 'MM', sk: sk };
        lines.push(l); lineByKey[l.k] = l;
      });
      var sp = { key: sk, drawing: drawing, spool: spool, week: t.week || '', group: t.group || '', lines: lines };
      lines.forEach(function (l) { l.sp = sp; });
      spoolsList.push(sp); spoolByKey[sk] = sp; toOf[sk] = sp.group;
      if (sp.week) weeks[sp.week] = 1;
      if (sp.group) groups[sp.group] = 1;
      // pipes: match each BOM pipe line to a planned piece (same item code and length, else same code) and use its cut + bevel result
      var list = pcs[nk(drawing) + '|' + nk(spool)] || [];
      lines.forEach(function (l) {
        if (!l.pipe) return;
        var q = Number(l.qty), hit = null;
        list.forEach(function (x) { if (!hit && !x.used && x.code === nk(l.code) && Math.abs(x.len - q) < 0.5) hit = x; });
        if (!hit) list.forEach(function (x) { if (!hit && !x.used && x.code === nk(l.code)) hit = x; });
        if (hit) { hit.used = true; if (hit.done) pipeAuto[l.k] = true; }
      });
    });
    spoolsList.sort(function (a, b) { return a.drawing.localeCompare(b.drawing, undefined, { numeric: true }) || a.spool.localeCompare(b.spool, undefined, { numeric: true }); });
    stateRows.forEach(function (r) {
      base[r[0]] = { recv: r[5] === 'Yes', recvDate: D.iso(r[6]), hand: r[8] === 'Yes', handDate: D.iso(r[9]), handTo: r[10] || '' };
      var l = lineByKey[r[0]]; if (l && r[10]) toOf[l.sk] = r[10];
    });
    var num = function (w) { var m = /(\d+)/.exec(w); return m ? +m[1] : 9999; };
    $('hWeekList').innerHTML = Object.keys(weeks).sort(function (a, b) { return num(a) - num(b) || a.localeCompare(b); }).map(function (w) { return '<option value="' + esc(w) + '">'; }).join('');
    $('hGroupList').innerHTML = Object.keys(groups).sort().map(function (g) { return '<option value="' + esc(g) + '">'; }).join('');
  }

  /* ---------- status ---------- */
  function statusOf(sp) {
    var n = sp.lines.length, r = 0;
    sp.lines.forEach(function (l) { if (isRecv(l)) r++; });
    if (!n) return { cls: 'none', text: 'No BOM items', r: 0, n: 0, key: 'none' };
    if (r === n) return { cls: 'ok', text: 'Complete material available', r: r, n: n, key: 'complete' };
    if (r === 0) return { cls: 'bal', text: 'Material balance', r: r, n: n, key: 'balance' };
    return { cls: 'part', text: 'Partial MNA', r: r, n: n, key: 'partial' };
  }

  /* ---------- filters ---------- */
  var timer = null;
  ['hWeek', 'hGroup', 'hDrawing', 'hSpool', 'hItem'].forEach(function (id) { $(id).addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(function () { shown = PAGE; if (spoolsList.length) apply(); }, 250); }); });
  ['hStatus', 'hLines'].forEach(function (id) { $(id).addEventListener('change', function () { shown = PAGE; apply(); }); });

  function lineVisible(l) {
    var it = nk($('hItem').value), lf = $('hLines').value, st = stateOf(l), r = isRecv(l);
    if (it && (nk(l.code).indexOf(it) < 0 && nk(l.desc).indexOf(it) < 0 && nk(l.size).indexOf(it) < 0)) return false;
    if (lf === 'norecv' && r) return false;
    if (lf === 'recvonly' && !(r && !st.hand)) return false;
    if (lf === 'handed' && !st.hand) return false;
    return true;
  }
  function visLines(sp) { return sp.lines.filter(lineVisible); }
  function apply() {
    var w = nk($('hWeek').value), g = nk($('hGroup').value), d = nk($('hDrawing').value), s = nk($('hSpool').value), st = $('hStatus').value;
    var lineFilter = $('hItem').value.trim() || $('hLines').value;
    filtered = spoolsList.filter(function (sp) {
      if (w && nk(sp.week).indexOf(w) < 0) return false;
      if (g && nk(sp.group).indexOf(g) < 0) return false;
      if (d && nk(sp.drawing).indexOf(d) < 0) return false;
      if (s && nk(sp.spool).indexOf(s) < 0) return false;
      if (st && statusOf(sp).key !== st) return false;
      if (lineFilter && !visLines(sp).length) return false;
      return true;
    });
    render();
  }

  /* ---------- table ---------- */
  function tri(c, n) { return (n && c === n ? ' checked' : '') + (c > 0 && c < n ? ' data-partial="1"' : ''); }
  function spoolRow(sp) {
    var vl = visLines(sp), stt = statusOf(sp), isOpen = !!open[sp.key], k = esc(sp.key);
    var rc = 0, rn = 0, hc = 0;
    vl.forEach(function (l) { if (!l.pipe) { rn++; if (stateOf(l).recv) rc++; } if (stateOf(l).hand) hc++; });
    var pipesOnly = sp.lines.filter(function (l) { return !l.pipe; }).length === 0;
    var dirty = sp.lines.some(function (l) { return edits[l.k] && differs(edits[l.k], base[l.k] || blank); });
    var out = '<tr class="cp-sprow' + (dirty ? ' cp-dirtyrow' : '') + '"><td><button class="cp-exp" data-exp="' + k + '" type="button" aria-label="Show items">' + (isOpen ? '&#9662;' : '&#9656;') + '</button></td>' +
      '<td>' + esc(sp.drawing) + '</td><td>' + esc(sp.spool) + '</td><td>' + esc(sp.week) + '</td><td>' + esc(sp.group) + '</td>' +
      '<td class="n">' + vl.length + (vl.length !== sp.lines.length ? ' / ' + sp.lines.length : '') + '</td>' +
      '<td class="cp-tick">' + (pipesOnly ? '<span class="cp-note" style="margin:0">pipes only</span>' : '<input type="checkbox" data-sr="' + k + '"' + tri(rc, rn) + (rn ? '' : ' disabled') + ' aria-label="Received: all items of this spool"> <small>' + rc + '/' + rn + '</small>') + '</td>' +
      '<td class="cp-tick"><input type="checkbox" data-sh="' + k + '"' + tri(hc, vl.length) + (vl.length ? '' : ' disabled') + ' aria-label="Handed over: all items of this spool"> <small>' + hc + '/' + vl.length + '</small></td>' +
      '<td><span class="cp-badge cp-badge--' + stt.cls + '">' + esc(stt.text) + '</span> <small>' + stt.r + '/' + stt.n + '</small></td></tr>';
    if (isOpen) out += detailRow(sp, vl);
    return out;
  }
  function detailRow(sp, vl) {
    var rows = vl.map(function (l) {
      var st = stateOf(l), k = esc(l.k), dirty = edits[l.k] && differs(edits[l.k], base[l.k] || blank);
      var recvCell = l.pipe
        ? (pipeAuto[l.k] ? '<span class="cp-pipe-ok">&#10003; cut &amp; bevelled</span>' : '<span class="cp-pipe-no">waiting for cutting &amp; beveling</span>')
        : '<input type="checkbox" data-r="' + k + '"' + (st.recv ? ' checked' : '') + ' aria-label="Received: ' + esc(l.code) + '">' + (st.recv ? ' <input type="text" class="cp-date" size="10" maxlength="10" placeholder="DD-MM-YYYY" data-rd="' + k + '" value="' + esc(D.dmy(st.recvDate)) + '">' : '');
      var handCell = '<input type="checkbox" data-h="' + k + '"' + (st.hand ? ' checked' : '') + ' aria-label="Handed over: ' + esc(l.code) + '">' + (st.hand ? ' <input type="text" class="cp-date" size="10" maxlength="10" placeholder="DD-MM-YYYY" data-hd="' + k + '" value="' + esc(D.dmy(st.handDate)) + '">' : '');
      return '<tr' + (dirty ? ' class="cp-dirtyrow"' : '') + '><td>' + esc(l.code) + '</td><td>' + esc(l.desc) + (l.size ? ' <small>' + esc(l.size) + '</small>' : '') + '</td><td class="n">' + esc(l.qty) + ' ' + esc(l.uom) + '</td>' +
        '<td class="cp-tick">' + recvCell + '</td><td class="cp-tick">' + handCell + '</td></tr>';
    }).join('');
    return '<tr class="cp-detail"><td colspan="9"><div class="cp-detailhead"><label>Handed over to <input type="text" data-to="' + esc(sp.key) + '" value="' + esc(toOf[sp.key] || '') + '" placeholder="' + esc(sp.group) + '"></label></div>' +
      '<div class="cp-tw"><table class="cp-sttbl cp-sub"><tr><th>Item code</th><th>Description</th><th class="n">Qty</th><th>Received (store / cutting)</th><th>Handed over</th></tr>' + (rows || '<tr><td colspan="5" class="cp-note">No items match the filters.</td></tr>') + '</table></div></td></tr>';
  }
  function render() {
    var rows = filtered.slice(0, shown);
    $('hTable').innerHTML = '<tr><th></th><th>Drawing No.</th><th>Spool No.</th><th>Week</th><th>Group</th><th class="n">Items</th><th>Received</th><th>Handed over</th><th>Status</th></tr>' +
      (rows.length ? rows.map(spoolRow).join('') : '<tr><td colspan="9" class="cp-note">No spools match these filters.</td></tr>');
    Array.prototype.forEach.call($('hTable').querySelectorAll('[data-partial]'), function (c) { c.indeterminate = true; });
    $('hMore').hidden = filtered.length <= shown; $('hMore').textContent = 'Show ' + Math.min(PAGE, filtered.length - shown) + ' more';
    var tot = { complete: 0, partial: 0, balance: 0 };
    spoolsList.forEach(function (sp) { var k = statusOf(sp).key; if (tot[k] != null) tot[k]++; });
    $('hCount').textContent = project + ' - showing ' + fmtN(Math.min(shown, filtered.length)) + ' of ' + fmtN(filtered.length) + ' spools';
    $('hSummary').textContent = 'All ' + fmtN(spoolsList.length) + ' spools: ' + tot.complete + ' complete, ' + tot.partial + ' partial MNA, ' + tot.balance + ' material balance';
    globalBoxes(); updateBar();
  }
  function globalBoxes() {
    var rc = 0, rn = 0, hc = 0, hn = 0;
    filtered.forEach(function (sp) { visLines(sp).forEach(function (l) { hn++; if (stateOf(l).hand) hc++; if (!l.pipe) { rn++; if (stateOf(l).recv) rc++; } }); });
    var set = function (id, c, n) { var b = $(id); b.checked = n > 0 && c === n; b.indeterminate = c > 0 && c < n; b.disabled = n === 0; };
    set('hAllRecv', rc, rn); set('hAllHand', hc, hn);
    $('hAllRecvLbl').textContent = 'Received: all shown items (' + fmtN(rc) + '/' + fmtN(rn) + ')'; $('hAllHandLbl').textContent = 'Handed over: all shown items (' + fmtN(hc) + '/' + fmtN(hn) + ')';
  }
  $('hMore').onclick = function () { shown += PAGE; render(); };

  /* ---------- ticking ---------- */
  function store(l, st) { if (differs(st, base[l.k] || blank)) edits[l.k] = st; else delete edits[l.k]; }
  function setRecv(l, on) {
    if (l.pipe) return;
    var st = Object.assign({}, stateOf(l));
    st.recv = on; st.recvDate = on ? (st.recvDate || tickDate()) : '';
    store(l, st);
  }
  function setHand(l, on) {
    var st = Object.assign({}, stateOf(l));
    st.hand = on; st.handDate = on ? (st.handDate || tickDate()) : ''; st.handTo = on ? (toOf[l.sk] || l.sp.group || '') : '';
    store(l, st);
  }
  var vlOf = function (sk) { return visLines(spoolByKey[sk]); };

  $('hAllRecv').onchange = function () { var on = this.checked; filtered.forEach(function (sp) { visLines(sp).forEach(function (l) { setRecv(l, on); }); }); render(); };
  $('hAllHand').onchange = function () { var on = this.checked; filtered.forEach(function (sp) { visLines(sp).forEach(function (l) { setHand(l, on); }); }); render(); };

  $('hTable').addEventListener('click', function (e) {
    var b = e.target.closest('[data-exp]'); if (!b) return;
    var k = b.dataset.exp; open[k] = !open[k]; render();
  });
  $('hTable').addEventListener('change', function (e) {
    var t = e.target, d = t.dataset, l;
    if (d.sr) { var on = t.checked; vlOf(d.sr).forEach(function (x) { setRecv(x, on); }); render(); }
    else if (d.sh) { var on2 = t.checked; vlOf(d.sh).forEach(function (x) { setHand(x, on2); }); render(); }
    else if (d.r) { setRecv(lineByKey[d.r], t.checked); render(); }
    else if (d.h) { setHand(lineByKey[d.h], t.checked); render(); }
    else if (d.rd || d.hd) {
      l = lineByKey[d.rd || d.hd]; var iso = D.iso(t.value), st = Object.assign({}, stateOf(l));
      if (!iso) { toast(false, 'Type the date as DD-MM-YYYY, for example ' + D.dmy(today()) + '.'); render(); return; }
      if (d.rd) st.recvDate = iso; else st.handDate = iso;
      store(l, st); render();
    } else if (d.to) {
      toOf[d.to] = t.value.trim();
      spoolByKey[d.to].lines.forEach(function (x) { var st2 = stateOf(x); if (st2.hand) store(x, Object.assign({}, st2, { handTo: toOf[d.to] })); });
      render();
    }
  });

  /* ---------- save ---------- */
  function updateBar() {
    var n = dirtyKeys().length;
    $('hSaveBar').hidden = n === 0; $('hDirty').textContent = fmtN(n) + ' unsaved change' + (n === 1 ? '' : 's');
  }
  $('hDiscard').onclick = function () { edits = {}; render(); };
  $('hSave').onclick = function () {
    var keys = dirtyKeys(); if (!keys.length) return;
    var unreceived = keys.filter(function (k) { return edits[k].hand && !isRecv(lineByKey[k]); }).length;
    if (unreceived && !confirm(fmtN(unreceived) + ' item(s) are marked handed over but not received yet. Save anyway?')) return;
    var btn = $('hSave'); btn.disabled = true; btn.textContent = 'Saving...';
    var rows = keys.map(function (k) {
      var l = lineByKey[k], st = edits[k];
      return { project: project, drawing: l.sp.drawing, spool: l.sp.spool, code: l.code, n: l.n, recv: st.recv, recvDate: st.recvDate, hand: st.hand, handDate: st.handDate, handTo: st.handTo };
    });
    var done = 0, chain = Promise.resolve();
    for (var i = 0; i < rows.length; i += CHUNK) {
      (function (part) { chain = chain.then(function () { return api('saveItemStates', { rows: part }).then(function () { done += part.length; btn.textContent = 'Saving ' + fmtN(done) + '/' + fmtN(rows.length) + '...'; }); }); })(rows.slice(i, i + CHUNK));
    }
    chain.then(function () { return api('getItemStates', { project: project }); }).then(function (r) {
      base = {}; edits = {};
      r.rows.forEach(function (x) { base[x[0]] = { recv: x[5] === 'Yes', recvDate: D.iso(x[6]), hand: x[8] === 'Yes', handDate: D.iso(x[9]), handTo: x[10] || '' }; });
      toast(true, 'Saved ' + fmtN(rows.length) + ' item change' + (rows.length === 1 ? '' : 's') + '.'); render();
    }).catch(function (e) { toast(false, 'NOT saved (' + fmtN(done) + ' of ' + fmtN(rows.length) + ' went through): ' + e.message); })
      .then(function () { btn.disabled = false; btn.textContent = 'Save changes'; });
  };
  window.addEventListener('beforeunload', function (e) { if (dirtyKeys().length) { e.preventDefault(); e.returnValue = ''; } });

  /* ---------- report ---------- */
  $('hReport').onclick = function () {
    if (!filtered.length) return toast(false, 'Nothing to download. Check the filters.');
    var items = [['Project', 'Drawing No.', 'Spool No.', 'Week', 'Group', 'Item Code', 'Description', 'Size', 'Qty', 'UoM', 'Received', 'Received Date', 'Handed Over', 'Handover Date', 'Handed Over To']];
    var spl = [['Project', 'Drawing No.', 'Spool No.', 'Week', 'Group', 'Items', 'Received', 'Handed Over', 'Status']];
    filtered.forEach(function (sp) {
      var stt = statusOf(sp), hc = 0;
      sp.lines.forEach(function (l) { if (stateOf(l).hand) hc++; });
      spl.push([project, sp.drawing, sp.spool, sp.week, sp.group, sp.lines.length, stt.r, hc, stt.text]);
      visLines(sp).forEach(function (l) {
        var st = stateOf(l), q = Number(l.qty);
        items.push([project, sp.drawing, sp.spool, sp.week, sp.group, l.code, l.desc, l.size, isNaN(q) ? l.qty : q, l.uom, isRecv(l) ? (l.pipe ? 'Yes (cutting)' : 'Yes') : 'No', l.pipe ? '' : D.dmy(st.recvDate), st.hand ? 'Yes' : 'No', D.dmy(st.handDate), st.handTo]);
      });
    });
    var wb = XLSX.utils.book_new();
    [['Items', items], ['Spools', spl], ['Report info', [['Report', 'Material Handover (items)'], ['Generated', D.now()], ['Project', project], ['BOM', manifest ? manifest.source : ''], ['Note', 'Unsaved ticks on the page are included.']]]].forEach(function (x) {
      var ws = D.fixDates(XLSX.utils.aoa_to_sheet(x[1])); ws['!cols'] = x[1][0].map(function (h) { return { wch: Math.max(11, String(h).length + 2) }; }); XLSX.utils.book_append_sheet(wb, ws, x[0]);
    });
    XLSX.writeFile(wb, 'material-handover-' + project.replace(/[^\w-]+/g, '_') + '-' + D.dmy(today()) + '.xlsx');
  };
})();
