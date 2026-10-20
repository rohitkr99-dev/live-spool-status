/* Material Handover section (item level): every spool shows its BOM items; the user ticks what was RECEIVED (from store / cutting station)
 * and what was HANDED OVER to the groups. Pipes are filled in from the Cutting & Beveling Status (a pipe line counts as received when its
 * pieces are cut AND bevelled), everything else is ticked by the user.
 *
 * Only one project is loaded at a time, after the user picks the filters and presses Load data. The BOM comes from small per-project
 * files in Drive (built daily from the Drawing Line List by scripts/build_bom.py); only ticked items are saved, to the private
 * "Material Handover - MASTER" sheet in Drive (sheets Items, Returns, SpoolGroups), through the Apps Script (Firebase login check).
 *
 * Also here: a remark per item (typed by the user, e.g. why material is MNA), the item's surface area from the BOM, returning a received
 * fitting (dent / wrong ICD), changing a spool's group while handing over, several ICDs in one search, and the Excel downloads.
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
  var area3 = function (v) { return v === '' || v == null || isNaN(v) ? '' : Number(v).toFixed(3); };
  var today = D.todayIso;

  var manifest = null;
  var spoolsList = [];     // [{key, drawing, spool, week, group, lines:[line]}] of the loaded project
  var project = '';        // loaded project code
  var base = {};           // item key -> saved state
  var edits = {};          // item key -> changed state (not saved yet)
  var pipeAuto = {};       // item key -> true when the pipe line is cut AND bevelled
  var retBy = {};          // item key -> active return {reason, remark, at, by}
  var grpSaved = {}, grpEdit = {};   // spool key -> saved group / group changed on screen (not saved yet)
  var retRows = [];        // active returns of the project (for the list + Excel)
  var lineByKey = {}, spoolByKey = {};
  var filtered = [], shown = PAGE, open = {};
  var loadingNow = false, retTarget = null;

  var blank = { recv: false, recvDate: '', hand: false, handDate: '', handTo: '', remark: '' };
  var stateOf = function (l) { return edits[l.k] || base[l.k] || blank; };
  var differs = function (a, b) { return a.recv !== b.recv || a.recvDate !== b.recvDate || a.hand !== b.hand || a.handDate !== b.handDate || a.handTo !== b.handTo || a.remark !== b.remark; };
  var dirtyKeys = function () { return Object.keys(edits).filter(function (k) { return differs(edits[k], base[k] || blank); }); };
  var groupOf = function (sp) { return grpEdit[sp.key] != null ? grpEdit[sp.key] : (grpSaved[sp.key] != null ? grpSaved[sp.key] : sp.group); };
  var dirtyGroups = function () { return Object.keys(grpEdit).filter(function (k) { var sp = spoolByKey[k]; return sp && grpEdit[k] !== (grpSaved[k] != null ? grpSaved[k] : sp.group); }); };
  var dirtyCount = function () { return dirtyKeys().length + dirtyGroups().length; };
  CS.dirtyFns.push(function () { return dirtyCount() > 0; });
  CS.sectionHooks.handover = init;

  var isRecv = function (l) { return l.pipe ? !!pipeAuto[l.k] : stateOf(l).recv; };
  var isReturned = function (l) { return !l.pipe && !!retBy[l.k] && !stateOf(l).recv; };
  var tickDate = function () { return D.iso($('hDate').value) || today(); };
  var rowOf = function (r) { return { recv: r[5] === 'Yes', recvDate: D.iso(r[6]), hand: r[8] === 'Yes', handDate: D.iso(r[9]), handTo: r[10] || '', remark: r[11] || '' }; };

  /* ---------- start: only the (small) list of projects is loaded ---------- */
  function init() {
    if (manifest || loadingNow) return;
    if (!$('hDate').value) $('hDate').value = D.dmy(today());
    loadingNow = true;
    $('hNote').className = 'cp-note'; $('hNote').textContent = 'Loading the list of projects...';
    api('getBomManifest').then(function (r) {
      manifest = r.manifest;
      var ps = Object.keys(manifest.projects || {}).sort();
      $('hProject').innerHTML = '<option value="">- choose a project -</option>' + ps.map(function (p) { return '<option value="' + esc(p) + '">' + esc(p) + '</option>'; }).join('');
      $('hBomInfo').textContent = 'Newest BOM file: ' + manifest.source + ' (built ' + D.fromMs(Date.parse(manifest.built)) + ')';
      $('hNote').textContent = '';
    }).catch(function (e) { $('hNote').className = 'cp-note cp-bad'; $('hNote').textContent = 'Could not load the project list: ' + e.message; })
      .then(function () { loadingNow = false; });
  }

  /* ---------- Load data ---------- */
  $('hLoad').onclick = function () {
    var p = $('hProject').value;
    if (!p) { $('hNote').className = 'cp-note cp-warn'; $('hNote').textContent = 'Choose a project first.'; return; }
    if (dirtyCount() && !confirm('You have unsaved changes. Load again and lose them?')) return;
    var btn = $('hLoad');
    btn.disabled = true; btn.textContent = 'Loading...'; $('hNote').className = 'cp-note'; $('hNote').textContent = 'Loading the BOM, saved ticks and cutting status of ' + p + '...';
    Promise.all([api('getBomProject', { project: p }), api('getItemStates', { project: p }), api('getPipeStatus', { project: p }), api('getReturns', { project: p }), api('getSpoolGroups', { project: p }), CS.spools()]).then(function (r) {
      build(p, r[0].bom, r[1].rows, r[2].pieces, r[3].rows, r[4].rows, r[5]);
      $('hBomInfo').textContent = 'BOM of ' + p + ': ' + r[0].bom.source + ' (built ' + D.fromMs(Date.parse(r[0].bom.built)) + ')';
      $('hNote').textContent = ''; $('hBody').hidden = false; shown = PAGE; open = {}; apply();
    }).catch(function (e) { $('hNote').className = 'cp-note cp-bad'; $('hNote').textContent = 'Could not load: ' + e.message; })
      .then(function () { btn.disabled = false; btn.textContent = 'Load data'; });
  };

  function setReturns(rows) {
    retBy = {}; retRows = rows;
    rows.forEach(function (r) { retBy[r[0]] = { reason: r[7], remark: r[8], at: r[9], by: r[10] }; });
  }

  function build(p, bom, stateRows, pieces, returns, groupRows, tracker) {
    project = p; edits = {}; base = {}; pipeAuto = {}; lineByKey = {}; spoolByKey = {}; spoolsList = []; grpEdit = {}; grpSaved = {};
    var wk = {};
    tracker.forEach(function (t) { if (pn(t.project) === pn(p)) wk[nk(t.drawing) + '|' + nk(t.spool)] = t; });
    var pcs = {};
    pieces.forEach(function (x) { (pcs[nk(x[0]) + '|' + nk(x[1])] = pcs[nk(x[0]) + '|' + nk(x[1])] || []).push({ code: nk(x[2]), len: x[3], done: !!x[4], used: false }); });
    Object.keys(bom.spools).forEach(function (sk) {
      var parts = sk.split('|'), drawing = parts[0], spool = parts.slice(1).join('|'), t = wk[nk(drawing) + '|' + nk(spool)] || {}, seen = {}, lines = [];
      bom.spools[sk].forEach(function (a) {
        var code = a[1] || a[2] || 'NOCODE', n = (seen[code] = (seen[code] || 0) + 1);
        var l = { k: p + '|' + drawing + '|' + spool + '|' + code + '|' + n, code: code, n: n, serial: a[0], desc: a[2], qty: a[3], uom: a[4], cat: a[5], size: a[6], area: a[7] == null ? '' : a[7], pipe: a[4] === 'MM', sk: sk };
        lines.push(l); lineByKey[l.k] = l;
      });
      var sp = { key: sk, drawing: drawing, spool: spool, week: t.week || '', group: t.group || '', lines: lines };
      lines.forEach(function (l) { l.sp = sp; });
      spoolsList.push(sp); spoolByKey[sk] = sp;
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
    stateRows.forEach(function (r) { base[r[0]] = rowOf(r); });
    groupRows.forEach(function (g) { grpSaved[g[0] + '|' + g[1]] = g[2]; });
    setReturns(returns);
    refreshDD();
  }

  /* After a return or a save: read the saved state again (the BOM is not read again). */
  function reloadState() {
    return Promise.all([api('getItemStates', { project: project }), api('getReturns', { project: project }), api('getSpoolGroups', { project: project })]).then(function (r) {
      base = {}; r[0].rows.forEach(function (x) { base[x[0]] = rowOf(x); });
      Object.keys(edits).forEach(function (k) { if (!differs(edits[k], base[k] || blank)) delete edits[k]; });
      grpSaved = {}; r[2].rows.forEach(function (g) { grpSaved[g[0] + '|' + g[1]] = g[2]; });
      Object.keys(grpEdit).forEach(function (k) { if (spoolByKey[k] && grpEdit[k] === (grpSaved[k] != null ? grpSaved[k] : spoolByKey[k].group)) delete grpEdit[k]; });
      setReturns(r[1].rows);
    });
  }

  /* ---------- status ---------- */
  function statusOf(sp) {
    var n = sp.lines.length, r = 0, h = 0, recvNotHanded = 0, text, cls, key;
    sp.lines.forEach(function (l) { var rc = isRecv(l), st = stateOf(l); if (rc) r++; if (st.hand) h++; if (rc && !st.hand) recvNotHanded++; });
    if (!n) return { cls: 'none', text: 'No BOM items', sfx: '', r: 0, n: 0, key: 'none' };
    if (r === n) { cls = 'ok'; text = 'Complete material available'; key = 'complete'; }
    else if (r === 0) { cls = 'bal'; text = 'Material balance'; key = 'balance'; }
    else { cls = 'part'; text = 'Partial MNA'; key = 'partial'; }
    // the spool counts as handed over when every item that has been received is handed over and at least one item is handed over
    var handed = h > 0 && recvNotHanded === 0;
    return { cls: cls, text: text, sfx: handed ? (key === 'complete' ? ', spool handed over' : ', but spool handed over') : '', r: r, n: n, key: key };
  }
  var statusText = function (s) { return s.text + s.sfx; };

  /* ---------- filters ---------- */
  var timer = null;
  ['hWeek', 'hGroup', 'hDrawing', 'hSpool', 'hItem'].forEach(function (id) { $(id).addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(function () { shown = PAGE; if (spoolsList.length) apply(); }, 250); }); });
  ['hStatus', 'hLines'].forEach(function (id) { $(id).addEventListener('change', function () { shown = PAGE; apply(); }); });

  // Week / Group / ICD accept one value or a pasted list (one per line, or separated by commas, semicolons or tabs). Anything matching ANY value is kept.
  function tokens(text) {
    var parts = String(text || '').split(/[\n\r\t,;]+/).map(function (x) { return x.trim(); }).filter(Boolean);
    if (parts.length === 1 && /^[\d\s]+$/.test(parts[0])) parts = parts[0].split(/\s+/);   // "27 28 29"
    return parts;
  }
  function lineVisible(l) {
    var it = tokens($('hItem').value).map(nk), lf = $('hLines').value, st = stateOf(l), r = isRecv(l);
    if (it.length && !it.some(function (t) { return nk(l.code).indexOf(t) >= 0 || nk(l.desc).indexOf(t) >= 0 || nk(l.size).indexOf(t) >= 0; })) return false;   // partial ICD from any end, several at once
    if (lf === 'norecv' && r) return false;
    if (lf === 'recvonly' && !(r && !st.hand)) return false;
    if (lf === 'handed' && !st.hand) return false;
    if (lf === 'returned' && !isReturned(l)) return false;
    return true;
  }
  function visLines(sp) { return sp.lines.filter(lineVisible); }
  var weekNo = function (x) { var m = /^(?:week|wk|w)?\s*-?\s*(\d+)$/i.exec(String(x).trim()); return m ? +m[1] : null; };
  function weekMatch(spWeek, toks) {
    var sn = weekNo(spWeek);
    return toks.some(function (t) { var tn = weekNo(t); return tn != null && sn != null ? tn === sn : nk(spWeek).indexOf(nk(t)) >= 0 && nk(spWeek) !== ''; });
  }
  function groupMatch(spGroup, toks) { return toks.some(function (t) { return nk(spGroup) === nk(t); }); }

  /* ---------- Week / Group: tick values in a dropdown, or type / paste a list ---------- */
  var sel = { week: {}, group: {} };
  var DD = { week: { box: 'hWeek', opts: 'hWeekOpts', sum: 'hWeekSum', dd: 'hWeekDD', all: 'All weeks' }, group: { box: 'hGroup', opts: 'hGroupOpts', sum: 'hGroupSum', dd: 'hGroupDD', all: 'All groups' } };
  function ddTokens(kind) { return Object.keys(sel[kind]).concat(tokens($(DD[kind].box).value)); }
  function ddSummary(kind) {
    var t = ddTokens(kind);
    $(DD[kind].sum).textContent = t.length ? (t.length > 3 ? t.length + ' selected' : t.join(', ')) : DD[kind].all;
  }
  function fillOpts(kind) {
    var p = $('hProject').value, el = $(DD[kind].opts);
    if (!p) { el.innerHTML = '<span class="cp-note">Choose a project first.</span>'; return; }
    el.innerHTML = '<span class="cp-note">Loading the list...</span>';
    CS.spools().then(function (list) {
      var cnt = {}, num = function (w) { var m = /(\d+)/.exec(w); return m ? +m[1] : 9999; };
      list.forEach(function (s) { if (pn(s.project) === pn(p)) { var v = kind === 'week' ? s.week : s.group; if (v) cnt[v] = (cnt[v] || 0) + 1; } });
      if (kind === 'group') spoolsList.forEach(function (sp) { var g = groupOf(sp); if (g && !cnt[g]) cnt[g] = 0; });   // groups typed into spools
      var keys = Object.keys(cnt).sort(kind === 'week' ? function (a, b) { return num(a) - num(b) || a.localeCompare(b); } : function (a, b) { return a.localeCompare(b, undefined, { numeric: true }); });
      el.innerHTML = keys.length ? keys.map(function (v) { return '<label class="cp-opt"><input type="checkbox" data-dd="' + kind + '" value="' + esc(v) + '"' + (sel[kind][v] ? ' checked' : '') + '> ' + esc(v) + ' <small>(' + cnt[v] + ')</small></label>'; }).join('') : '<span class="cp-note">No ' + kind + 's known for this project. You can type or paste them above.</span>';
    }).catch(function (e) { el.innerHTML = '<span class="cp-note cp-bad">Could not load the list: ' + esc(e.message) + '</span>'; });
  }
  function refreshDD() { fillOpts('week'); fillOpts('group'); }
  function ddChanged() { shown = PAGE; if (spoolsList.length) apply(); }
  Object.keys(DD).forEach(function (kind) {
    var d = DD[kind];
    $(d.dd).addEventListener('toggle', function () { if (this.open) fillOpts(kind); });          // the list is read only when the dropdown is opened
    $(d.opts).addEventListener('change', function (e) {
      var t = e.target; if (!t.dataset.dd) return;
      if (t.checked) sel[kind][t.value] = 1; else delete sel[kind][t.value];
      ddSummary(kind); ddChanged();
    });
    $(d.box).addEventListener('input', function () { ddSummary(kind); });
  });
  Array.prototype.forEach.call(document.querySelectorAll('[data-ddclear]'), function (b) {
    b.onclick = function () {
      var kind = b.dataset.ddclear; sel[kind] = {}; $(DD[kind].box).value = '';
      Array.prototype.forEach.call($(DD[kind].opts).querySelectorAll('input'), function (c) { c.checked = false; });
      ddSummary(kind); ddChanged();
    };
  });
  $('hProject').addEventListener('change', function () {            // a new project has its own weeks and groups
    ['week', 'group'].forEach(function (kind) { sel[kind] = {}; $(DD[kind].box).value = ''; ddSummary(kind); if ($(DD[kind].dd).open) fillOpts(kind); else $(DD[kind].opts).innerHTML = '<span class="cp-note">Loading the list when opened...</span>'; });
  });
  document.addEventListener('click', function (e) {                 // click outside closes an open dropdown
    Object.keys(DD).forEach(function (kind) { var el = $(DD[kind].dd); if (el.open && !el.contains(e.target)) el.open = false; });
  });

  function apply() {
    var wt = ddTokens('week'), gt = ddTokens('group'), dt = tokens($('hDrawing').value).map(nk), spt = tokens($('hSpool').value).map(nk), st = $('hStatus').value;
    var lineFilter = $('hItem').value.trim() || $('hLines').value;
    filtered = spoolsList.filter(function (sp) {
      if (wt.length && !weekMatch(sp.week, wt)) return false;
      if (gt.length && !groupMatch(groupOf(sp), gt)) return false;
      if (dt.length && !dt.some(function (t) { return nk(sp.drawing).indexOf(t) >= 0; })) return false;       // part of a number is enough, any of several
      if (spt.length && !spt.some(function (t) { return nk(sp.spool).indexOf(t) >= 0; })) return false;
      if (st && statusOf(sp).key !== st) return false;
      if (lineFilter && !visLines(sp).length) return false;
      return true;
    });
    render();
  }

  /* ---------- table ---------- */
  function tri(c, n) { return (n && c === n ? ' checked' : '') + (c > 0 && c < n ? ' data-partial="1"' : ''); }
  function spoolArea(sp) { var t = 0, any = false; sp.lines.forEach(function (l) { if (l.area !== '' && !isNaN(l.area)) { t += Number(l.area); any = true; } }); return any ? t : ''; }
  function spoolRow(sp) {
    var vl = visLines(sp), stt = statusOf(sp), isOpen = !!open[sp.key], k = esc(sp.key);
    var rc = 0, rn = 0, hc = 0;
    vl.forEach(function (l) { if (!l.pipe) { rn++; if (stateOf(l).recv) rc++; } if (stateOf(l).hand) hc++; });
    var pipesOnly = sp.lines.filter(function (l) { return !l.pipe; }).length === 0;
    var dirty = sp.lines.some(function (l) { return edits[l.k] && differs(edits[l.k], base[l.k] || blank); }) || dirtyGroups().indexOf(sp.key) >= 0;
    var out = '<tr class="cp-sprow' + (dirty ? ' cp-dirtyrow' : '') + '"><td><button class="cp-exp" data-exp="' + k + '" type="button" aria-label="Show items">' + (isOpen ? '&#9662;' : '&#9656;') + '</button></td>' +
      '<td>' + esc(sp.drawing) + '</td><td>' + esc(sp.spool) + '</td><td>' + esc(sp.week) + '</td>' +
      '<td><input type="text" class="cp-grp" data-g="' + k + '" value="' + esc(groupOf(sp)) + '" size="8" maxlength="40" aria-label="Group of this spool"></td>' +
      '<td class="n">' + vl.length + (vl.length !== sp.lines.length ? ' / ' + sp.lines.length : '') + '</td>' +
      '<td class="n">' + area3(spoolArea(sp)) + '</td>' +
      '<td class="cp-tick">' + (pipesOnly ? '<span class="cp-note" style="margin:0">pipes only</span>' : '<input type="checkbox" data-sr="' + k + '"' + tri(rc, rn) + (rn ? '' : ' disabled') + ' aria-label="Received: all items of this spool"> <small>' + rc + '/' + rn + '</small>') + '</td>' +
      '<td class="cp-tick"><input type="checkbox" data-sh="' + k + '"' + tri(hc, vl.length) + (vl.length ? '' : ' disabled') + ' aria-label="Handed over: all items of this spool"> <small>' + hc + '/' + vl.length + '</small></td>' +
      '<td><span class="cp-badge cp-badge--' + stt.cls + '">' + esc(stt.text) + '</span>' + (stt.sfx ? '<span class="cp-sfx">' + esc(stt.sfx) + '</span>' : '') + ' <small>' + stt.r + '/' + stt.n + '</small></td></tr>';
    if (isOpen) out += detailRow(sp, vl);
    return out;
  }
  function detailRow(sp, vl) {
    var rows = vl.map(function (l) {
      var st = stateOf(l), k = esc(l.k), dirty = edits[l.k] && differs(edits[l.k], base[l.k] || blank), ret = retBy[l.k], savedRecv = !!(base[l.k] && base[l.k].recv) && !edits[l.k];
      var recvCell = l.pipe
        ? (pipeAuto[l.k] ? '<span class="cp-pipe-ok">&#10003; cut &amp; bevelled</span>' : '<span class="cp-pipe-no">waiting for cutting &amp; beveling</span>')
        : '<input type="checkbox" data-r="' + k + '"' + (st.recv ? ' checked' : '') + ' aria-label="Received: ' + esc(l.code) + '">' + (st.recv ? ' <input type="text" class="cp-date" size="10" maxlength="10" placeholder="DD-MM-YYYY" data-rd="' + k + '" value="' + esc(D.dmy(st.recvDate)) + '">' : '') +
          (st.recv && savedRecv ? ' <button class="btn btn--ghost cp-small" type="button" data-ret="' + k + '">Return</button>' : '') +
          (ret && !st.recv ? ' <span class="cp-tag">Returned: ' + esc(ret.reason) + '</span> <small>' + esc(D.dmy(ret.at).slice(0, 10)) + '</small>' : '');
      var handCell = '<input type="checkbox" data-h="' + k + '"' + (st.hand ? ' checked' : '') + ' aria-label="Handed over: ' + esc(l.code) + '">' + (st.hand ? ' <input type="text" class="cp-date" size="10" maxlength="10" placeholder="DD-MM-YYYY" data-hd="' + k + '" value="' + esc(D.dmy(st.handDate)) + '">' : '');
      return '<tr' + (dirty ? ' class="cp-dirtyrow"' : '') + '><td>' + esc(l.code) + '</td><td>' + esc(l.desc) + (l.size ? ' <small>' + esc(l.size) + '</small>' : '') + '</td><td class="n">' + esc(l.qty) + ' ' + esc(l.uom) + '</td><td class="n">' + area3(l.area) + '</td>' +
        '<td class="cp-tick">' + recvCell + '</td><td class="cp-tick">' + handCell + '</td><td><input type="text" class="cp-remark" data-rm="' + k + '" value="' + esc(st.remark) + '" maxlength="300" placeholder="Remark" aria-label="Remark: ' + esc(l.code) + '"></td></tr>';
    }).join('');
    return '<tr class="cp-detail"><td colspan="10">' +
      '<div class="cp-tw"><table class="cp-sttbl cp-sub"><tr><th>Item code (ICD)</th><th>Description</th><th class="n">Qty</th><th class="n">Area m&sup2;</th><th>Received (store / cutting)</th><th>Handed over</th><th>Remark (e.g. why MNA)</th></tr>' + (rows || '<tr><td colspan="7" class="cp-note">No items match the filters.</td></tr>') + '</table></div></td></tr>';
  }
  function render() {
    var rows = filtered.slice(0, shown);
    $('hTable').innerHTML = '<tr><th></th><th>Drawing No.</th><th>Spool No.</th><th>Week</th><th>Group</th><th class="n">Items</th><th class="n">Area m&sup2;</th><th>Received</th><th>Handed over</th><th>Status</th></tr>' +
      (rows.length ? rows.map(spoolRow).join('') : '<tr><td colspan="10" class="cp-note">No spools match these filters.</td></tr>');
    Array.prototype.forEach.call($('hTable').querySelectorAll('[data-partial]'), function (c) { c.indeterminate = true; });
    $('hMore').hidden = filtered.length <= shown; $('hMore').textContent = 'Show ' + Math.min(PAGE, filtered.length - shown) + ' more';
    var tot = { complete: 0, partial: 0, balance: 0 };
    spoolsList.forEach(function (sp) { var k = statusOf(sp).key; if (tot[k] != null) tot[k]++; });
    $('hCount').textContent = project + ' - showing ' + fmtN(Math.min(shown, filtered.length)) + ' of ' + fmtN(filtered.length) + ' spools';
    $('hSummary').textContent = 'All ' + fmtN(spoolsList.length) + ' spools: ' + tot.complete + ' complete, ' + tot.partial + ' partial MNA, ' + tot.balance + ' material balance';
    renderReturns(); globalBoxes(); updateBar();
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
    st.hand = on; st.handDate = on ? (st.handDate || tickDate()) : ''; st.handTo = on ? groupOf(l.sp) : '';
    store(l, st);
  }
  var vlOf = function (sk) { return visLines(spoolByKey[sk]); };

  $('hAllRecv').onchange = function () { var on = this.checked; filtered.forEach(function (sp) { visLines(sp).forEach(function (l) { setRecv(l, on); }); }); render(); };
  $('hAllHand').onchange = function () { var on = this.checked; filtered.forEach(function (sp) { visLines(sp).forEach(function (l) { setHand(l, on); }); }); render(); };

  $('hTable').addEventListener('click', function (e) {
    var rb = e.target.closest('[data-ret]');
    if (rb) { openReturn(rb.dataset.ret); return; }
    var b = e.target.closest('[data-exp]'); if (!b) return;
    var k = b.dataset.exp; open[k] = !open[k]; render();
  });
  $('hTable').addEventListener('change', function (e) {
    var t = e.target, d = t.dataset, l;
    if (d.sr) { var on = t.checked; vlOf(d.sr).forEach(function (x) { setRecv(x, on); }); render(); }
    else if (d.sh) { var on2 = t.checked; vlOf(d.sh).forEach(function (x) { setHand(x, on2); }); render(); }
    else if (d.r) { setRecv(lineByKey[d.r], t.checked); render(); }
    else if (d.h) { setHand(lineByKey[d.h], t.checked); render(); }
    else if (d.rm) { l = lineByKey[d.rm]; store(l, Object.assign({}, stateOf(l), { remark: t.value.trim() })); render(); }
    else if (d.rd || d.hd) {
      l = lineByKey[d.rd || d.hd]; var iso = D.iso(t.value), st = Object.assign({}, stateOf(l));
      if (!iso) { toast(false, 'Type the date as DD-MM-YYYY, for example ' + D.dmy(today()) + '.'); render(); return; }
      if (d.rd) st.recvDate = iso; else st.handDate = iso;
      store(l, st); render();
    } else if (d.g) {                                                // the spool's group changed during fabrication: items handed over now go to the new group
      var sp = spoolByKey[d.g], g = t.value.trim();
      grpEdit[d.g] = g;
      sp.lines.forEach(function (x) { var s2 = stateOf(x); if (s2.hand) store(x, Object.assign({}, s2, { handTo: g })); });
      ddSummary('group'); render();
    }
  });

  /* ---------- return a received fitting (dent / wrong ICD) ---------- */
  var retDlg = $('hRetDlg');
  function openReturn(k) {
    if (dirtyKeys().length || dirtyGroups().length) return toast(false, 'Save or discard your unsaved changes first, then return the item.');
    var l = lineByKey[k]; retTarget = l;
    $('hRetWhat').innerHTML = '<b>' + esc(l.code) + '</b> - ' + esc(l.desc) + ' (' + esc(l.qty) + ' ' + esc(l.uom) + '), spool ' + esc(l.sp.spool) + '.';
    $('hRetReason').value = ''; $('hRetRemark').value = ''; retDlg.showModal();
  }
  $('hRetCancel').onclick = function () { retDlg.close(); };
  $('hRetOk').onclick = function () {
    var reason = $('hRetReason').value, btn = $('hRetOk'), l = retTarget;
    if (!reason) return toast(false, 'Choose a reason.');
    btn.disabled = true; btn.textContent = 'Saving...';
    api('returnItem', { project: project, drawing: l.sp.drawing, spool: l.sp.spool, code: l.code, n: l.n, desc: l.desc, qty: l.qty + ' ' + l.uom, reason: reason, remark: $('hRetRemark').value.trim() })
      .then(function () { retDlg.close(); return reloadState(); })
      .then(function () { toast(true, 'Item returned. It is listed under Returned items.'); render(); })
      .catch(function (e) { toast(false, 'NOT saved: ' + e.message); })
      .then(function () { btn.disabled = false; btn.textContent = 'Return item'; });
  };
  function renderReturns() {
    $('hRetCard').hidden = !retRows.length;
    $('hRetTbl').innerHTML = retRows.length ? '<tr><th>Drawing No.</th><th>Spool No.</th><th>ICD</th><th>Description</th><th>Reason</th><th>Returned on</th><th>By</th><th>Remark</th></tr>' + retRows.slice(0, 200).map(function (r) {
      return '<tr><td>' + esc(r[2]) + '</td><td>' + esc(r[3]) + '</td><td>' + esc(r[4]) + '</td><td>' + esc(r[5]) + '</td><td>' + esc(r[7]) + '</td><td>' + esc(D.dmy(r[9]).slice(0, 10)) + '</td><td>' + esc(r[10]) + '</td><td>' + esc(r[8]) + '</td></tr>';
    }).join('') : '';
  }

  /* ---------- save ---------- */
  function updateBar() {
    var n = dirtyCount();
    $('hSaveBar').hidden = n === 0; $('hDirty').textContent = fmtN(n) + ' unsaved change' + (n === 1 ? '' : 's');
  }
  $('hDiscard').onclick = function () { edits = {}; grpEdit = {}; render(); };
  $('hSave').onclick = function () {
    var keys = dirtyKeys(), gkeys = dirtyGroups(); if (!keys.length && !gkeys.length) return;
    var unreceived = keys.filter(function (k) { return edits[k].hand && !isRecv(lineByKey[k]); }).length;
    if (unreceived && !confirm(fmtN(unreceived) + ' item(s) are marked handed over but not received yet. Save anyway?')) return;
    var btn = $('hSave'); btn.disabled = true; btn.textContent = 'Saving...';
    var rows = keys.map(function (k) {
      var l = lineByKey[k], st = edits[k];
      return { project: project, drawing: l.sp.drawing, spool: l.sp.spool, code: l.code, n: l.n, recv: st.recv, recvDate: st.recvDate, hand: st.hand, handDate: st.handDate, handTo: st.handTo, remark: st.remark };
    });
    var grows = gkeys.map(function (k) { var sp = spoolByKey[k]; return { project: project, drawing: sp.drawing, spool: sp.spool, group: grpEdit[k], from: grpSaved[k] != null ? grpSaved[k] : sp.group }; });
    var done = 0, total = rows.length + grows.length, chain = Promise.resolve();
    var step = function (action, part) { chain = chain.then(function () { return api(action, { rows: part }).then(function () { done += part.length; btn.textContent = 'Saving ' + fmtN(done) + '/' + fmtN(total) + '...'; }); }); };
    for (var i = 0; i < rows.length; i += CHUNK) step('saveItemStates', rows.slice(i, i + CHUNK));
    for (var j = 0; j < grows.length; j += CHUNK) step('saveSpoolGroups', grows.slice(j, j + CHUNK));
    chain.then(function () { edits = {}; grpEdit = {}; return reloadState(); }).then(function () {
      toast(true, 'Saved ' + fmtN(total) + ' change' + (total === 1 ? '' : 's') + '.'); render();
    }).catch(function (e) { toast(false, 'NOT saved (' + fmtN(done) + ' of ' + fmtN(total) + ' went through): ' + e.message); })
      .then(function () { btn.disabled = false; btn.textContent = 'Save changes'; });
  };
  window.addEventListener('beforeunload', function (e) { if (dirtyCount()) { e.preventDefault(); e.returnValue = ''; } });

  /* ---------- Excel ---------- */
  function writeBook(name, sheets) {
    var wb = XLSX.utils.book_new();
    sheets.forEach(function (x) {
      var ws = D.fixDates(XLSX.utils.aoa_to_sheet(x[1])); ws['!cols'] = x[1][0].map(function (h) { return { wch: Math.max(11, String(h).length + 2) }; }); XLSX.utils.book_append_sheet(wb, ws, x[0]);
    });
    XLSX.writeFile(wb, name + '-' + project.replace(/[^\w-]+/g, '_') + '-' + D.dmy(today()) + '.xlsx');
  }
  var info = function (title) { return [['Report', title], ['Generated', D.now()], ['Project', project], ['BOM', manifest ? manifest.source : ''], ['Note', 'Unsaved changes on the page are included.']]; };
  var numOrText = function (v) { var q = Number(v); return v === '' || isNaN(q) ? v : q; };
  var areaNum = function (v) { return v === '' || isNaN(v) ? '' : Math.round(Number(v) * 1000) / 1000; };

  $('hReport').onclick = function () {
    if (!filtered.length) return toast(false, 'Nothing to download. Check the filters.');
    var items = [['Project', 'Drawing No.', 'Spool No.', 'Week', 'Group', 'Item Code', 'Description', 'Size', 'Qty', 'UoM', 'Area m2', 'Received', 'Received Date', 'Handed Over', 'Handover Date', 'Handed Over To', 'Returned', 'Remark']];
    var spl = [['Project', 'Drawing No.', 'Spool No.', 'Week', 'Group', 'Items', 'Area m2', 'Received', 'Handed Over', 'Status']];
    filtered.forEach(function (sp) {
      var stt = statusOf(sp), hc = 0;
      sp.lines.forEach(function (l) { if (stateOf(l).hand) hc++; });
      spl.push([project, sp.drawing, sp.spool, sp.week, groupOf(sp), sp.lines.length, areaNum(spoolArea(sp)), stt.r, hc, statusText(stt)]);
      visLines(sp).forEach(function (l) {
        var st = stateOf(l);
        items.push([project, sp.drawing, sp.spool, sp.week, groupOf(sp), l.code, l.desc, l.size, numOrText(l.qty), l.uom, areaNum(l.area), isRecv(l) ? (l.pipe ? 'Yes (cutting)' : 'Yes') : 'No', l.pipe ? '' : D.dmy(st.recvDate), st.hand ? 'Yes' : 'No', D.dmy(st.handDate), st.handTo, isReturned(l) ? retBy[l.k].reason : '', st.remark]);
      });
    });
    writeBook('material-handover', [['Items', items], ['Spools', spl], ['Report info', info('Material Handover (items)')]]);
  };

  // every item of the loaded project that is not received yet, with its remark - to send to the project team
  $('hMna').onclick = function () {
    var rows = [['Project', 'Drawing No.', 'Spool No.', 'Week', 'Group', 'Item Code', 'Description', 'Size', 'Qty', 'UoM', 'Area m2', 'Expected from', 'Returned', 'Remark', 'Spool status']];
    spoolsList.forEach(function (sp) {
      var stt = statusOf(sp);
      sp.lines.forEach(function (l) {
        if (isRecv(l)) return;
        rows.push([project, sp.drawing, sp.spool, sp.week, groupOf(sp), l.code, l.desc, l.size, numOrText(l.qty), l.uom, areaNum(l.area), l.pipe ? 'Cutting station' : 'Store / vendor', isReturned(l) ? retBy[l.k].reason : '', stateOf(l).remark, statusText(stt)]);
      });
    });
    if (rows.length === 1) return toast(false, 'Nothing is missing: every item of this project is received.');
    writeBook('mna-list', [['MNA list', rows], ['Report info', info('MNA list (items not received)')]]);
  };

  $('hRetXl').onclick = function () {
    if (!retRows.length) return toast(false, 'No returned items.');
    var rows = [['Project', 'Drawing No.', 'Spool No.', 'Item Code', 'Description', 'Qty', 'Reason', 'Returned On', 'Returned By', 'Remark']];
    retRows.forEach(function (r) { rows.push([r[1], r[2], r[3], r[4], r[5], r[6], r[7], D.dmy(r[9]).slice(0, 10), r[10], r[8]]); });
    writeBook('returned-items', [['Returned items', rows], ['Report info', info('Returned items')]]);
  };
})();
