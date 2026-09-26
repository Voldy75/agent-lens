'use strict';
const fs = require('fs');
const path = require('path');

/**
 * "Is my agent going in circles?"
 *
 * Three signals, each over the last WINDOW_DAYS, each worded for someone who
 * does not read code and paired with something to ask the agent:
 *
 *   rework   — the same file keeps being changed (git commits, or the agent
 *              editing it in session after session)
 *   failure  — the same command failure keeps coming back across sessions
 *   stalled  — the plan checklist has not moved for a week while work goes on
 *
 * Thresholds are deliberately conservative: a false alarm teaches people to
 * ignore the section, which is worse than a missed one.
 */

const DAY = 864e5;
const WINDOW_DAYS = 14;
const REWORK_COMMITS = 5;
const REWORK_SESSIONS = 4;
const FAILURE_COUNT = 3;
const FAILURE_SESSIONS = 2;
const STALL_DAYS = 7;
const STALL_COMMITS = 10;
const STALL_WORK_DAYS = 4;

const days = (ms) => Math.max(1, Math.round(ms / DAY));
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Sessions (from an events map entry) whose latest event is inside the window. */
const sessionsSince = (entry, since) => Object.values(entry.sessions || {}).filter((ts) => ts && ts >= since).length;

function relTo(root, file) {
  if (!path.isAbsolute(file)) return file.replace(/\\/g, '/');
  const roots = [path.resolve(root)];
  try { roots.push(fs.realpathSync(root)); } catch { /* gone */ }
  for (const r of roots) {
    const rel = path.relative(r, file);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return rel.replace(/\\/g, '/');
  }
  return null; // edited outside this project
}

function buildCircles({ root, gitData, sessions, plans, plan, modules, files, now = Date.now() }) {
  const since = now - WINDOW_DAYS * DAY;
  const out = [];
  const source = new Set(files.filter((f) => !f.test).map((f) => f.path));
  const moduleOf = (file) => modules.find((m) => m._paths && m._paths.has(file));
  const stepFor = (mod) => mod && plan.find((p) => p.status !== 'done' && (p.modules || []).includes(mod.id));

  /* ---- rework: the same file keeps being changed ---- */
  const commitsByFile = {};
  const firstInWindow = {};
  for (const c of gitData.commits || []) {
    if (c.date.getTime() < since) continue;
    for (const f of c.files) {
      if (!source.has(f.file)) continue;
      commitsByFile[f.file] = (commitsByFile[f.file] || 0) + 1;
      if (!firstInWindow[f.file] || c.date < firstInWindow[f.file]) firstInWindow[f.file] = c.date;
    }
  }
  const agentSessionsByFile = {};
  for (const [abs, entry] of Object.entries((sessions && sessions.edits) || {})) {
    const rel = relTo(root, abs);
    if (!rel || !source.has(rel)) continue;
    agentSessionsByFile[rel] = Math.max(agentSessionsByFile[rel] || 0, sessionsSince(entry, since));
  }
  const reworked = [...new Set([...Object.keys(commitsByFile), ...Object.keys(agentSessionsByFile)])]
    .map((file) => ({ file, commits: commitsByFile[file] || 0, agentSessions: agentSessionsByFile[file] || 0 }))
    .filter((r) => r.commits >= REWORK_COMMITS || r.agentSessions >= REWORK_SESSIONS)
    .sort((a, b) => (b.commits + b.agentSessions * 2) - (a.commits + a.agentSessions * 2))
    .slice(0, 3);
  for (const r of reworked) {
    const mod = moduleOf(r.file);
    const step = stepFor(mod);
    const span = firstInWindow[r.file] ? days(now - firstInWindow[r.file].getTime()) : WINDOW_DAYS;
    const facts = [];
    if (r.commits) facts.push(`changed in ${plural(r.commits, 'commit')} over the last ${plural(span, 'day')}`);
    if (r.agentSessions) facts.push(`edited by your agent in ${plural(r.agentSessions, 'separate session')}`);
    out.push({
      kind: 'rework',
      moduleId: mod ? mod.id : null,
      title: `${mod ? mod.name : path.posix.basename(r.file)} keeps being reworked`,
      detail: `${r.file} was ${facts.join(', and ')}.${step ? ` It belongs to step ${String(step.n).padStart(2, '0')}, "${step.title}", which is still not done.` : ''} Repeated rewrites often mean the agent is patching its own fixes instead of solving the underlying problem.`,
      ask: `Before changing ${path.posix.basename(r.file)} again, explain what keeps breaking and what a lasting fix would be.`,
      chips: [r.commits ? `${plural(r.commits, 'commit')} in ${span}d` : null, r.agentSessions ? plural(r.agentSessions, 'session') : null].filter(Boolean)
    });
  }

  /* ---- failure: the same command failure keeps coming back ---- */
  const failures = Object.values((sessions && sessions.failures) || {})
    .map((e) => ({ ...e, recent: sessionsSince(e, since) }))
    .filter((e) => e.count >= FAILURE_COUNT && e.recent >= FAILURE_SESSIONS)
    .sort((a, b) => b.recent - a.recent || b.count - a.count)
    .slice(0, 2);
  for (const f of failures) {
    out.push({
      kind: 'failure',
      title: 'The same error keeps coming back',
      detail: `This command failure came up ${plural(f.count, 'time')} across ${plural(f.recent, 'agent session')} in the last ${WINDOW_DAYS} days: "${f.sample}". When an error survives several sessions, each new attempt is usually treating the symptom.`,
      ask: 'This error has come back several times. Find its root cause and explain it to me before trying another fix.',
      chips: [plural(f.count, 'time'), plural(f.recent, 'session')]
    });
  }

  /* ---- stalled: the plan has not moved while work goes on ---- */
  const unfinished = plan.filter((p) => p.status !== 'done').length;
  const planFile = plans.planFile;
  const external = !planFile || /^Antigravity /.test(planFile);
  // A setup guide chosen for lack of a real plan is not expected to move with
  // the work (the plan tip covers that case), so it cannot "stall".
  const guide = (plans.planWhy || []).includes('setup or how-to guide');
  if (!external && !guide && !plans.inferred && unfinished > 0) {
    let lastPlanChange = null;
    for (const c of gitData.commits || []) {
      if (c.files.some((f) => f.file === planFile)) { lastPlanChange = c.date.getTime(); break; } // newest first
    }
    try {
      // Uncommitted edits to the plan count as movement too.
      const m = fs.statSync(path.join(root, planFile)).mtimeMs;
      if (!lastPlanChange || m > lastPlanChange) lastPlanChange = m;
    } catch { /* plan file unreadable */ }
    if (lastPlanChange && now - lastPlanChange >= STALL_DAYS * DAY) {
      const commitsSince = (gitData.commits || []).filter((c) => c.date.getTime() > lastPlanChange).length;
      const workDays = Object.keys((sessions && sessions.days) || {}).filter((d) => Date.parse(d + 'T23:59:59Z') > lastPlanChange).length;
      if (commitsSince >= STALL_COMMITS || workDays >= STALL_WORK_DAYS) {
        const idle = days(now - lastPlanChange);
        const work = [commitsSince ? plural(commitsSince, 'commit') : null, workDays ? `agent work on ${plural(workDays, 'day')}` : null].filter(Boolean).join(' and ');
        out.push({
          kind: 'stalled',
          title: 'Work continues but the plan has not moved',
          detail: `Nothing in ${planFile} has changed in ${plural(idle, 'day')}, but there ${commitsSince === 1 ? 'was' : 'were'} ${work} since. Either the plan is out of date, or the work is not finishing any of the ${plural(unfinished, 'remaining step')}.`,
          ask: `Update ${planFile} with what is actually finished, then tell me which remaining step you are working on and what is stopping it.`,
          chips: [`${idle}d without plan changes`, commitsSince ? `${plural(commitsSince, 'commit')} since` : null].filter(Boolean)
        });
      }
    }
  }

  return out;
}

module.exports = { buildCircles, WINDOW_DAYS };
