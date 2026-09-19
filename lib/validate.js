'use strict';

/**
 * Validation is deliberately forgiving. A missing section turns its tab off;
 * it does not stop the report. The tool's whole promise is that it still says
 * something useful when an adapter is absent.
 *
 * Returns { state, warnings }. Throws only when the file isn't a project at all.
 */

const STATUSES = new Set(['built', 'active', 'flag', 'ghost', 'ext']);
const PLAN_STATUSES = new Set(['done', 'active', 'blocked', 'pending']);

function validate(raw) {
  const w = [];
  if (!raw || typeof raw !== 'object') throw new Error('state must be a JSON object');
  const s = { ...raw };

  s.project = s.project || {};
  if (!s.project.name) { s.project.name = 'unnamed project'; w.push('project.name missing'); }

  s.districts = Array.isArray(s.districts) ? s.districts : [];
  s.modules = Array.isArray(s.modules) ? s.modules : [];
  s.edges = Array.isArray(s.edges) ? s.edges : [];
  s.flows = Array.isArray(s.flows) ? s.flows : [];
  s.plan = Array.isArray(s.plan) ? s.plan : [];
  s.blockers = Array.isArray(s.blockers) ? s.blockers : [];
  s.activity = Array.isArray(s.activity) ? s.activity : [];
  s.layout = s.layout || { pinned: {} };

  const ids = new Set();
  s.modules = s.modules.filter((m) => {
    if (!m.id) { w.push('module without id dropped'); return false; }
    if (ids.has(m.id)) { w.push(`duplicate module id "${m.id}" dropped`); return false; }
    ids.add(m.id);
    if (!STATUSES.has(m.status)) { w.push(`module "${m.id}" has unknown status "${m.status}", treated as built`); m.status = 'built'; }
    m.name = m.name || m.id;
    m.files = m.files || 0;
    m.lines = m.lines || 0;
    m.sources = Array.isArray(m.sources) ? m.sources : [];
    m.stack = Array.isArray(m.stack) ? m.stack : [];
    return true;
  });

  // Districts referenced but not declared get created rather than swallowing modules.
  const dIds = new Set(s.districts.map((d) => d.id));
  for (const m of s.modules) {
    if (!m.district) m.district = 'unsorted';
    if (!dIds.has(m.district)) {
      s.districts.push({ id: m.district, name: m.district, order: 98 });
      dIds.add(m.district);
      w.push(`district "${m.district}" was referenced but not declared`);
    }
  }

  s.edges = s.edges.filter((e) => {
    const [a, b] = e;
    if (!ids.has(a) || !ids.has(b)) { w.push(`edge ${a}->${b} references an unknown module`); return false; }
    return true;
  });

  s.flows = s.flows.filter((f) => {
    if (!Array.isArray(f.path) || f.path.length < 2) { w.push(`flow "${f.id || '?'}" needs at least two stops`); return false; }
    const bad = f.path.find((p) => !ids.has(p.module));
    if (bad) { w.push(`flow "${f.id}" references unknown module "${bad.module}"`); return false; }
    return true;
  });

  s.plan.forEach((p, i) => {
    if (!PLAN_STATUSES.has(p.status)) { w.push(`plan step ${p.n ?? i} has unknown status "${p.status}"`); p.status = 'pending'; }
    p.evidence = Array.isArray(p.evidence) ? p.evidence : [];
    p.modules = Array.isArray(p.modules) ? p.modules.filter((m) => ids.has(m)) : [];
  });

  // Sections that switch tabs on and off.
  s.has = {
    map: s.modules.length > 0,
    flows: s.flows.length > 0,
    plan: s.plan.length > 0,
    health: !!(s.health && ((s.health.stats || []).length || (s.health.rows || []).length)),
    cost: !!(s.cost && s.cost.available !== false && (s.cost.stats || []).length)
  };
  if (!s.has.cost) w.push('no cost data — Cost tab hidden (no agent session logs found?)');
  if (!s.has.flows) w.push('no flows defined — map will render without playback');

  return { state: s, warnings: w };
}

module.exports = { validate };
