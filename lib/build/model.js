'use strict';
const path = require('path');
const { resolveImport } = require('../collect/files');
const { ago } = require('../collect/git');

/**
 * Everything here is deterministic. No model is called. The LLM authoring pass
 * later replaces names and descriptions in place — it never changes the shape.
 */

const SRC_ROOTS = ['src', 'app', 'lib', 'server', 'packages', 'apps', 'source'];
const MAX_MODULES = 42;

/** The directory that best represents a file. A module is a folder, never a file. */
function moduleKeyFor(p) {
  const dirs = p.split('/').slice(0, -1);
  if (!dirs.length) return 'root';
  const depth = SRC_ROOTS.includes(dirs[0]) ? 2 : 1;
  return dirs.slice(0, Math.min(depth, dirs.length)).join('/');
}

function nextSeg(key, p) {
  const rest = p.slice(key.length + 1).split('/');
  return rest.length > 1 ? rest[0] : null;
}

function splittable(g) {
  const segs = new Set(g.files.map((f) => nextSeg(g.key, f.path)).filter(Boolean));
  if (segs.size > 1) return true;
  return g.files.length > 5; // no subfolders: split into per-file buildings
}

function splitGroup(g) {
  const out = new Map();
  const loose = { key: g.key, files: [], lines: 0 };
  const hasSubdirs = new Set(g.files.map((f) => nextSeg(g.key, f.path)).filter(Boolean)).size > 1;
  for (const f of g.files) {
    const seg = nextSeg(g.key, f.path);
    const key = hasSubdirs
      ? (seg ? g.key + '/' + seg : null)
      : g.key + '/' + f.path.split('/').pop().replace(/\.[a-z]+$/i, '');
    if (!key) { loose.files.push(f); loose.lines += f.lines; continue; }
    if (!out.has(key)) out.set(key, { key, files: [], lines: 0 });
    const t = out.get(key); t.files.push(f); t.lines += f.lines;
  }
  const res = [...out.values()];
  if (loose.files.length) res.push(loose);
  return res.length > 1 ? res : [g];
}

function districtFor(key) {
  const parts = key.split('/');
  return parts.length > 1 ? parts[0] : key;
}

const titleize = (s) =>
  s.split('/').pop().replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

function buildModules(files, gitData) {
  const groups = new Map();
  for (const f of files) {
    if (f.test) continue;
    const key = moduleKeyFor(f.path);
    if (!groups.has(key)) groups.set(key, { key, files: [], lines: 0 });
    const g = groups.get(key);
    g.files.push(f); g.lines += f.lines;
  }

  // Adaptive granularity. One folder per module is too coarse for flat repos
  // (a single 10k-line src/core is a useless building) and too fine for deep
  // ones. Split the biggest groups one level deeper until the map has enough
  // detail to be worth looking at.
  let list = [...groups.values()].sort((a, b) => b.lines - a.lines);
  const TARGET_MIN = 10;
  for (let guard = 0; guard < 40 && list.length < TARGET_MIN; guard++) {
    const big = list.find((g) => g.files.length > 3 && g.lines > 600 && splittable(g));
    if (!big) break;
    list = list.filter((g) => g !== big).concat(splitGroup(big));
    list.sort((a, b) => b.lines - a.lines);
  }
  if (list.length > MAX_MODULES) {
    const keep = new Map(list.slice(0, MAX_MODULES - 1).map((g) => [g.key, g]));
    const other = { key: '_other', files: [], lines: 0 };
    for (const g of list.slice(MAX_MODULES - 1)) { other.files.push(...g.files); other.lines += g.lines; }
    list = [...keep.values(), other];
  }

  // A module counts as tested when a test file actually imports something in it.
  // Path-based guessing breaks on repos with a single top-level test/ folder.
  const owner = new Map();
  for (const g of list) for (const f of g.files) owner.set(f.path, g.key);
  const fileSet = new Set(files.map((f) => f.path));
  const testsByKey = new Map();
  for (const f of files) {
    if (!f.test) continue;
    const hit = new Set();
    for (const spec of f.imports) {
      const t = resolveImport(f.path, spec, fileSet);
      const k = t && owner.get(t);
      if (k) hit.add(k);
    }
    for (const k of hit) testsByKey.set(k, (testsByKey.get(k) || 0) + 1);
  }

  // "Rewritten a lot" is relative to this repo, not an absolute commit count.
  const churnValues = list.map((g) => g.files.reduce((m, f) => Math.max(m, (gitData.churn[f.path] || {}).commits || 0), 0)).sort((a, b) => a - b);
  const p85 = churnValues[Math.floor(churnValues.length * 0.85)] || 0;
  const hotThreshold = Math.max(4, p85);

  const modules = list.map((g) => {
    const churn = g.files.reduce((m, f) => Math.max(m, (gitData.churn[f.path] || {}).commits || 0), 0);
    const lastTouch = g.files.reduce((m, f) => {
      const c = gitData.churn[f.path];
      return c && c.last && (!m || c.last > m) ? c.last : m;
    }, null);
    const tests = testsByKey.get(g.key) || 0;
    const days = lastTouch ? ago(lastTouch) : 9999;

    let status = 'built';
    if (churn >= hotThreshold && tests === 0 && churn >= 4) status = 'flag';
    else if (days <= 7) status = 'active';

    return {
      id: g.key === '_other' ? 'other' : g.key.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase(),
      name: g.key === '_other' ? 'Everything else' : titleize(g.key),
      district: g.key === '_other' ? 'root' : districtFor(g.key),
      status,
      files: g.files.length,
      lines: g.lines,
      description: '',
      sources: g.files.slice(0, 5).map((f) => f.path),
      stack: [...new Set(g.files.map((f) => f.lang))].slice(0, 3).map((s) => s.toUpperCase()),
      _key: g.key, _churn: churn, _tests: tests, _days: days,
      _paths: new Set(g.files.map((f) => f.path))
    };
  });

  const districts = [...new Set(modules.map((m) => m.district))].sort()
    .map((d, i) => ({ id: d, name: titleize(d) || d, order: i + 1 }));

  return { modules, districts };
}

function buildEdges(files, modules) {
  const fileSet = new Set(files.map((f) => f.path));
  const owner = new Map();
  for (const m of modules) for (const p of m._paths) owner.set(p, m.id);

  const counts = new Map();
  for (const f of files) {
    const from = owner.get(f.path);
    if (!from) continue;
    for (const spec of f.imports) {
      const target = resolveImport(f.path, spec, fileSet);
      if (!target) continue;
      const to = owner.get(target);
      if (!to || to === from) continue;
      const k = from + '>' + to;
      counts.set(k, (counts.get(k) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 90)
    .map(([k]) => k.split('>'));
}

function buildHealth(files, modules, gitData, deps) {
  // A file committed once was written, not rewritten; only list repeat changes.
  const rewrites = Object.entries(gitData.churn)
    .filter(([p, c]) => c.commits >= 2 && files.some((f) => f.path === p && !f.test))
    .sort((a, b) => b[1].commits - a[1].commits)
    .slice(0, 6);

  const untested = modules.filter((m) => m._tests === 0).length;
  const hotspots = modules.filter((m) => m.status === 'flag').length;

  const rows = rewrites.map(([p, c]) => {
    const mod = modules.find((m) => m._paths.has(p));
    const tested = mod && mod._tests > 0;
    return {
      where: p,
      rewrites: c.commits,
      tests: tested ? `${mod._tests} test file${mod._tests === 1 ? '' : 's'}` : null,
      meaning: c.commits >= 8
        ? 'Changed more than almost anything else here. Repeated rewrites usually mean the requirement never settled.'
        : tested
          ? 'Reworked a few times but covered by tests. Low risk.'
          : c.commits >= 3
            ? 'Reworked several times with no test covering it. Worth a look before you build on top of it.'
            : 'Changed twice and not covered by a test yet.'
    };
  });

  return {
    stats: [
      { label: 'Rewrite hotspots', value: String(hotspots), tone: hotspots ? 'warn' : null, note: 'files changed 5+ times' },
      { label: 'Untested modules', value: `${Math.round((untested / Math.max(1, modules.length)) * 100)}%`, tone: untested ? 'warn' : null, note: `${untested} of ${modules.length} have no test` },
      { label: 'Source files', value: String(files.filter((f) => !f.test).length), note: (() => { const t = files.filter((f) => f.test).length; return `${t} test file${t === 1 ? '' : 's'}`; })() },
      { label: 'Dependencies', value: String(deps.length), note: 'declared in package.json' }
    ],
    rows
  };
}

function buildCost(sessions, modules) {
  // Sessions that never got a reply (opened and closed) have nothing to show.
  if (!sessions.available || !sessions.messages) return { available: false };
  const cache = sessions.cache || 0;
  // Same measure as the weekly chart below: everything the model read or wrote.
  const total = sessions.input + cache + sessions.output;
  const M = (n) => (n / 1e6).toFixed(n < 1e6 ? 2 : 1) + 'M';
  const cachePct = total ? Math.floor((cache / total) * 100) : 0; // never claim 100%: the agent did write something

  const days = Object.entries(sessions.days).sort();
  const buckets = new Map();
  for (const [d, v] of days) {
    const wk = new Date(d + 'T00:00:00Z');
    wk.setUTCDate(wk.getUTCDate() - wk.getUTCDay());
    const k = wk.toISOString().slice(0, 10);
    buckets.set(k, (buckets.get(k) || 0) + v);
  }
  const series = [...buckets.entries()].slice(-10).map(([k, v]) => ({
    label: new Date(k + 'T00:00:00Z').toUTCString().slice(5, 11),
    value: +(v / 1e6).toFixed(2),
    display: (v / 1e6).toFixed(2) + 'M'
  }));

  // Attribute by which files a session touched. Heuristic by construction.
  const byMod = new Map();
  for (const [file, n] of Object.entries(sessions.touched)) {
    // Agents on Windows log backslash paths; module paths use forward slashes.
    const rel = file.replace(/\\/g, '/').replace(/^.*?\/(?=src\/|app\/|lib\/)/, '');
    const m = modules.find((x) => [...x._paths].some((p) => rel.endsWith(p)));
    if (m) byMod.set(m.id, (byMod.get(m.id) || 0) + n);
  }
  // Keyed by module id so an authoring pass can rename the rows later.
  const byArea = [...byMod.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([id, value]) => ({ id, label: modules.find((x) => x.id === id).name, value, display: `${value} edit${value === 1 ? '' : 's'}` }));

  return {
    available: true,
    stats: [
      { label: 'Sessions', value: String(sessions.sessions), note: sessions.agents.join(' + ') },
      { label: 'Tokens', value: M(total), note: cachePct ? `${cachePct}% was re-reading earlier context (cached, billed cheaper)` : 'read + written' },
      { label: 'Written by the agent', value: M(sessions.output), note: 'code and replies it produced' },
      { label: 'Replies', value: String(sessions.messages), note: 'times the agent responded' }
    ],
    seriesLabel: 'Tokens per week',
    series,
    byArea,
    caveat: 'Most tokens in a long agent session are the agent re-reading the conversation so far, which is why the total is large. Tokens are spent per message, not per file. The split above is attributed by which files a session touched — treat it as a rough indication, not an invoice. No pricing is applied because rates differ by model and plan.'
  };
}

module.exports = { buildModules, buildEdges, buildHealth, buildCost, moduleKeyFor };
