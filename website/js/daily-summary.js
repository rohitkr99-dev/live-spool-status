/*
 * daily-summary.js - "Cutting Station daily summary" panel on the HOME page (index.html). Only the administrator gets it:
 * the Apps Script says who is an admin (action getAccess) and refuses getDailySummary for everybody else, and for everybody
 * else this file adds nothing to the page.
 * Per day: people signed in to the website, people who opened the Cutting Station page, plans saved, cutting / beveling ticks, releases, Material Handover
 * items, returns, group changes, and who saved. Click a day to see the people; the Excel has both tables.
 */
(function () {
  'use strict';
  var DRIVE_URL = 'https://script.google.com/macros/s/AKfycbzcxLVu9YxbFQKQzK56zZyzdFihEnfG3QrhRZEA-ESM89cxlqQ8lPHCPz2ZRKr4UgVZ/exec';
  var HEAD = ['Date', 'People signed in to the website', 'People who opened Cutting Station', 'Plans saved', 'Cutting ticks', 'Beveling ticks', 'Pieces released', 'Releases undone', 'Items received', 'Items handed over', 'Items returned', 'Group changes', 'People who saved'];
  var PHEAD = ['Date', 'User', 'Signed in to the website', 'Opened Cutting Station', 'Plans saved', 'Cutting ticks', 'Beveling ticks', 'Pieces released', 'Releases undone', 'Items received', 'Items handed over', 'Items returned', 'Group changes'];
  var built = false, data = null, picked = '';

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function $(id) { return document.getElementById(id); }
  function dmy(iso) { return /^\d{4}-\d\d-\d\d$/.test(iso) ? iso.slice(8, 10) + '-' + iso.slice(5, 7) + '-' + iso.slice(0, 4) : iso; }
  function iso(t) { var m = /^(\d\d)-(\d\d)-(\d{4})$/.exec(String(t).trim()); return m && !isNaN(Date.parse(m[3] + '-' + m[2] + '-' + m[1])) ? m[3] + '-' + m[2] + '-' + m[1] : ''; }
  function today() { var d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }

  function api(action, body) {
    var u = window.firebase && firebase.auth().currentUser;
    if (!u) return Promise.reject(new Error('You are signed out. Sign in again.'));
    return u.getIdToken().then(function (tok) {
      return fetch(DRIVE_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ action: action, idToken: tok }, body || {})) });
    }).then(function (r) { return r.json(); }).then(function (r) {
      if (!r.ok) throw new Error(r.error || 'Request failed');
      return r;
    }, function () { throw new Error('Could not reach Google. Check your internet and try again.'); });
  }

  if (window.firebase) firebase.auth().onAuthStateChanged(function (u) {
    if (u && !built) api('getAccess').then(function (r) { if (r.admin) build(); }, function () {});
  });

  function build() {
    if (built) return;
    built = true;
    var st = document.createElement('style');
    st.textContent = '.ds{max-width:1200px;margin:32px auto;padding:0 20px}.ds-card{background:var(--bg-2,#fff);border:1px solid var(--line,rgba(0,0,0,.1));border-radius:14px;padding:18px 20px;margin-bottom:16px;color:inherit}' +
      '.ds-card h2{margin:0 0 4px;font-size:20px}.ds-hint{opacity:.7;font-size:13px}.ds-row{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end;margin:12px 0}.ds-row label{display:flex;flex-direction:column;font-size:12px;gap:4px}' +
      '.ds input{font:inherit;padding:8px 10px;border:1px solid var(--line-strong,rgba(0,0,0,.2));border-radius:8px;background:transparent;color:inherit;width:140px}' +
      '.ds button{font:inherit;font-weight:700;padding:9px 16px;border-radius:999px;border:1px solid var(--line-strong,rgba(0,0,0,.2));background:transparent;color:inherit;cursor:pointer}.ds button.ds-go{background:#8E2F31;border-color:#8E2F31;color:#fff}' +
      '.ds-tw{overflow-x:auto}.ds table{border-collapse:collapse;width:100%;font-size:13px}.ds th,.ds td{padding:7px 10px;border-bottom:1px solid var(--line,rgba(0,0,0,.1));text-align:left;white-space:nowrap}.ds th{font-size:11px;text-transform:uppercase;letter-spacing:.04em;opacity:.75}.ds .n{text-align:right}.ds tr[data-day]{cursor:pointer}.ds tr.ds-on{background:rgba(142,47,49,.1)}';
    document.head.appendChild(st);
    var sec = document.createElement('section');
    sec.className = 'ds'; sec.setAttribute('aria-label', 'Cutting Station daily summary');
    sec.innerHTML =
      '<div class="ds-card"><h2>Cutting Station - daily summary</h2><div class="ds-hint">Only you can see this. Counted from the saved history.</div>' +
      '<div class="ds-row"><label>From<input type="text" id="dsFrom" placeholder="DD-MM-YYYY" inputmode="numeric" maxlength="10"></label>' +
      '<label>To<input type="text" id="dsTo" placeholder="DD-MM-YYYY" inputmode="numeric" maxlength="10"></label>' +
      '<button class="ds-go" id="dsShow" type="button">Show</button><button id="dsXl" type="button">Download (Excel)</button></div>' +
      '<div class="ds-hint">The two sign-in counts start from the day this summary went live (a person counts once a day, on the first page they open). Click a day to see who did what.</div>' +
      '<div id="dsMsg" class="ds-hint" style="margin-top:8px"></div><div class="ds-tw"><table id="dsTbl"></table></div></div>' +
      '<div class="ds-card" id="dsPCard" hidden><h2 id="dsPTitle">People</h2><div class="ds-tw"><table id="dsPTbl"></table></div></div>';
    var main = document.querySelector('main') || document.body;
    main.appendChild(sec);
    var t = today(), f = new Date(t + 'T12:00:00Z'); f.setUTCDate(f.getUTCDate() - 29);
    $('dsFrom').value = dmy(f.toISOString().slice(0, 10)); $('dsTo').value = dmy(t);
    $('dsShow').onclick = load; $('dsXl').onclick = download;
    load();
  }

  function load() {
    var from = iso($('dsFrom').value), to = iso($('dsTo').value);
    if (!from || !to) { $('dsMsg').textContent = 'Type the dates as DD-MM-YYYY.'; return; }
    $('dsMsg').textContent = 'Loading...';
    api('getDailySummary', { from: from, to: to }).then(function (r) {
      data = r; picked = '';
      $('dsMsg').textContent = r.days.length ? r.days.length + ' day(s) with activity.' : 'No activity in this period.';
      render();
    }).catch(function (e) { $('dsMsg').textContent = 'Could not load: ' + e.message; });
  }

  function render() {
    var days = data ? data.days : [];
    $('dsTbl').innerHTML = '<tr>' + HEAD.map(function (h, i) { return '<th' + (i ? ' class="n"' : '') + '>' + esc(h) + '</th>'; }).join('') + '</tr>' +
      days.map(function (r) {
        return '<tr data-day="' + esc(r[0]) + '"' + (r[0] === picked ? ' class="ds-on"' : '') + '><td>' + esc(dmy(r[0])) + '</td>' + r.slice(1).map(function (v) { return '<td class="n">' + v + '</td>'; }).join('') + '</tr>';
      }).join('');
    Array.prototype.forEach.call($('dsTbl').querySelectorAll('[data-day]'), function (tr) { tr.onclick = function () { picked = picked === tr.dataset.day ? '' : tr.dataset.day; render(); }; });
    $('dsPCard').hidden = !picked;
    if (picked) {
      $('dsPTitle').textContent = 'People on ' + dmy(picked);
      $('dsPTbl').innerHTML = '<tr>' + PHEAD.slice(1).map(function (h, i) { return '<th' + (i ? ' class="n"' : '') + '>' + esc(h) + '</th>'; }).join('') + '</tr>' +
        data.people.filter(function (p) { return p[0] === picked; }).map(function (r) { return '<tr><td>' + esc(r[1]) + '</td>' + r.slice(2).map(function (v) { return '<td class="n">' + v + '</td>'; }).join('') + '</tr>'; }).join('');
    }
  }

  function withXlsx(cb) {                       // the Excel library is only fetched when the admin presses Download
    if (window.XLSX) return cb();
    var s = document.createElement('script'); s.src = 'vendor/xlsx.core.min.js'; s.onload = cb;
    s.onerror = function () { $('dsMsg').textContent = 'Could not load the Excel library.'; };
    document.head.appendChild(s);
  }

  function download() {
    if (!data || !data.days.length) { $('dsMsg').textContent = 'Press Show first; there is nothing to download.'; return; }
    withXlsx(function () {
      var wb = XLSX.utils.book_new();
      [['Daily summary', [HEAD].concat(data.days.map(function (r) { return [dmy(r[0])].concat(r.slice(1)); }))],
       ['By person', [PHEAD].concat(data.people.map(function (r) { return [dmy(r[0])].concat(r.slice(1)); }))]].forEach(function (x) {
        var ws = XLSX.utils.aoa_to_sheet(x[1]);
        Object.keys(ws).forEach(function (a) {      // DD-MM-YYYY text in column A becomes a real Excel date
          var c = ws[a], m = a.charAt(0) === 'A' && c && c.t === 's' && /^(\d\d)-(\d\d)-(\d{4})$/.exec(c.v);
          if (m) { c.t = 'n'; c.z = 'dd-mm-yyyy'; delete c.w; c.v = (Date.UTC(+m[3], +m[2] - 1, +m[1]) - Date.UTC(1899, 11, 30)) / 864e5; }
        });
        ws['!cols'] = x[1][0].map(function (h, i) { return { wch: i < 2 && x[0] === 'By person' ? 30 : 16 }; });
        XLSX.utils.book_append_sheet(wb, ws, x[0]);
      });
      XLSX.writeFile(wb, 'cutting-station-daily-summary-' + dmy(today()) + '.xlsx');
    });
  }
})();
