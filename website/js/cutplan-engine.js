// Cutting-plan engine (1D: pipes and structural profiles). Pure functions, no DOM - runs in browser and Node.
// Pieces are matched to bars by Item Code only. Only the bars the user uploads are used; pieces that
// fit no bar are returned as `unplaced` (to be marked MNA). Kerf is charged for every piece, including
// the last one, which reproduces the remain figures in the existing cutting-plan PDFs. Exception: when a piece fits
// the pipe only without its kerf (for example a 6000 piece on a 6000 pipe, or 5995 on 6000) it is still placed, because
// the saw cut after the last piece runs through the leftover end; it then takes no kerf and the remain is what is left.
// That looser rule (and an exact search) only runs when the original rule leaves pieces over.
(function (root) {
  const norm = (v) => String(v == null ? '' : v).trim().toUpperCase();

  // pieces: [{project, drawing, spool, item, length, group, bevel, qty}]
  // bars:   [{barcode, item, length, control, heat}]   (length = current remaining length)
  // opts:   {kerf, trim}
  function plan(pieces, bars, opts) {
    const o = Object.assign({ kerf: 8, trim: 0 }, opts);
    const errors = [], unplaced = [], byItem = new Map();
    const slot = (k) => { if (!byItem.has(k)) byItem.set(k, { pieces: [], bars: [] }); return byItem.get(k); };

    pieces.forEach((p, i) => {
      const len = Number(p.length), qty = Math.max(1, Math.round(Number(p.qty) || 1));
      if (!norm(p.item)) { errors.push(`Cut list row ${i + 2}: missing Item Code`); return; }
      if (!(len > 0)) { errors.push(`Cut list row ${i + 2}: invalid length "${p.length}"`); return; }
      for (let q = 0; q < qty; q++) slot(norm(p.item)).pieces.push({ ...p, length: len, row: i + 2 });
    });
    const seen = new Set();
    bars.forEach((b, i) => {
      const len = Number(b.length), code = norm(b.barcode);
      if (!norm(b.item)) { errors.push(`Pipe list row ${i + 2}: missing Item Code`); return; }
      if (!code) { errors.push(`Pipe list row ${i + 2}: missing Barcode`); return; }
      if (seen.has(code)) { errors.push(`Pipe list row ${i + 2}: duplicate Barcode ${b.barcode}`); return; }
      if (!(len > 0)) { errors.push(`Pipe list row ${i + 2}: invalid length "${b.length}"`); return; }
      seen.add(code);
      slot(norm(b.item)).bars.push({ ...b, length: len });
    });

    // Exact search, used only when the quick first-fit pass leaves pieces over: it can find a tighter combination
    // (for example 46 pieces on 9 pipes). A pipe takes pieces while  sum + kerf x (count - 1) <= its length - trim.
    // Gives up after a node budget and then the quick result stands.
    function search(pieces, bars, o) {
      const items = pieces.slice().sort((a, b) => b.length - a.length);
      const bs = bars.map((b) => ({ b, cap: b.length - o.trim, s: 0, list: [] })).sort((x, y) => x.cap - y.cap);
      let nodes = 0;
      const dfs = (i) => {
        if (i === items.length) return true;
        if (++nodes > 400000) return false;
        const seen = new Set();
        for (const x of bs) {
          const key = x.cap + ':' + x.s + ':' + x.list.length;
          if (seen.has(key)) continue;
          seen.add(key);
          if (x.s + items[i].length + o.kerf * x.list.length <= x.cap) {
            x.s += items[i].length; x.list.push(items[i]);
            if (dfs(i + 1)) return true;
            x.s -= items[i].length; x.list.pop();
          }
        }
        return false;
      };
      if (!dfs(0)) return null;
      return bs.filter((x) => x.list.length).map((x) => {
        const left = x.cap - x.s - o.kerf * x.list.length;
        return { ...x.b, startLength: x.b.length, remain: left >= 0 ? left : x.cap - x.s, pieces: x.list };
      });
    }

    // Quick first-fit pass. tail = false is the original rule (every piece takes its kerf, so a piece must fit with it);
    // tail = true also accepts a piece that fits only without kerf (6000 on a 6000 pipe, 5995 on 6000): the saw cut after the last
    // piece runs through the leftover end, so that piece takes no kerf and the remain is what is left.
    function greedy(item, g, tail) {
      const open = [], miss = [], free = g.bars.slice().sort((a, b) => a.length - b.length);
      g.pieces.slice().sort((a, b) => b.length - a.length).forEach((p) => {
        const need = p.length + o.kerf, min = tail ? p.length : need;
        let best = null;
        for (const b of open) if (b.remain >= min && (!best || b.remain < best.remain)) best = b;
        if (!best) {
          const i = free.findIndex((b) => b.length - o.trim >= min);
          if (i >= 0) {
            const b = free.splice(i, 1)[0];
            best = { ...b, item, startLength: b.length, remain: b.length - o.trim, pieces: [] };
            open.push(best);
          }
        }
        if (!best) { miss.push({ ...p, item, reason: g.bars.length ? 'No pipe long enough' : 'No pipe of this Item Code' }); return; }
        best.pieces.push(p);
        best.remain -= best.remain >= need ? need : p.length;
      });
      return { open, miss };
    }

    const used = [];
    for (const [item, g] of byItem) {
      // the original rule decides whenever it places everything, so existing plans do not change; only when pieces are
      // left over the looser rule, and then the exact search, are tried (the one that leaves the fewest pieces wins)
      let r = greedy(item, g, false);
      if (r.miss.length) {
        const t = greedy(item, g, true);
        if (t.miss.length < r.miss.length) r = t;
      }
      if (r.miss.length && g.bars.length) {
        const found = search(g.pieces, g.bars, o);
        if (found) r = { open: found.map((b) => ({ ...b, item })), miss: [] };
      }
      unplaced.push(...r.miss);
      used.push(...r.open);
    }

    used.sort((a, b) => (a.item + a.barcode).localeCompare(b.item + b.barcode));
    const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);
    const startMm = sum(used, (b) => b.startLength), netMm = sum(used, (b) => sum(b.pieces, (p) => p.length));
    const placed = sum(used, (b) => b.pieces.length);
    return {
      bars: used, unplaced, errors, opts: o,
      summary: {
        pieces: placed + unplaced.length, placed, unplaced: unplaced.length, bars: used.length,
        startMm, netMm, remainMm: sum(used, (b) => b.remain), yieldPct: startMm ? (netMm / startMm) * 100 : 0,
      },
    };
  }

  const api = { plan, norm };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.CutPlan = api;
})(typeof self !== 'undefined' ? self : this);
