/*
 * cutting-plan.js - UI for the Cutting Plan page (engine: cutplan-engine.js).
 * Runs entirely in the browser. Accepted plans are kept in localStorage and can
 * optionally be saved to Google Drive through the Apps Script inbox (DRIVE_URL).
 * The tool section stays hidden until the page is opened with ?preview=1.
 */
(function () {
  'use strict';

  // Paste the Apps Script web-app URL here once the Drive inbox is set up (see Cutting Plan/DRIVE-SETUP.md).
  var DRIVE_URL = '';

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };

  if (new URLSearchParams(location.search).has('preview')) { $('cp-soon').hidden = true; $('cp-tool').hidden = false; } else { return; }

  var KEY = 'cutplan.records.v1';
  function loadRecs() { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { return []; } }
  function saveRecs(r) { try { localStorage.setItem(KEY, JSON.stringify(r)); return true; } catch (e) { return false; } }
  $('date').value = new Date().toISOString().slice(0, 10);

  /* ---------- reading files ---------- */
  var SYN = {
    project: ['project', 'project code', 'project no', 'project no.'], drawing: ['drawing no', 'drawing no.', 'drawing', 'dwg no'], spool: ['spool no', 'spool no.', 'spool'],
    item: ['item code', 'current aicd', 'aicd', 'item'], length: ['length', 'cut length', 'quantity', 'remain', 'remaining length'], qty: ['qty', 'nos'],
    group: ['group'], bevel: ['bevel', 'bevel detail', 'rajat'], barcode: ['barcode', 'bar code'], control: ['control no', 'control no.', 'control'], heat: ['heat no', 'heat no.', 'heat']
  };
  function mapRows(rows) {
    return rows.map(function (r) {
      var low = {}; Object.keys(r).forEach(function (k) { low[k.trim().toLowerCase()] = r[k]; });
      var o = {};
      for (var f in SYN) { var hit = SYN[f].find(function (n) { return n in low; }); o[f] = hit ? low[hit] : ''; }
      o.barcode = String(o.barcode).trim();
      return o;
    });
  }
  function readFile(f) {
    return f.arrayBuffer().then(function (buf) {
      var wb = XLSX.read(buf, { type: 'array' });
      return mapRows(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' }));
    });
  }
  function template(h, n) { var wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([h]), 'Sheet1'); XLSX.writeFile(wb, n); }
  $('tplCut').onclick = function () { template(['Project', 'Drawing No.', 'Spool No.', 'Item Code', 'Length', 'Group', 'Bevel'], 'cut-list-template.xlsx'); };
  $('tplBar').onclick = function () { template(['Barcode', 'Item Code', 'Length', 'Control No.', 'Heat No.'], 'available-pipes-template.xlsx'); };

  /* ---------- tabs ---------- */
  function tab(rec) {
    $('tabPlan').setAttribute('aria-selected', String(!rec)); $('tabRec').setAttribute('aria-selected', String(rec));
    $('panePlan').hidden = rec; $('paneRec').hidden = !rec; $('sheet').hidden = true;
    if (rec) renderRecs();
  }
  $('tabPlan').onclick = function () { tab(false); }; $('tabRec').onclick = function () { tab(true); };

  /* ---------- planning ---------- */
  var draft = null;
  function slimPiece(p) { return { project: p.project, drawing: p.drawing, spool: p.spool, item: p.item, group: p.group, bevel: p.bevel, length: p.length, reason: p.reason }; }
  function slimBar(b) { return { barcode: b.barcode, item: b.item, control: b.control, heat: b.heat, startLength: b.startLength, remain: b.remain, pieces: b.pieces.map(slimPiece) }; }
  function topProject(pieces) {
    var n = {}, best = '';
    pieces.forEach(function (p) { var k = String(p.project || '').trim(); if (k) { n[k] = (n[k] || 0) + 1; if (!best || n[k] > n[best]) best = k; } });
    return best;
  }

  $('run').onclick = function () {
    var msg = $('msg'); msg.className = ''; msg.textContent = ''; $('warns').hidden = true;
    var planNo = $('planNo').value.trim();
    var fail = function (m) { msg.textContent = m; msg.className = 'cp-bad'; };
    if (!planNo) return fail('Enter the Cutting Plan No.');
    if (loadRecs().some(function (r) { return r.planNo.toLowerCase() === planNo.toLowerCase(); })) return fail('Plan No. ' + planNo + ' is already accepted. Use a new number, or undo it first.');
    if (!$('cutFile').files[0] || !$('barFile').files[0]) return fail('Choose both files first.');
    Promise.all([readFile($('cutFile').files[0]), readFile($('barFile').files[0])]).then(function (r) {
      var pieces = r[0], bars = r[1];
      var res = CutPlan.plan(pieces, bars, { kerf: +$('kerf').value || 0, trim: +$('trim').value || 0 });
      draft = { planNo: planNo, project: topProject(pieces), date: $('date').value, kerf: res.opts.kerf, trim: res.opts.trim, createdAt: Date.now(), bars: res.bars.map(slimBar), unplaced: res.unplaced.map(slimPiece), summary: res.summary };
      var w = res.errors.slice(), recs = loadRecs().sort(function (a, c) { return c.createdAt - a.createdAt; });
      bars.forEach(function (b) { // ledger check: uploaded length vs the last recorded remain
        var last = null;
        recs.some(function (rec) { var x = rec.bars.find(function (y) { return y.barcode === b.barcode; }); if (x) last = x; return !!x; });
        if (last && last.remain !== Number(b.length)) w.push('Barcode ' + b.barcode + ': your file says ' + b.length + ' mm, but the last accepted plan left ' + last.remain + ' mm. Your file was used.');
      });
      if (w.length) { $('warns').hidden = false; $('warns').innerHTML = '<h2 class="cp-warn">Please check</h2>' + w.map(esc).join('<br>'); }
      show(draft, false); msg.textContent = pieces.length + ' pieces, ' + bars.length + ' pipes read.'; msg.className = 'cp-ok';
    }).catch(function (e) { fail(e.message || 'Could not read the files.'); });
  };

  /* ---------- plan view ---------- */
  function show(rec, accepted) {
    $('sheet').hidden = false;
    var s = rec.summary, m = function (v) { return (v / 1000).toFixed(2); };
    $('actions').innerHTML = (accepted ? '' : '<button class="btn btn--primary" id="acc" type="button">Accept plan</button> ') +
      '<button class="btn btn--ghost" id="pdf" type="button">Download plan (PDF)</button> <button class="btn btn--ghost" id="xl" type="button">Download plan &amp; updates (Excel)</button>' +
      (accepted && DRIVE_URL ? ' <button class="btn btn--ghost" id="drv" type="button">Save to Drive</button> <input type="password" id="pass" placeholder="Passcode" autocomplete="off" style="width:140px">' : '') +
      '<p class="cp-note" id="actnote">' + (accepted ? '' : 'Nothing is recorded until you accept.') + '</p>';
    var k = [['Pieces', s.pieces], ['Planned', s.placed], ['MNA (no pipe)', s.unplaced], ['Pipes used', s.bars], ['Pipe length used (m)', m(s.startMm)], ['Net cut (m)', m(s.netMm)], ['Remain after (m)', m(s.remainMm)], ['Yield %', s.yieldPct.toFixed(1)]];
    $('kpis').innerHTML = k.map(function (x) { return '<div class="cp-kpi"><b>' + esc(x[1]) + '</b><span>' + esc(x[0]) + '</span></div>'; }).join('');
    $('mnaBox').innerHTML = rec.unplaced.length ? '<div class="cp-card cp-mna"><h2 class="cp-warn">MNA - no pipe available (' + rec.unplaced.length + ')</h2><div class="cp-tw"><table><tr><th>Project</th><th>Drawing No.</th><th>Spool No.</th><th>Item Code</th><th>Group</th><th>Bevel</th><th class="n">Length</th><th>Reason</th></tr>' +
      rec.unplaced.map(function (p) { return '<tr><td>' + esc(p.project) + '</td><td>' + esc(p.drawing) + '</td><td>' + esc(p.spool) + '</td><td>' + esc(p.item) + '</td><td>' + esc(p.group) + '</td><td>' + esc(p.bevel) + '</td><td class="n">' + p.length + '</td><td>' + esc(p.reason) + '</td></tr>'; }).join('') + '</table></div></div>' : '';
    $('bars').innerHTML = rec.bars.map(function (b, i) {
      var seg = b.pieces.map(function (p) { return '<i style="width:' + (p.length / b.startLength * 100) + '%" title="' + p.length + '"></i>'; }).join('') + '<i class="rem" style="width:' + (Math.max(b.remain, 0) / b.startLength * 100) + '%"></i>';
      var rows = b.pieces.map(function (p, j) { return '<tr><td>' + (j + 1) + '</td><td>' + esc(p.project) + '</td><td>' + esc(p.drawing) + '</td><td>' + esc(p.spool) + '</td><td>' + esc(p.group) + '</td><td>' + esc(p.bevel) + '</td><td class="n">' + p.length + '</td></tr>'; }).join('');
      return '<div class="cp-card cp-bar"><div class="cp-barhd"><h3>' + barTitle(b, i) + '</h3><small>Barcode ' + esc(b.barcode) + '</small><small>Heat ' + esc(b.heat) + '</small><small>Length ' + b.startLength + '</small><b>Remain ' + b.remain + '</b></div>' +
        '<div class="cp-lay">' + seg + '</div><div class="cp-tw"><table><tr><th>#</th><th>Project</th><th>Drawing No.</th><th>Spool No.</th><th>Group</th><th>Bevel</th><th class="n">Length</th></tr>' + rows + '</table></div></div>';
    }).join('');
    $('pdf').onclick = function () { buildPdf(rec).save(fileBase(rec) + '.pdf'); };
    $('xl').onclick = function () { XLSX.writeFile(buildWorkbook(rec), fileBase(rec) + '.xlsx'); };
    if (!accepted) $('acc').onclick = accept;
    if (accepted && DRIVE_URL && $('drv')) $('drv').onclick = function () { saveToDrive(rec); };
  }
  function barId(i) { return 'B' + String(i + 1).padStart(2, '0'); }
  function barLabel(b) { return b.item + ' / ' + b.control + ' / ' + String(b.barcode).slice(-6); }
  function barTitle(b, i) { return barId(i) + ' &nbsp; ' + esc(barLabel(b)); }
  function fileBase(rec) { return 'cutting-plan-' + rec.planNo.replace(/[^\w-]+/g, '_'); }

  function accept() {
    var recs = loadRecs(); recs.push(draft);
    if (!saveRecs(recs)) { $('msg').textContent = 'Could not save in this browser. Download the PDF/Excel now and do not close this page.'; $('msg').className = 'cp-bad'; return; }
    show(draft, true); $('msg').textContent = 'Plan ' + draft.planNo + ' accepted and recorded.'; $('msg').className = 'cp-ok';
  }

  /* ---------- Excel ---------- */
  function buildWorkbook(rec) {
    var plan = [['Bar', 'Item Code', 'Control No', 'Barcode', 'Heat No', 'Project', 'Drawing No.', 'Spool No.', 'Group', 'Bevel', 'Cut Length', 'Pipe Length', 'Remain After']];
    var pipes = [['Barcode', 'Item Code', 'Control No', 'Heat No', 'Length Before', 'Pieces', 'Total Cut', 'REMAIN']];
    var sp = [['Project Code', 'Drawing No.', 'Spool No', 'Current AICD', 'Length', 'Group', 'Bevel', 'CUTTING PLAN', 'STATUS', 'Control No', 'BARCODE', 'DATE']];
    var st = [['Barcode', 'Item Code', 'Control No', 'Heat No', 'Length before', 'STATUS', 'C.PLAN NO.', 'REMAIN']];
    var mna = [['Project', 'Drawing No.', 'Spool No.', 'Item Code', 'Group', 'Bevel', 'Length', 'Reason']];
    rec.bars.forEach(function (b, i) {
      var tot = 0;
      b.pieces.forEach(function (p) {
        tot += p.length;
        plan.push([barId(i), b.item, b.control, b.barcode, b.heat, p.project, p.drawing, p.spool, p.group, p.bevel, p.length, b.startLength, b.remain]);
        sp.push([p.project, p.drawing, p.spool, b.item, p.length, p.group, p.bevel, rec.planNo, 'CUTTING PLAN OK', b.control, b.barcode, rec.date]);
      });
      pipes.push([b.barcode, b.item, b.control, b.heat, b.startLength, b.pieces.length, tot, b.remain]);
      st.push([b.barcode, b.item, b.control, b.heat, b.startLength, 'USED', rec.planNo, b.remain]);
    });
    rec.unplaced.forEach(function (p) {
      mna.push([p.project, p.drawing, p.spool, p.item, p.group, p.bevel, p.length, p.reason]);
      sp.push([p.project, p.drawing, p.spool, p.item, p.length, p.group, p.bevel, rec.planNo, 'MNA', '', '', rec.date]);
    });
    var wb = XLSX.utils.book_new();
    [['Cutting Plan', plan], ['Pipes (remain)', pipes], ['MNA', mna], ['SPOOL updates', sp], ['STORE updates', st]].forEach(function (x) { XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(x[1]), x[0]); });
    return wb;
  }

  /* ---------- PDF (A4 portrait, drawn with jsPDF) ---------- */
  function buildPdf(rec) {
    var doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4' });
    var L = 12, W = 186, H = 297, B = 14, y = 0;
    var cols = [['#', 7, 'l'], ['Project', 30, 'l'], ['Drawing No.', 48, 'l'], ['Spool No.', 44, 'l'], ['Group', 22, 'l'], ['Bevel', 15, 'l'], ['Length', 20, 'r']];
    function fit(t, w) { t = String(t == null ? '' : t); while (t.length > 1 && doc.getTextWidth(t) > w - 1.5) t = t.slice(0, -1); return t; }
    function ensure(h) { if (y + h > H - B) { doc.addPage(); y = 14; } }
    function row(vals, bold) {
      doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(8);
      var x = L;
      cols.forEach(function (c, i) { var t = fit(vals[i], c[1]); doc.text(t, c[2] === 'r' ? x + c[1] - 1 : x + 0.8, y, { align: c[2] === 'r' ? 'right' : 'left' }); x += c[1]; });
      doc.setDrawColor(200); doc.line(L, y + 1.3, L + W, y + 1.3); y += 4.6;
    }
    y = 14;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.text('DEE Piping Systems - Cutting Plan ' + rec.planNo, L, y); y += 6;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    doc.text('Project ' + (rec.project || '-') + '   |   Date ' + rec.date + '   |   Cutting allowance ' + rec.kerf + ' mm   |   Trim ' + rec.trim + ' mm', L, y); y += 5;
    var s = rec.summary;
    doc.text('Pieces ' + s.pieces + '   Planned ' + s.placed + '   MNA ' + s.unplaced + '   Pipes used ' + s.bars + '   Pipe length ' + (s.startMm / 1000).toFixed(2) + ' m   Net cut ' + (s.netMm / 1000).toFixed(2) + ' m   Yield ' + s.yieldPct.toFixed(1) + '%', L, y); y += 8;

    rec.bars.forEach(function (b, i) {
      ensure(9 + 8 + 4.6 * (b.pieces.length + 1) + 6);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.text(barId(i) + '   ' + barLabel(b), L, y);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
      doc.text('Barcode ' + b.barcode + '   Heat ' + b.heat + '   Length ' + b.startLength + '   Remain ' + b.remain, L + W, y, { align: 'right' }); y += 3;
      var x = L; doc.setFillColor(225, 225, 232); doc.rect(L, y, W, 5, 'F');
      b.pieces.forEach(function (p, j) { var w = p.length / b.startLength * W; doc.setFillColor(j % 2 ? 90 : 60, j % 2 ? 80 : 60, 160); doc.rect(x, y, w, 5, 'F'); x += w; });
      doc.setFillColor(120, 190, 150); doc.rect(x, y, Math.max(b.remain, 0) / b.startLength * W, 5, 'F'); y += 9;
      row(cols.map(function (c) { return c[0]; }), true);
      b.pieces.forEach(function (p, j) { row([j + 1, p.project, p.drawing, p.spool, p.group, p.bevel, p.length], false); });
      y += 4;
    });

    if (rec.unplaced.length) {
      ensure(14); doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.text('MNA - no pipe available (' + rec.unplaced.length + ')', L, y); y += 5;
      row(['', 'Project', 'Drawing No.', 'Spool No.', 'Group', 'Bevel', 'Length'], true);
      rec.unplaced.forEach(function (p) { ensure(6); row(['', p.project, p.drawing, p.spool, p.group, p.bevel, p.length], false); });
    }
    var n = doc.getNumberOfPages();
    for (var pg = 1; pg <= n; pg++) { doc.setPage(pg); doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.text('Plan ' + rec.planNo + '  -  page ' + pg + ' of ' + n, L + W, H - 7, { align: 'right' }); }
    return doc;
  }

  /* ---------- Google Drive (Apps Script inbox) ---------- */
  function saveToDrive(rec) {
    var note = $('actnote'), pass = $('pass').value;
    if (!pass) { note.textContent = 'Enter the passcode.'; note.className = 'cp-note cp-bad'; return; }
    note.className = 'cp-note'; note.textContent = 'Saving to Drive...';
    var b64 = function (u) { return u.split(',')[1]; };
    var xl = XLSX.write(buildWorkbook(rec), { type: 'base64', bookType: 'xlsx' });
    var pdf = b64(buildPdf(rec).output('datauristring'));
    var json = btoa(unescape(encodeURIComponent(JSON.stringify(rec))));
    var base = fileBase(rec);
    fetch(DRIVE_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({
      passcode: pass, planNo: rec.planNo, project: rec.project || 'Unassigned',
      files: [{ name: base + '.xlsx', b64: xl }, { name: base + '.pdf', b64: pdf }, { name: base + '.json', b64: json }]
    }) }).then(function (r) { return r.json(); }).then(function (r) {
      note.textContent = r.ok ? 'Saved to Drive (' + r.saved + ' files).' : 'Drive refused: ' + (r.error || 'unknown error');
      note.className = 'cp-note ' + (r.ok ? 'cp-ok' : 'cp-bad');
    }).catch(function () { note.textContent = 'Could not reach Drive. Download the files and check the setup.'; note.className = 'cp-note cp-bad'; });
  }

  /* ---------- accepted plans ---------- */
  function undoBlock(rec, recs) { // a plan can be undone only if no later plan used any of its pipes
    var mine = {}; rec.bars.forEach(function (b) { mine[b.barcode] = 1; });
    var later = recs.filter(function (r) { return r.createdAt > rec.createdAt && r.bars.some(function (b) { return mine[b.barcode]; }); });
    return later.length ? 'Used by later plan ' + later.map(function (r) { return r.planNo; }).join(', ') : '';
  }
  function renderRecs() {
    var recs = loadRecs().sort(function (a, b) { return b.createdAt - a.createdAt; });
    $('recEmpty').hidden = !!recs.length;
    $('recTbl').innerHTML = recs.length ? '<tr><th>Plan No.</th><th>Date</th><th class="n">Pipes</th><th class="n">Planned</th><th class="n">MNA</th><th></th></tr>' + recs.map(function (r, i) {
      var blk = undoBlock(r, recs);
      return '<tr><td>' + esc(r.planNo) + '</td><td>' + esc(r.date) + '</td><td class="n">' + r.bars.length + '</td><td class="n">' + r.summary.placed + '</td><td class="n">' + r.summary.unplaced + '</td><td>' +
        '<button class="btn btn--ghost" data-v="' + i + '" type="button">View</button> <button class="btn btn--ghost" data-u="' + i + '" type="button"' + (blk ? ' disabled title="' + esc(blk) + '"' : '') + '>Undo</button> <small class="cp-warn">' + esc(blk) + '</small></td></tr>';
    }).join('') : '';
    Array.prototype.forEach.call($('recTbl').querySelectorAll('[data-v]'), function (b) { b.onclick = function () { $('paneRec').hidden = true; show(recs[b.dataset.v], true); window.scrollTo(0, 0); }; });
    Array.prototype.forEach.call($('recTbl').querySelectorAll('[data-u]'), function (b) {
      b.onclick = function () {
        var r = recs[b.dataset.u];
        if (!confirm('Undo plan ' + r.planNo + '?\nThe pipes go back to their previous lengths in this tool. Also undo it in your master workbook.')) return;
        saveRecs(loadRecs().filter(function (x) { return x.createdAt !== r.createdAt; })); renderRecs();
      };
    });
  }
  $('exp').onclick = function () {
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(loadRecs(), null, 1)], { type: 'application/json' }));
    a.download = 'cutting-records-' + new Date().toISOString().slice(0, 10) + '.json'; a.click(); URL.revokeObjectURL(a.href);
  };
  $('imp').onchange = function (e) {
    var f = e.target.files[0]; if (!f) return;
    f.text().then(function (t) {
      var inc = JSON.parse(t); if (!Array.isArray(inc)) throw new Error('bad');
      var have = loadRecs(), ids = {}; have.forEach(function (r) { ids[r.createdAt] = 1; });
      saveRecs(have.concat(inc.filter(function (r) { return r && r.planNo && Array.isArray(r.bars) && !ids[r.createdAt]; }))); renderRecs();
    }).catch(function () { alert('That file is not a valid records export.'); });
    e.target.value = '';
  };
})();
