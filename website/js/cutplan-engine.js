// Cutting-plan engine (1D: pipes and structural profiles). Pure functions, no DOM - runs in browser and Node.
// Pieces are matched to bars by Item Code only. Only the bars the user uploads are used; pieces that
// fit no bar are returned as `unplaced` (to be marked MNA). Kerf is charged for every piece, including
// the last one, which reproduces the remain figures in the existing cutting-plan PDFs.
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

    const used = [];
    for (const [item, g] of byItem) {
      const open = [], free = g.bars.slice().sort((a, b) => a.length - b.length);
      g.pieces.sort((a, b) => b.length - a.length).forEach((p) => {
        const need = p.length + o.kerf;
        let best = null;
        for (const b of open) if (b.remain >= need && (!best || b.remain < best.remain)) best = b;
        if (!best) {
          const i = free.findIndex((b) => b.length - o.trim >= need);
          if (i >= 0) {
            const b = free.splice(i, 1)[0];
            best = { ...b, item, startLength: b.length, remain: b.length - o.trim, pieces: [] };
            open.push(best);
          }
        }
        if (!best) { unplaced.push({ ...p, item, reason: g.bars.length ? 'No pipe long enough' : 'No pipe of this Item Code' }); return; }
        best.pieces.push(p);
        best.remain -= need;
      });
      used.push(...open);
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
