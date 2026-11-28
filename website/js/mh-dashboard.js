/*
 * mh-dashboard.js - "Dashboard" section of the Cutting Station page: a weekly summary of cutting and material handover for management.
 * Read only. It reads the same things as the other sections (BOM per project, handover ticks, groups, cutting status) through the Drive
 * script and matches pipes with CS.mhBuild from material-handover.js, so the numbers agree with the Material Handover section.
 */
(function () {
  'use strict';
  var CS = window.CutStation;
  if (!CS || !CS.spools || !CS.mhBuild) return;
  var $ = CS.el, esc = CS.esc, api = CS.api;

  var TREND_FROM = '2026-11-09';   // first week whose cutting and handover ticks are all kept in this system (older weeks would look unfinished)
  var TREND_MAX = 6, POOL = 4, STALE_MS = 5 * 60 * 1000, CACHE_KEY = 'mhDashboardV3';

  var nk = function (s) { return String(s == null ? '' : s).trim().toLowerCase(); };
  var pn = function (s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ''); };
  var skey = function (p, d, s) { return pn(p) + '|' + nk(d) + '|' + nk(s); };
  var fmt = function (n) { return Number(n).toLocaleString('en-US'); };
  var pct = function (a, b) { return b ? Math.round(a / b * 100) : 0; };
  var two = function (n) { return (n < 10 ? '0' : '') + n; };
  var dmy = function (iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? m[3] + '-' + m[2] + '-' + m[1] : ''; };
  var stamp = function (ms) { var d = new Date(ms); return two(d.getDate()) + '-' + two(d.getMonth() + 1) + '-' + d.getFullYear() + ' ' + two(d.getHours()) + ':' + two(d.getMinutes()); };
  var todayIso = function () { var d = new Date(); return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate()); };

  // the item type comes from the BOM description (the BOM category column holds the material grade)
  var TYPES = [['Valves', /valve/i], ['Flanges', /flange/i], ['Olets and bosses', /olet|boss/i], ['Elbows', /elbow|bend/i], ['Tees', /\btee\b/i], ['Reducers', /reduc/i],
    ['Couplings and unions', /coupling|union|nipple/i], ['Caps and plugs', /\bcap\b|plug/i], ['Plates', /plate/i]];
  var typeOf = function (desc) { for (var i = 0; i < TYPES.length; i++) if (TYPES[i][1].test(desc || '')) return TYPES[i][0]; return 'Others'; };

  var baseP = null, baseAt = 0, projP = {};   // spool list + manifest + cutting status; pn(project) -> records of that project
  var weeks = [], curWeek = '', view = null, run = 0;

  /* ---------- reading ---------- */
  function loadBase() {
    if (baseP) return baseP;
    baseP = Promise.all([CS.spools(), api('getBomManifest'), api('getReport', { type: 'cut' })]).then(function (r) {
      var projects = {}; Object.keys(r[1].manifest.projects || {}).forEach(function (p) { projects[pn(p)] = p; });
      var h = r[2].headers, ix = function (n) { return h.indexOf(n); };
      var iId = ix('Piece ID'), iP = ix('Project'), iD = ix('Drawing No.'), iS = ix('Spool No.'), iI = ix('Item Code'), iL = ix('Length'), iC = ix('Cutting Done'), iB = ix('Beveling Done');
      var seen = {}; r[2].rows.forEach(function (x, n) { seen[x[iId] || 'row' + n] = x; });   // one row per piece (the last one wins, as in the Drive script)
      var pieces = {};
      Object.keys(seen).forEach(function (k) {
        var x = seen[k], cut = x[iC] === 'Yes', bev = x[iB] === 'Yes';
        (pieces[pn(x[iP])] = pieces[pn(x[iP])] || []).push([x[iD], x[iS], x[iI], Number(x[iL]) || 0, cut && bev ? 1 : 0, cut, bev]);
      });
      baseAt = Date.now();
      return { spools: r[0], projects: projects, pieces: pieces, weeks: weekList(r[0], projects) };
    });
    baseP.catch(function () { baseP = null; });
    return baseP;
  }

  // The weeks are the "Initial Week Planned" of the Weekly Production file: a spool that is moved later (material, customer hold) stays in its first week.
  // Every such week that has a project with a BOM, newest first. A week's date is the Planned Start most spools of that week have; spools that were moved
  // carry the date of their new week, so only spools still in the week are asked (all of them if every one has moved).
  function weekList(spools, projects) {
    var still = {}, any = {}, names = {};
    var add = function (m, week, date) { var x = m[week] = m[week] || {}; if (date) x[date] = (x[date] || 0) + 1; };
    spools.forEach(function (s) {
      if (s.week) add(still, s.week, s.plannedStart);
      if (!s.initialWeek || !projects[pn(s.project)]) return;
      names[s.initialWeek] = 1; add(any, s.initialWeek, s.plannedStart);
    });
    var most = function (x) { return x ? Object.keys(x).sort(function (a, b) { return x[b] - x[a]; })[0] : ''; };
    return Object.keys(names).map(function (name) { return { name: name, start: most(still[name]) || most(any[name]) || '' }; })
      .sort(function (a, b) { return b.start.localeCompare(a.start); });
  }

  // one small record per BOM spool of a project (the BOM itself is not kept)
  function summarise(p, bom, stateRows, groupRows, base) {
    var state = {}; stateRows.forEach(function (r) { state[r[0]] = { recv: r[5] === 'Yes', hand: r[8] === 'Yes', date: CS.D.iso(r[9]) }; });
    var grp = {}; groupRows.forEach(function (g) { grp[nk(g[0]) + '|' + nk(g[1])] = g[2]; });
    var built = CS.mhBuild(p, bom, base.pieces[pn(p)] || [], base.spools);
    return built.spools.map(function (sp) {
      var o = { k: skey(p, sp.drawing, sp.spool), g: grp[nk(sp.drawing) + '|' + nk(sp.spool)], n: sp.lines.length, r: 0, h: 0, wait: 0, pReq: 0, pPlan: 0, pCut: 0, pBev: 0, fReq: 0, fRecv: 0, fHand: 0, miss: {}, id: 0, idGot: 0, hd: '', nodate: false };
      sp.lines.forEach(function (l) {
        var st = state[l.k] || {}, hand = !!st.hand, hit = built.hits[l.k], recv;
        if (l.pipe) {   // a handed-over pipe obviously was cut, even if the cutting was never ticked (same rule as Material Handover)
          o.pReq++;
          if (hit || hand) o.pPlan++;
          if (hand || (hit && hit.raw[5])) o.pCut++;
          if (hand || (hit && hit.done)) o.pBev++;
          recv = hand || !!(hit && hit.done);
        } else {
          recv = !!st.recv;
          o.fReq++;
          if (recv) o.fRecv++;
          if (hand) o.fHand++;
          if (!recv && !hand) { var t = typeOf(l.desc); o.miss[t] = (o.miss[t] || 0) + 1; }
        }
        o.id += l.idia;
        if (recv) { o.r++; o.idGot += l.idia; }
        if (hand) { o.h++; if (!st.date) o.nodate = true; else if (st.date > o.hd) o.hd = st.date; }   // the spool's handover date is its last item's
        if (recv && !hand) o.wait++;
      });
      return o;
    });
  }

  function loadProject(code, base) {
    if (projP[code]) return projP[code];
    projP[code] = Promise.all([api('getBomProject', { project: code }), api('getItemStates', { project: code }), api('getSpoolGroups', { project: code })])
      .then(function (r) { return summarise(code, r[0].bom, r[1].rows, r[2].rows, base); });
    projP[code].catch(function () { delete projP[code]; });
    return projP[code];
  }

  // a few projects at a time: the Drive script serves everybody, so do not flood it
  function loadProjects(codes, base, onOne) {
    var out = {}, next = 0, done = 0;
    function worker() {
      if (next >= codes.length) return Promise.resolve();
      var c = codes[next++];
      return loadProject(c, base).then(function (recs) { out[c] = recs; if (onOne) onOne(++done, codes.length); return worker(); });
    }
    var all = []; for (var i = 0; i < Math.min(POOL, codes.length); i++) all.push(worker());
    return Promise.all(all).then(function () { return out; });
  }

  var weekSpools = function (base, week) { return base.spools.filter(function (s) { return s.initialWeek === week; }); };
  var codesOf = function (base, list) { var c = {}; list.forEach(function (s) { var m = base.projects[pn(s.project)]; if (m) c[m] = 1; }); return Object.keys(c).sort(); };

  // the week's spools (the scope) joined with their BOM records
  function joinWeek(base, week, recsBy) {
    var recs = {}; Object.keys(recsBy).forEach(function (c) { recsBy[c].forEach(function (o) { recs[o.k] = o; }); });
    var seen = {}, rows = [];
    weekSpools(base, week).forEach(function (s) {
      var k = skey(s.project, s.drawing, s.spool);
      if (seen[k]) return;
      seen[k] = 1;
      var o = recs[k];
      rows.push({ project: s.project, group: (o && o.g != null && o.g !== '' ? o.g : s.group) || '(no group)', o: o || null });
    });
    return rows;
  }

  // start: the week's first day. A spool meets the target when it was handed over before that day (by the end of the week before).
  function totals(rows, start) {
    var t = { scope: rows.length, found: 0, handed: 0, complete: 0, partial: 0, none: 0, pReq: 0, pPlan: 0, pCut: 0, pBev: 0, fReq: 0, fRecv: 0, fHand: 0, miss: {}, groups: {}, projects: {},
      onTime: 0, id: 0, idCut: 0, idRecv: 0, idHanded: 0, idOnTime: 0, front: { spools: 0, id: 0, got: 0, high: 0, mid: 0, low: 0 } };
    rows.forEach(function (row) {
      t.projects[pn(row.project)] = 1;
      var o = row.o;
      if (!o || !o.n) return;
      t.found++;
      var status = o.r === o.n ? 'complete' : (o.r === 0 ? 'none' : 'partial');
      t[status]++;
      t.id += o.id;
      if (o.pBev === o.pReq) t.idCut += o.id;     // a spool's Inch Dia counts only when the whole spool is done for that card
      if (o.fRecv === o.fReq) t.idRecv += o.id;
      if (o.h > 0 && o.wait === 0) {
        t.handed++; t.idHanded += o.id;
        if (!o.nodate && o.hd && start && o.hd < start) { t.onTime++; t.idOnTime += o.id; }
      }
      if (status === 'partial' && o.id) {
        var share = o.idGot / o.id;
        t.front.spools++; t.front.id += o.id; t.front.got += o.idGot;
        t.front[share >= 0.75 ? 'high' : share >= 0.5 ? 'mid' : 'low']++;
      }
      ['pReq', 'pPlan', 'pCut', 'pBev', 'fReq', 'fRecv', 'fHand'].forEach(function (f) { t[f] += o[f]; });
      Object.keys(o.miss).forEach(function (m) { t.miss[m] = (t.miss[m] || 0) + o.miss[m]; });
      var g = t.groups[row.group] = t.groups[row.group] || { complete: 0, partial: 0, none: 0, total: 0 };
      g[status]++; g.total++;
    });
    return t;
  }

  /* ---------- drawing ---------- */
  function kpi(cls, label, value, sub, meter, idLine) {
    return '<div class="kpi-card db-kpi ' + cls + '"><span class="kpi-card__label">' + label + '</span><span class="kpi-card__value">' + value + '</span><span class="kpi-card__sub">' + sub + '</span>' +
      (meter == null ? '' : '<span class="db-meter"><i data-w="' + meter + '"></i></span>') + (idLine ? '<span class="db-kpi__id">' + idLine + '</span>' : '') + '</div>';
  }
  function card(title, hint, body, cls) {
    return '<div class="cp-card db-card ' + (cls || '') + '"><div class="cp-card__head"><h3>' + title + '</h3><span class="cp-hint">' + (hint || '') + '</span></div>' + body + '</div>';
  }
  function bar(label, v, max, cls) {
    return '<div class="db-bar" title="' + label + ': ' + fmt(v) + ' of ' + fmt(max) + '"><span class="db-bar__l">' + label + '</span><span class="db-track"><i class="' + cls + '" data-w="' + (max ? v / max * 100 : 0) + '"></i></span>' +
      '<span class="db-bar__v"><b>' + fmt(v) + '</b> <small>' + pct(v, max) + '%</small></span></div>';
  }
  var PARTS = [['complete', 'Complete material'], ['partial', 'Partial MNA'], ['none', 'Material balance (nothing received)']];
  function stack(c, total, cls, labels, parts) {
    return '<div class="db-stack ' + (cls || '') + '">' + (parts || PARTS).map(function (p) {
      var v = c[p[0]], w = total ? v / total * 100 : 0;
      return v ? '<i class="db-c-' + p[0] + '" data-w="' + w + '" title="' + p[1] + ': ' + fmt(v) + ' (' + pct(v, total) + '%)">' + (labels && w >= 7 ? Math.round(w) + '%' : '') + '</i>' : '';
    }).join('') + '</div>';
  }
  function legend(c, total, parts) {
    return '<div class="db-legend">' + (parts || PARTS).map(function (p) { return '<span><i class="db-c-' + p[0] + '"></i>' + p[1] + (c ? ' <b>' + fmt(c[p[0]]) + '</b> <small>' + pct(c[p[0]], total) + '%</small>' : '') + '</span>'; }).join('') + '</div>';
  }

  var dayBefore = function (iso) { var d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };
  var inch = function (n) { return fmt(Math.round(n)); };

  function targetCard(t, start) {
    if (!start) return card('Handover target', '', '<p class="cp-note">This week has no Planned Start date, so it has no due date.</p>');
    var due = dayBefore(start), over = todayIso() > due, pending = t.scope - t.handed, late = t.handed - t.onTime;
    var c = { ontime: t.onTime, late: late, pending: pending };
    var parts = [['ontime', 'Handed over by the due date'], ['late', 'Handed over after it'], [over ? 'overdue' : 'pending', over ? 'Overdue: not handed over' : 'Still to hand over']];
    if (over) c.overdue = pending;
    var id = t.id ? '<p class="cp-note">In Inch Dia: <b>' + inch(t.idOnTime) + '</b> of ' + inch(t.id) + ' by the due date (' + pct(t.idOnTime, t.id) + '%), ' + inch(t.idHanded - t.idOnTime) + ' after it, ' + inch(t.id - t.idHanded) + ' not handed over.</p>' : '';
    return card('Handover target', 'all ' + fmt(t.scope) + ' spools due by ' + dmy(due) + ', the end of the week before',
      '<div class="db-target"><div class="db-big"><b>' + pct(t.onTime, t.scope) + '%</b><span>' + fmt(t.onTime) + ' of ' + fmt(t.scope) + ' spools on time</span></div>' +
      '<div class="db-target__bar">' + stack(c, t.scope, 'db-stack--big', true, parts) + legend(c, t.scope, parts) + '</div></div>' + id +
      '<p class="cp-note">Dates are those recorded in this system: a handover that is ticked later counts on the day it was ticked.</p>', over && pending ? 'db-card--over' : '');
  }

  function frontCard(t) {
    var f = t.front, body;
    if (!t.id) body = '<p class="cp-note">The BOM data has no Inch Dia yet. It arrives with the next BOM build.</p>';
    else if (!f.spools) body = '<p class="cp-note">No partial spool in this selection.</p>';
    else {
      var rows = [['75% or more', f.high], ['50 to 74%', f.mid], ['Below 50%', f.low]], max = Math.max(f.high, f.mid, f.low);
      body = '<div class="db-target"><div class="db-big db-big--front"><b>' + Math.min(99, pct(f.got, f.id)) + '%</b><span>' + inch(f.got) + ' of ' + inch(f.id) + ' Inch Dia available</span></div>' +
        '<div class="db-target__bar">' + rows.map(function (r) {
          return '<div class="db-bar db-bar--miss"><span class="db-bar__l">' + r[0] + ' ready</span><span class="db-track"><i class="db-c-fit" data-w="' + (max ? r[1] / max * 100 : 0) + '"></i></span><span class="db-bar__v"><b>' + fmt(r[1]) + '</b></span></div>';
        }).join('') + '</div></div><p class="cp-note">Spools by how much of their Inch Dia is available. A guide only: a joint needs both of its parts, and the BOM counts it against one.</p>';
    }
    return card('Work front in partial spools', fmt(f.spools) + ' partial spools', body);
  }

  function trendSvg(points) {
    if (!points) return '<p class="cp-note">Loading the earlier weeks...</p>';
    if (!points.length) return '<p class="cp-note">No week to compare yet.</p>';
    var W = 900, H = 210, L = 42, R = 56, top = 22, bottom = 170;
    var x = function (i) { return points.length === 1 ? (L + W - R) / 2 : L + 30 + i * (W - L - R - 60) / (points.length - 1); };
    var y = function (v) { return bottom - v / 100 * (bottom - top); };
    var series = [['bev', 'Cut and beveled', 'db-s-pipe', -10], ['hand', 'Handed to production', 'db-s-hand', 18], ['ontime', 'Handed over by the due date', 'db-s-ontime', -10]];
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(points.map(function (p) { return p.name + ': cut and beveled ' + p.bev + '%, handed to production ' + p.hand + '%, by the due date ' + p.ontime + '%'; }).join('; ')) + '">';
    [0, 50, 100].forEach(function (v) { svg += '<line class="db-grid" x1="' + L + '" x2="' + (W - 10) + '" y1="' + y(v) + '" y2="' + y(v) + '"/><text class="db-axis" x="4" y="' + (y(v) + 4) + '">' + v + '%</text>'; });
    series.forEach(function (s) {
      if (points.length > 1) svg += '<polyline class="db-line ' + s[2] + '" points="' + points.map(function (p, i) { return x(i) + ',' + y(p[s[0]]); }).join(' ') + '"/>';
      points.forEach(function (p, i) {
        svg += '<circle class="db-pt ' + s[2] + '" cx="' + x(i) + '" cy="' + y(p[s[0]]) + '" r="5"><title>' + esc(p.name) + ' - ' + s[1] + ': ' + p[s[0]] + '%</title></circle>' +
          '<text class="db-val" text-anchor="middle" x="' + x(i) + '" y="' + (y(p[s[0]]) + s[3]) + '">' + p[s[0]] + '%</text>';
      });
    });
    points.forEach(function (p, i) { svg += '<text class="db-axis" text-anchor="middle" x="' + x(i) + '" y="' + (H - 12) + '">' + esc(p.name) + '</text>'; });
    return '<div class="db-legend"><span><i class="db-s-pipe"></i>Cut and beveled</span><span><i class="db-s-hand"></i>Handed to production (dashed)</span><span><i class="db-s-ontime"></i>Handed over by the due date</span></div><div class="db-trend">' + svg + '</svg></div>';
  }

  function render() {
    if (!view) return;
    var g = $('dbGroup').value;
    var groups = {}; view.rows.forEach(function (r) { groups[r.group] = 1; });
    var names = Object.keys(groups).sort(function (a, b) { return a.localeCompare(b, undefined, { numeric: true }); });
    if (g && !groups[g]) g = '';
    $('dbGroup').innerHTML = '<option value="">All groups</option>' + names.map(function (n) { return '<option' + (n === g ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join('');
    var startOf = {}; view.weeks.forEach(function (w) { startOf[w.name] = w.start; });
    var t = totals(g ? view.rows.filter(function (r) { return r.group === g; }) : view.rows, startOf[view.week]), nProj = Object.keys(t.projects).length;

    var idLine = function (v, share) { return t.id ? '<b>' + inch(v) + '</b> Inch Dia' + (share ? ' &middot; ' + pct(v, t.id) + '%' : ' planned') : ''; };
    var html = '<section class="kpi-strip db-kpis" aria-label="Week summary">' +
      kpi('db-kpi--scope', 'Weekly scope', fmt(t.scope), 'spools in ' + nProj + ' project' + (nProj === 1 ? '' : 's'), null, idLine(t.id)) +
      kpi('db-kpi--pipe', 'Cut and beveled', pct(t.pBev, t.pReq) + '%', fmt(t.pBev) + ' of ' + fmt(t.pReq) + ' pipe pieces', pct(t.pBev, t.pReq), idLine(t.idCut, true)) +
      kpi('db-kpi--fit', 'Received from store', pct(t.fRecv, t.fReq) + '%', fmt(t.fRecv) + ' of ' + fmt(t.fReq) + ' fittings and items', pct(t.fRecv, t.fReq), idLine(t.idRecv, true)) +
      kpi('db-kpi--hand', 'Handed to production', pct(t.handed, t.scope) + '%', fmt(t.handed) + ' of ' + fmt(t.scope) + ' spools', pct(t.handed, t.scope), idLine(t.idHanded, true)) + '</section>';

    html += targetCard(t, startOf[view.week]);

    html += '<div class="db-two">' +
      card('Pipes: cutting station', 'pipe lines of the BOM', bar('Required', t.pReq, t.pReq, 'db-c-pipe db-c-soft') + bar('Planned', t.pPlan, t.pReq, 'db-c-pipe') + bar('Cut', t.pCut, t.pReq, 'db-c-pipe') + bar('Beveled', t.pBev, t.pReq, 'db-c-pipe') +
        '<p class="cp-note">' + fmt(t.pReq - t.pPlan) + ' not yet in a cutting plan</p>') +
      card('Fittings: store to production', 'all items other than pipe', bar('Required', t.fReq, t.fReq, 'db-c-fit db-c-soft') + bar('Received', t.fRecv, t.fReq, 'db-c-fit') + bar('Handed over', t.fHand, t.fReq, 'db-c-fit') +
        '<p class="cp-note">' + fmt(t.fReq - t.fRecv) + ' still to be received from store</p>') + '</div>';

    html += card('MNA status', fmt(t.found) + ' spools with a BOM', stack(t, t.found, 'db-stack--big', true) + legend(t, t.found) +
      (t.scope > t.found ? '<p class="cp-note">' + fmt(t.scope - t.found) + ' spool(s) of the week have no BOM lines yet, so they have no material status.</p>' : ''));

    html += frontCard(t);

    var gNames = Object.keys(t.groups).sort(function (a, b) { return t.groups[b].total - t.groups[a].total || a.localeCompare(b); });
    var gMax = gNames.length ? t.groups[gNames[0]].total : 0;
    var miss = Object.keys(t.miss).sort(function (a, b) { return (a === 'Others') - (b === 'Others') || t.miss[b] - t.miss[a]; });
    var missMax = miss.reduce(function (m, k) { return Math.max(m, t.miss[k]); }, 0);
    html += '<div class="db-two">' +
      card('Material status by group', 'spools', (gNames.map(function (n) {
        var c = t.groups[n];
        return '<div class="db-grow"><span class="db-bar__l">' + esc(n) + '</span><span><span class="db-gwrap" style="width:' + Math.max(8, c.total / gMax * 100) + '%">' + stack(c, c.total) + '</span></span><span class="db-bar__v"><b>' + fmt(c.total) + '</b></span></div>';
      }).join('') || '<p class="cp-note">Nothing to show.</p>') + legend()) +
      card('Not yet received, by type', fmt(t.fReq - t.fRecv) + ' items', miss.filter(function (k) { return t.miss[k]; }).map(function (k) {
        return '<div class="db-bar db-bar--miss"><span class="db-bar__l">' + k + '</span><span class="db-track"><i class="db-c-fit" data-w="' + (t.miss[k] / missMax * 100) + '"></i></span><span class="db-bar__v"><b>' + fmt(t.miss[k]) + '</b></span></div>';
      }).join('') || '<p class="cp-note">Everything has been received.</p>') + '</div>';

    var points = view.trend && view.trend.map(function (w) {
      var x = totals(g ? w.rows.filter(function (r) { return r.group === g; }) : w.rows, startOf[w.name]);
      return { name: w.name, bev: pct(x.pBev, x.pReq), hand: pct(x.handed, x.scope), ontime: pct(x.onTime, x.scope) };
    });
    html += card('Week by week', 'how complete each week is today, from ' + dmy(TREND_FROM), trendSvg(points));
    html += '<p class="cp-note db-foot">On the top cards a spool\'s Inch Dia (from the BOM) counts only when the whole spool is done for that card. A week holds the spools whose Initial Week Planned it is, even if they were moved later. Counted from what is ticked in this system. A pipe counts as cut and beveled when both are ticked, or when it has already been handed over. A spool counts as handed to production when everything received for it has been handed over.</p>';

    var body = $('dbBody');
    body.innerHTML = html;
    var bars = body.querySelectorAll('[data-w]');
    void body.offsetWidth;   // so that the bars grow from zero
    Array.prototype.forEach.call(bars, function (el) { el.style.width = el.getAttribute('data-w') + '%'; });
  }

  /* ---------- loading and the saved copy ---------- */
  function note(text, cls, progress) {
    $('dbNote').textContent = text; $('dbNote').className = cls || '';
    $('dbProgress').hidden = progress == null;
    if (progress != null) $('dbProgress').firstElementChild.style.width = Math.max(4, progress * 100) + '%';
  }
  function readCache() { try { return JSON.parse(localStorage.getItem(CACHE_KEY)); } catch (e) { return null; } }
  function writeCache() { try { localStorage.setItem(CACHE_KEY, JSON.stringify(view)); } catch (e) {} }   // only a convenience: shows the last view at once next time

  function fillWeeks(list, sel) {
    $('dbWeek').innerHTML = list.map(function (w) { return '<option value="' + esc(w.name) + '"' + (w.name === sel ? ' selected' : '') + '>' + esc(w.name) + (w.start ? ' - from ' + dmy(w.start) : '') + '</option>'; }).join('');
  }

  function load(week) {
    var mine = ++run, saved = view && view.week === week;
    if (!saved) { view = null; $('dbBody').innerHTML = '<div class="cp-card"><p class="cp-note" style="margin:0">Collecting the week\'s data. The first time takes about half a minute.</p></div>'; }
    $('dbRefresh').disabled = true;
    note(saved ? 'Showing the view saved on ' + stamp(view.at) + '. Updating...' : 'Reading the spool list and cutting status...', '', 0);
    var base, rows;
    return loadBase().then(function (b) {
      if (mine !== run) return null;
      base = b; weeks = b.weeks;
      if (!weeks.length) throw new Error('No spool has an Initial Week Planned yet. It arrives with the next data sync.');
      if (!weeks.some(function (w) { return w.name === week; })) {   // default: the week that has started most recently
        var today = todayIso();
        week = (weeks.filter(function (w) { return w.start && w.start <= today; })[0] || weeks[0]).name;
      }
      curWeek = week; fillWeeks(weeks, week);
      return loadProjects(codesOf(b, weekSpools(b, week)), b, function (n, of) { if (mine === run) note('Loading project ' + n + ' of ' + of + '...', '', n / of); });
    }).then(function (recs) {
      if (!recs || mine !== run) return null;
      rows = joinWeek(base, curWeek, recs);
      view = { week: curWeek, at: Date.now(), weeks: weeks, rows: rows, trend: null };
      render();
      note('Week loaded. Adding the week-by-week comparison...', '', 1);
      var sel = weeks.filter(function (w) { return w.name === curWeek; })[0], today = todayIso(), until = sel.start > today ? sel.start : today;
      var tw = weeks.filter(function (w) { return w.start >= TREND_FROM && w.start <= until; }).slice(0, TREND_MAX).reverse();
      var all = []; tw.forEach(function (w) { all = all.concat(weekSpools(base, w.name)); });
      return loadProjects(codesOf(base, all), base).then(function (more) {
        if (mine !== run) return;
        view.trend = tw.map(function (w) { return { name: w.name, rows: joinWeek(base, w.name, more) }; });
        view.at = Date.now();
        render(); writeCache();
        note('Updated ' + stamp(view.at), 'cp-ok');
      });
    }).catch(function (e) {
      if (mine !== run) return;
      note('Could not load: ' + e.message + (view ? ' (showing the view saved on ' + stamp(view.at) + ')' : ''), 'cp-bad');
      if (!view) $('dbBody').innerHTML = '';
    }).then(function () { if (mine === run) $('dbRefresh').disabled = false; });
  }

  function forget() { baseP = null; projP = {}; baseAt = 0; }

  CS.sectionHooks.dashboard = function () {
    if (!view) {
      view = readCache();
      if (view && view.rows) { curWeek = view.week; fillWeeks(view.weeks, curWeek); render(); } else view = null;
    }
    if (baseAt && Date.now() - baseAt < STALE_MS && view) return;
    if (baseAt) forget();
    if (!baseP) load(curWeek);
  };
  $('dbWeek').onchange = function () { curWeek = this.value; load(curWeek); };
  $('dbGroup').onchange = render;
  $('dbRefresh').onclick = function () { forget(); load(curWeek); };
})();
