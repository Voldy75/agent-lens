'use strict';

/**
 * Deterministic isometric layout.
 *
 * Two rules matter more than the packing itself:
 *   1. Same input -> same output. No randomness, no Date, no Math.random.
 *   2. Positions are sticky. Once a module has a cell it keeps it, so adding a
 *      new module never reshuffles the city the user has learned.
 *
 * Stickiness is stored as { moduleId: { district, cell } } in state.layout.pinned.
 * Cell indices are relative to the district, so a district can move or grow
 * without disturbing what's inside it.
 */

const CELL = 2.2;   // grid units between building origins
const PAD = 0.6;    // district padding around its buildings
const GAP = 3.2;    // gap between districts (iso needs more air than it looks like)
const ROW_WIDTH = 21; // wrap districts past this many grid units

function cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

function heightFor(m) {
  if (m.status === 'ghost' || !m.lines) return 1.0;
  return Math.round((0.7 + Math.min(3.2, m.lines / 450)) * 100) / 100;
}

function layout(state) {
  const pinned = (state.layout && state.layout.pinned) || {};
  const nextPinned = {};

  const districts = [...state.districts].sort(
    (a, b) => (a.order ?? 99) - (b.order ?? 99) || cmp(a.id, b.id)
  );

  const placedDistricts = [];
  const coords = {};
  let cx = 0, cy = 0, rowH = 0;

  for (const d of districts) {
    // Stable member order: biggest first, ties broken by id.
    const mods = state.modules
      .filter((m) => m.district === d.id)
      .sort((a, b) => (b.lines || 0) - (a.lines || 0) || cmp(a.id, b.id));

    if (!mods.length) continue;

    const cols = Math.max(1, Math.ceil(Math.sqrt(mods.length)));

    // Honour existing cells first, then fill the gaps in order.
    const taken = new Map();
    const floating = [];
    for (const m of mods) {
      const p = pinned[m.id];
      if (p && p.district === d.id && Number.isInteger(p.cell) && !taken.has(p.cell)) {
        taken.set(p.cell, m.id);
      } else {
        floating.push(m);
      }
    }
    let probe = 0;
    for (const m of floating) {
      while (taken.has(probe)) probe++;
      taken.set(probe, m.id);
    }

    const maxCell = Math.max(...taken.keys());
    const rows = Math.floor(maxCell / cols) + 1;
    const w = cols * CELL + PAD * 2;
    const h = rows * CELL + PAD * 2;

    if (cx > 0 && cx + w > ROW_WIDTH) { cx = 0; cy += rowH + GAP; rowH = 0; }

    placedDistricts.push({ id: d.id, name: d.name, x: cx, y: cy, w, h });

    for (const [cell, id] of taken) {
      coords[id] = {
        x: +(cx + PAD + (cell % cols) * CELL).toFixed(2),
        y: +(cy + PAD + Math.floor(cell / cols) * CELL).toFixed(2)
      };
      nextPinned[id] = { district: d.id, cell };
    }

    cx += w + GAP;
    rowH = Math.max(rowH, h);
  }

  // Anything whose district was removed or misspelled: park it, don't drop it.
  const orphans = state.modules.filter((m) => !coords[m.id]).sort((a, b) => cmp(a.id, b.id));
  if (orphans.length) {
    const ox = 0, oy = cy + rowH + GAP;
    placedDistricts.push({
      id: '__unplaced', name: 'Unplaced',
      x: ox, y: oy, w: orphans.length * CELL + PAD * 2, h: CELL + PAD * 2
    });
    orphans.forEach((m, i) => {
      coords[m.id] = { x: +(ox + PAD + i * CELL).toFixed(2), y: +(oy + PAD).toFixed(2) };
    });
  }

  const modules = state.modules.map((m) => ({
    ...m,
    x: coords[m.id].x,
    y: coords[m.id].y,
    h: heightFor(m)
  }));

  return { districts: placedDistricts, modules, pinned: nextPinned, orphans: orphans.map((m) => m.id) };
}

module.exports = { layout, heightFor, CELL, PAD, GAP };
