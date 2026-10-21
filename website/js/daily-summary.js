/*
 * daily-summary.js - "Daily summary" of the Cutting Station page. Only the administrator (decided by the Apps Script) gets the
 * button and the section; for everybody else nothing is added to the page and the script refuses the request.
 * Per day: people who opened the page, plans saved, cutting / beveling ticks, releases, Material Handover items, returns,
 * group changes, and who saved. Click a day to see the people; the Excel has both tables.
 */
(function () {
  'use strict';
  var CS = window.CutStation;
  if (!CS) return;
  var D = CS.D, esc = CS.esc, toast = CS.toast, built = false, data = null, picked = '';
  var HEAD = ['Date', 'People who opened the page', 'Plans saved', 'Cutting ticks', 'Beveling ticks', 'Pieces released', 'Releases undone', 'Items received', 'Items handed over', 'Items returned', 'Group changes', 'People who saved'];
  var PHEAD = ['Date', 'User', 'Opened the page', 'Plans saved', 'Cutting ticks', 'Beveling ticks', 'Pieces released', 'Releases undone', 'Items received', 'Items handed over', 'Items returned', 'Group changes'];

  window.addEventListener('cutaccess', function (e) { if (e.detail && e.detail.admin) build(); });
  if (CS.access && CS.access.admin) build();

  function build() {
    if (built) return;
    built = true;
    var btn = document.createElement('button');
    btn.className = 'btn btn--ghost'; btn.id = 'secBtnSummary'; btn.type = 'button'; btn.textContent = 'Daily summary';
    CS.el('secBtnHandover').insertAdjacentElement('afterend', btn);
    var sec = document.createElement('section');
    sec.id = 'secSummary'; sec.hidden = true;
    sec.innerHTML =
      '<div class="cp-card"><div class="cp-card__head"><h3>Daily summary</h3><span class="cp-hint">Only you can see this. Counted from the saved history.</span></div>' +
      '<div class="cp-row" style="margin-top:0"><label>From<input type="text" id="dsFrom" placeholder="DD-MM-YYYY" inputmode="numeric" maxlength="10"></label>' +
      '<label>To<input type="text" id="dsTo" placeholder="DD-MM-YYYY" inputmode="numeric" maxlength="10"></label>' +
      '<button class="btn btn--primary" id="dsShow" type="button">Show</button><button class="btn btn--ghost" id="dsXl" type="button">Download (Excel)</button></div>' +
      '<p class="cp-note">"People who opened the page" counts from the day this summary went live. Click a day to see who did what.</p>' +
      '<div id="dsMsg" class="cp-hint"></div><div class="cp-tw"><table class="cp-sttbl" id="dsTbl"></table></div></div>' +
      '<div class="cp-card" id="dsPCard" hidden><div class="cp-card__head"><h3 id="dsPTitle">People</h3></div><div class="cp-tw"><table class="cp-sttbl" id="dsPTbl"></table></div></div>';
    CS.el('secHandover').insertAdjacentElement('beforebegin', sec);
    var t = D.todayIso(), f = new Date(t + 'T12:00:00Z'); f.setUTCDate(f.getUTCDate() - 29);
    CS.el('dsFrom').value = D.dmy(f.toISOString().slice(0, 10)); CS.el('dsTo').value = D.dmy(t);
    CS.secNames.push('summary');
    btn.onclick = function () { CS.section('summary'); };
    CS.sectionHooks.summary = load;
    CS.el('dsShow').onclick = load;
    CS.el('dsXl').onclick = download;
  }

  function load() {
    var from = D.iso(CS.el('dsFrom').value), to = D.iso(CS.el('dsTo').value);
    if (!from || !to) return toast(false, 'Type the dates as DD-MM-YYYY.');
    CS.el('dsMsg').textContent = 'Loading...';
    CS.api('getDailySummary', { from: from, to: to }).then(function (r) {
      data = r; picked = '';
      CS.el('dsMsg').textContent = r.days.length ? r.days.length + ' day(s) with activity.' : 'No activity in this period.';
      render();
    }).catch(function (e) { CS.el('dsMsg').textContent = ''; toast(false, 'Could not load: ' + e.message); });
  }

  function render() {
    var days = data ? data.days : [];
    CS.el('dsTbl').innerHTML = '<tr>' + HEAD.map(function (h, i) { return '<th' + (i ? ' class="n"' : '') + '>' + esc(h) + '</th>'; }).join('') + '</tr>' +
      days.map(function (r) {
        return '<tr data-day="' + esc(r[0]) + '" style="cursor:pointer' + (r[0] === picked ? ';background:#F1EFF8' : '') + '"><td>' + esc(D.dmy(r[0])) + '</td>' + r.slice(1).map(function (v) { return '<td class="n">' + v + '</td>'; }).join('') + '</tr>';
      }).join('');
    Array.prototype.forEach.call(CS.el('dsTbl').querySelectorAll('[data-day]'), function (tr) { tr.onclick = function () { picked = picked === tr.dataset.day ? '' : tr.dataset.day; render(); }; });
    var rows = picked ? data.people.filter(function (p) { return p[0] === picked; }) : [];
    CS.el('dsPCard').hidden = !picked;
    if (picked) {
      CS.el('dsPTitle').textContent = 'People on ' + D.dmy(picked);
      CS.el('dsPTbl').innerHTML = '<tr>' + PHEAD.slice(1).map(function (h, i) { return '<th' + (i > 0 ? ' class="n"' : '') + '>' + esc(h) + '</th>'; }).join('') + '</tr>' +
        rows.map(function (r) { return '<tr><td>' + esc(r[1]) + '</td>' + r.slice(2).map(function (v) { return '<td class="n">' + v + '</td>'; }).join('') + '</tr>'; }).join('');
    }
  }

  function download() {
    if (!data || !data.days.length) return toast(false, 'Press Show first; there is nothing to download.');
    var wb = XLSX.utils.book_new();
    var s1 = [HEAD].concat(data.days.map(function (r) { return [D.dmy(r[0])].concat(r.slice(1)); }));
    var s2 = [PHEAD].concat(data.people.map(function (r) { return [D.dmy(r[0])].concat(r.slice(1)); }));
    [['Daily summary', s1], ['By person', s2]].forEach(function (x) {
      var ws = D.fixDates(XLSX.utils.aoa_to_sheet(x[1])); ws['!cols'] = x[1][0].map(function (h, i) { return { wch: i < 2 && x[0] === 'By person' ? 30 : 16 }; });
      XLSX.utils.book_append_sheet(wb, ws, x[0]);
    });
    XLSX.writeFile(wb, 'cutting-station-daily-summary-' + D.dmy(D.todayIso()) + '.xlsx');
  }
})();
