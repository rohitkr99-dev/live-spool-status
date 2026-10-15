/*
 * cutting-plan.js - UI for the Cutting Plan page (engine: cutplan-engine.js).
 * Runs entirely in the browser. Accepted plans are kept in localStorage and can
 * optionally be saved to Google Drive through the Apps Script inbox (DRIVE_URL).
 * The page is in a Testing phase: the tool is visible, with a Testing notice (see #cp-soon in cutting-plan.html).
 */
(function () {
  'use strict';

  // Apps Script web-app URL of the Drive inbox (setup: Cutting Plan/DRIVE-SETUP.md). Public by design; the passcode protects it.
  var DRIVE_URL = 'https://script.google.com/macros/s/AKfycbzcxLVu9YxbFQKQzK56zZyzdFihEnfG3QrhRZEA-ESM89cxlqQ8lPHCPz2ZRKr4UgVZ/exec';

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };


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
      var seg = b.pieces.map(function (p, j) { var w = (p.length + rec.kerf) / b.startLength * 100; return '<i style="width:' + w + '%;background:' + colorOf(j) + '" title="#' + (j + 1) + ': ' + p.length + '">' + (w >= 3.5 ? j + 1 : '') + '</i>'; }).join('') + '<i class="rem" style="flex:1"></i>';
      var rows = b.pieces.map(function (p, j) { return '<tr><td><span class="cp-dot" style="background:' + colorOf(j) + '"></span>' + (j + 1) + '</td><td>' + esc(p.project) + '</td><td>' + esc(p.drawing) + '</td><td>' + esc(p.spool) + '</td><td>' + esc(p.group) + '</td><td>' + esc(p.bevel) + '</td><td class="n">' + p.length + '</td></tr>'; }).join('');
      return '<div class="cp-card cp-bar"><div class="cp-barhd"><h3>' + barTitle(b, i) + '</h3><small>Barcode ' + esc(b.barcode) + '</small><small>Heat ' + esc(b.heat) + '</small><small>Length ' + b.startLength + '</small><b>Remain ' + b.remain + '</b></div>' +
        '<div class="cp-lay">' + seg + '</div><div class="cp-tw"><table><tr><th>#</th><th>Project</th><th>Drawing No.</th><th>Spool No.</th><th>Group</th><th>Bevel</th><th class="n">Length</th></tr>' + rows + '</table></div></div>';
    }).join('');
    $('pdf').onclick = function () { buildPdf(rec).save(fileBase(rec) + '.pdf'); };
    $('xl').onclick = function () { XLSX.writeFile(buildWorkbook(rec), fileBase(rec) + '.xlsx'); };
    if (!accepted) $('acc').onclick = accept;
    if (accepted && DRIVE_URL && $('drv')) $('drv').onclick = function () { saveToDrive(rec); };
  }
  // Piece colours cycle through six; neighbours always differ and each piece also carries its number.
  var COLORS = ['#1F4E9E', '#C2410C', '#15803D', '#7E22CE', '#BE123C', '#0E7490'];
  function colorOf(j) { return COLORS[j % COLORS.length]; }
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

  /* ---------- PDF (A4 portrait, drawn with jsPDF) ----------
     Large print for the shop floor: at most 3 pipes per page (fewer when a pipe has many pieces),
     and a "Cut box" square on every piece row for the cutter to tick. */
  function buildPdf(rec) {
    var doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4' });
    var L = 12, W = 186, H = 297, TOP = 14, BOT = 16, RH = 7.6, MAXBARS = 3;
    var cols = [['#', 10, 'l'], ['Project', 24, 'l'], ['Drawing No.', 41, 'l'], ['Spool No.', 41, 'l'], ['Group', 20, 'l'], ['Bevel', 15, 'l'], ['Length', 16, 'r'], ['Cut box', 19, 'c']];
    var y = 0, barsOnPage = 0;
    // long values shrink (down to 7 pt) before they are cut, so drawing/spool numbers stay readable
    function fit(t, w, size) { t = String(t == null ? '' : t); doc.setFontSize(size); while (size > 7 && doc.getTextWidth(t) > w - 1.5) { size -= 0.5; doc.setFontSize(size); } while (t.length > 1 && doc.getTextWidth(t) > w - 1.5) t = t.slice(0, -1); return t; }
    function newPage() {
      doc.addPage(); y = TOP; barsOnPage = 0;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(90, 90, 90);
      doc.text('Cutting Plan ' + rec.planNo + '   |   Project ' + (rec.project || '-') + '   |   ' + rec.date, L, y); doc.setTextColor(0, 0, 0); y += 8;
    }
    function tableHead() {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
      var x = L;
      cols.forEach(function (c) { var ax = c[2] === 'r' ? x + c[1] - 1 : c[2] === 'c' ? x + c[1] : x + 0.8; doc.text(c[0], ax, y, { align: c[2] === 'l' ? 'left' : 'right' }); x += c[1]; });
      doc.setDrawColor(120); doc.setLineWidth(0.4); doc.line(L, y + 1.8, L + W, y + 1.8); y += 7;
    }
    // vals aligned with cols; dot = piece colour; box = draw the tick square
    function row(vals, dot, box) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5);
      var x = L;
      if (dot) { doc.setFillColor(dot); doc.circle(L + 2.2, y - 1.4, 1.5, 'F'); }
      cols.forEach(function (c, i) {
        if (c[2] === 'c') { if (box) { doc.setDrawColor(0); doc.setLineWidth(0.5); doc.rect(x + c[1] - 6, y - 5, 6, 6); } }
        else { var t = fit(vals[i], c[1], 10.5); doc.text(t, c[2] === 'r' ? x + c[1] - 1 : x + (i === 0 && dot ? 5.2 : 0.8), y, { align: c[2] === 'r' ? 'right' : 'left' }); }
        x += c[1];
      });
      doc.setDrawColor(200); doc.setLineWidth(0.2); doc.line(L, y + 2.2, L + W, y + 2.2); y += RH;
    }
    function barHead(b, i, cont) {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.text(barId(i) + '   ' + barLabel(b) + (cont ? '   (continued)' : ''), L, y); y += 6;
      var base = 'Barcode ' + b.barcode + '    Heat ' + b.heat + '    Length ' + b.startLength + '    ';
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5); doc.text(base, L, y);
      var wBase = doc.getTextWidth(base);
      doc.setFont('helvetica', 'bold'); doc.text('Remain ' + b.remain, L + wBase, y); y += 4.5;
    }
    function barGraphic(b) {
      var x = L, BH = 9;
      b.pieces.forEach(function (p, j) {
        var w = (p.length + rec.kerf) / b.startLength * W;
        doc.setFillColor(colorOf(j)); doc.rect(x, y, w, BH, 'F');
        doc.setDrawColor(255, 255, 255); doc.setLineWidth(0.5); doc.line(x + w, y, x + w, y + BH);
        if (w >= 6) { doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(255, 255, 255); doc.text(String(j + 1), x + w / 2, y + 6.2, { align: 'center' }); doc.setTextColor(0, 0, 0); }
        x += w;
      });
      var rw = L + W - x;                                  // remain: light grey with diagonal hatch
      if (rw > 0.2) {
        doc.setFillColor(238, 238, 242); doc.rect(x, y, rw, BH, 'F'); doc.setDrawColor(190, 190, 200); doc.setLineWidth(0.2);
        for (var hx = 0; hx < rw; hx += 1.8) { var run = Math.min(BH, rw - hx); doc.line(x + hx, y + BH, x + hx + run, y + BH - run); }
      }
      doc.setDrawColor(150); doc.setLineWidth(0.2); doc.rect(L, y, W, BH); y += BH + 5;
    }

    // first page header
    y = TOP;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(17); doc.text('DEE Piping Systems - Cutting Plan ' + rec.planNo, L, y); y += 7;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5);
    doc.text('Project ' + (rec.project || '-') + '   |   Date ' + rec.date + '   |   Cutting allowance ' + rec.kerf + ' mm   |   Trim ' + rec.trim + ' mm', L, y); y += 5.5;
    var s = rec.summary;
    doc.text('Pieces ' + s.pieces + '   Planned ' + s.placed + '   MNA ' + s.unplaced + '   Pipes ' + s.bars + '   Pipe length ' + (s.startMm / 1000).toFixed(2) + ' m   Net cut ' + (s.netMm / 1000).toFixed(2) + ' m   Yield ' + s.yieldPct.toFixed(1) + '%', L, y); y += 9;

    var sep = null;
    rec.bars.forEach(function (b, i) {
      var need = 6 + 4.5 + 9 + 5 + 7 + b.pieces.length * RH + 6;   // whole pipe block
      if (barsOnPage > 0 && (barsOnPage >= MAXBARS || y + need > H - BOT)) newPage();
      if (sep && sep.page === doc.getNumberOfPages()) { doc.setDrawColor(80, 80, 80); doc.setLineWidth(0.7); doc.line(L, sep.y, L + W, sep.y); }
      sep = null;
      barsOnPage++;
      barHead(b, i, false); barGraphic(b); tableHead();
      b.pieces.forEach(function (p, j) {
        if (y + RH > H - BOT) { newPage(); barsOnPage = 1; barHead(b, i, true); tableHead(); }   // very long pipe: continue on next page
        row([j + 1, p.project, p.drawing, p.spool, p.group, p.bevel, p.length, ''], colorOf(j), true);
      });
      sep = { page: doc.getNumberOfPages(), y: y - RH + 7.4 };   // divider goes in the gap below the last row, drawn only if another pipe follows on this page
      y += 10;
    });

    if (rec.unplaced.length) {
      if (y + 30 > H - BOT) newPage();
      doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.text('MNA - no pipe available (' + rec.unplaced.length + ')', L, y); y += 7;
      tableHead();
      rec.unplaced.forEach(function (p) { if (y + RH > H - BOT) { newPage(); tableHead(); } row(['', p.project, p.drawing, p.spool, p.group, p.bevel, p.length, ''], null, false); });
    }
    var n = doc.getNumberOfPages();
    for (var pg = 1; pg <= n; pg++) { doc.setPage(pg); doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(90, 90, 90); doc.text('Plan ' + rec.planNo + '  -  page ' + pg + ' of ' + n, L + W, H - 7, { align: 'right' }); doc.setTextColor(0, 0, 0); }
    return doc;
  }

  /* ---------- Google Drive (Apps Script inbox) ---------- */
  // Big, hard-to-miss message at the bottom of the screen. Success fades after 10 s; errors stay until closed.
  var toastTimer = null;
  function toast(ok, text) {
    var t = $('cp-toast');
    if (!t) { t = document.createElement('div'); t.id = 'cp-toast'; t.setAttribute('role', 'alert'); document.body.appendChild(t); }
    t.className = 'cp-toast ' + (ok ? 'cp-toast--ok' : 'cp-toast--bad');
    t.innerHTML = '<span>' + esc(text) + '</span><button type="button" aria-label="Close">&times;</button>';
    t.querySelector('button').onclick = function () { t.hidden = true; };
    t.hidden = false; clearTimeout(toastTimer);
    if (ok) toastTimer = setTimeout(function () { t.hidden = true; }, 10000);
  }
  function saveToDrive(rec) {
    var note = $('actnote'), pass = $('pass').value, btn = $('drv');
    if (!pass) { note.textContent = 'Enter the passcode.'; note.className = 'cp-note cp-bad'; toast(false, 'Enter the passcode first.'); return; }
    note.className = 'cp-note'; note.textContent = 'Saving to Drive...'; btn.disabled = true; btn.textContent = 'Saving...';
    var done = function () { btn.disabled = false; btn.textContent = 'Save to Drive'; };
    var b64 = function (u) { return u.split(',')[1]; };
    var xl = XLSX.write(buildWorkbook(rec), { type: 'base64', bookType: 'xlsx' });
    var pdf = b64(buildPdf(rec).output('datauristring'));
    var json = btoa(unescape(encodeURIComponent(JSON.stringify(rec))));
    var base = fileBase(rec);
    fetch(DRIVE_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({
      passcode: pass, planNo: rec.planNo, project: rec.project || 'Unassigned',
      files: [{ name: base + '.xlsx', b64: xl }, { name: base + '.pdf', b64: pdf }, { name: base + '.json', b64: json }]
    }) }).then(function (r) { return r.json(); }).then(function (r) {
      done();
      if (r.ok) {
        $('pass').value = '';                                  // never leave the passcode sitting in the box
        var all = loadRecs(); all.forEach(function (x) { if (x.createdAt === rec.createdAt) x.driveSavedAt = Date.now(); }); saveRecs(all);
        note.textContent = 'Saved to Drive (' + r.saved + ' files) on ' + new Date().toLocaleString() + '.'; note.className = 'cp-note cp-ok';
        toast(true, 'Saved to Drive: plan ' + rec.planNo + ' (' + r.saved + ' files).');
      } else {
        note.textContent = 'Drive refused: ' + (r.error || 'unknown error'); note.className = 'cp-note cp-bad';
        toast(false, 'NOT saved to Drive: ' + (r.error || 'unknown error'));
      }
    }).catch(function () {
      done(); note.textContent = 'Could not reach Drive. Download the files and check the setup.'; note.className = 'cp-note cp-bad';
      toast(false, 'NOT saved to Drive: could not reach Google. Check your internet and try again.');
    });
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
    $('recTbl').innerHTML = recs.length ? '<tr><th>Plan No.</th><th>Date</th><th class="n">Pipes</th><th class="n">Planned</th><th class="n">MNA</th><th>Drive</th><th></th></tr>' + recs.map(function (r, i) {
      var blk = undoBlock(r, recs);
      return '<tr><td>' + esc(r.planNo) + '</td><td>' + esc(r.date) + '</td><td class="n">' + r.bars.length + '</td><td class="n">' + r.summary.placed + '</td><td class="n">' + r.summary.unplaced + '</td><td>' + (r.driveSavedAt ? '<span class="cp-ok">Saved ' + esc(new Date(r.driveSavedAt).toLocaleDateString()) + '</span>' : '<span class="cp-note">Not saved</span>') + '</td><td>' +
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
