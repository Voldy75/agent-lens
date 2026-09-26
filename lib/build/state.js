'use strict';
const path = require('path');
const { collectGit, activityFrom, commitsTouching, ago } = require('../collect/git');
const { collectFiles, readPkgDeps } = require('../collect/files');
const { collectPlans } = require('../collect/plans');
const { collectSessions } = require('../collect/sessions');
const { buildModules, buildEdges, buildHealth, buildCost } = require('./model');
const { planTip } = require('../plan-tip');
const { buildCircles } = require('./circles');

function planSub(plans) {
  if (!plans.planFile) {
    const seen = (plans.filesSeen || []).length;
    return seen
      ? `Looked at ${seen} markdown file${seen === 1 ? '' : 's'} and none of them read as a plan. Point at one with --plan <path>, or add <!-- agent-lens:plan --> to the file you use.`
      : 'No markdown files were found to read a plan from.';
  }
  const why = (plans.planWhy || ['its contents']);
  const list = why.length > 1 ? why.slice(0, -1).join(', ') + ' and ' + why[why.length - 1] : why[0];
  const bits = [`Chosen because of ${list}.`];
  const others = (plans.considered || []).filter((c) => c.file !== plans.planFile).map((c) => c.file);
  if (others.length) bits.push(`Also considered ${others.slice(0, 3).join(', ')}.`);
  bits.push(plans.inferred
    ? 'This file has no checkboxes, so the statuses below are inferred from wording and may be wrong.'
    : 'Statuses come from the file itself — anything not ticked off stays "not started" here, even if the code exists.');
  return bits.join(' ');
}

const AGENT_LABEL = { claude: 'claude-code', 'claude-code': 'claude-code', codex: 'codex', antigravity: 'antigravity' };
const normaliseAgents = (list) => [...new Set(list.map((a) => AGENT_LABEL[a] || a))].sort();

const fmtDate = (d) => d ? `Started ${d.getDate()} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()]}` : null;

function syncedLabel(gitData) {
  if (!gitData.lastDate) return null;
  const d = ago(gitData.lastDate);
  return d === 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
}

/** Link plan steps to modules by matching words in the title against module keys. */
function linkSteps(steps, modules) {
  return steps.map((s) => {
    const words = (s.title + ' ' + s.description).toLowerCase().match(/[a-z]{4,}/g) || [];
    const hits = modules
      .map((m) => ({ id: m.id, score: words.filter((w) => m._key.toLowerCase().includes(w) || m.name.toLowerCase().includes(w)).length }))
      .filter((h) => h.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((h) => h.id);
    return {
      n: s.n, title: s.title, description: s.description, status: s.status,
      evidence: [s.source === 'antigravity' ? 'antigravity artifact' : `from ${s.source}`],
      modules: hits,
      flag: s.status === 'blocked' ? 'Marked blocked in the plan file.' : undefined
    };
  });
}

function headline(plan, health, gitData, cost) {
  const done = plan.filter((p) => p.status === 'done').length;
  const blocked = plan.filter((p) => p.status === 'blocked').length;
  const parts = [];
  if (plan.length) parts.push(`You're [[${done} of ${plan.length} steps]] through the plan`);
  else parts.push(`This project has [[${gitData.commits.length} commits]] and no plan file`);
  if (blocked) parts.push(`((${blocked} ${blocked === 1 ? 'step is' : 'steps are'} blocked))`);
  const last = syncedLabel(gitData);
  if (last) parts.push(`last touched ${last}`);
  return parts.join(', ') + '.';
}

function subhead(gitData, sessions, plans, health, planChanged) {
  const bits = [];
  if (planChanged && planChanged.to) bits.push(`Plan now read from ${plans.planFile} (last scan used ${planChanged.from || 'no plan file'}), so progress is not comparable.`);
  else if (plans.planFile) bits.push(`Plan read from ${plans.planFile}.`);
  else bits.push('No plan file found, so progress is inferred from commits alone.');
  if (gitData.commits.length) {
    const authors = new Set(gitData.commits.map((c) => c.author));
    bits.push(`${gitData.commits.length} commits from ${authors.size} author${authors.size === 1 ? '' : 's'}.`);
  }
  if (sessions.available) bits.push(`${sessions.sessions} agent session${sessions.sessions === 1 ? '' : 's'} found for this folder (${sessions.agents.join(', ')}).`);
  else bits.push('No agent session logs with token counts were found, so there is no cost figure.');
  return bits.join(' ');
}

async function buildState(root, opts = {}) {
  const warnings = [];
  const gitData = collectGit(root, opts);
  if (!gitData.available) warnings.push('not a git repository — timeline and churn are unavailable');

  const files = collectFiles(root);
  if (!files.length) warnings.push('no recognised source files found');

  const pkg = readPkgDeps(root);
  const plans = collectPlans(root, { planFile: opts.planFile, gitChurn: gitData.churn, home: opts.home });
  if (!plans.steps.length) {
    const n = (plans.filesSeen || []).length;
    warnings.push(n
      ? `read ${n} markdown file${n === 1 ? '' : 's'}, none of them a plan — run "npx agent-lens-report author --prompt" to have your agent write one, or point at a file with --plan <path>`
      : 'no markdown files found, so there is no plan to read');
  } else if (plans.inferred) {
    warnings.push(`${plans.planFile} has no checkboxes, so steps were read from its plan section and statuses are guesses`);
  }

  // Plan discovery is scored, so edits to your docs can change which file wins
  // and make progress jump for no real reason. Say so, and say how to pin it.
  const prevPlan = opts.previous && opts.previous.meta ? opts.previous.meta.planFile : undefined;
  const planChanged = prevPlan !== undefined && prevPlan !== plans.planFile && !opts.planFile
    ? { from: prevPlan, to: plans.planFile }
    : null;
  if (planChanged) {
    const pin = planChanged.from ? ` To keep using ${planChanged.from}, run with --plan ${planChanged.from} or add {"plan": "${planChanged.from}"} to .agent-lens.json.` : '';
    warnings.push(planChanged.to
      ? `the plan is now read from ${planChanged.to} instead of ${planChanged.from || 'no file'}, so progress is not comparable with your last scan.${pin}`
      : `${planChanged.from} is no longer read as the plan, so there is no progress figure this time.${pin}`);
  }

  const sessions = await collectSessions(root, opts);
  // "No Codex sessions" is not a gap in the scan when you never used Codex.
  // Only real failures are worth a note, plus one line when no agent log was
  // found at all (that is why the Cost tab is missing).
  (sessions.reasons || []).filter((r) => /failed|could not read/.test(r)).forEach((r) => warnings.push(r));
  if (!sessions.available) {
    warnings.push((sessions.detected || []).includes('antigravity')
      ? 'Antigravity does not keep a local record of tokens, so there is no cost figure'
      : 'no Claude Code or Codex session logs found for this folder, so there is no cost figure');
  }

  const { modules, districts } = buildModules(files, gitData);
  const edges = buildEdges(files, modules);
  const health = buildHealth(files, modules, gitData, pkg.deps);
  const cost = buildCost(sessions, modules);
  const plan = linkSteps(plans.steps, modules);
  const circles = buildCircles({ root, gitData, sessions, plans, plan, modules, files });

  const agentsDetected = normaliseAgents([...(plans.agents || []), ...(sessions.agents || []), ...(sessions.detected || [])]);

  const mapped = modules.reduce((n, m) => n + m.files, 0);
  const totalSource = files.filter((f) => !f.test).length;

  const blockers = plan.filter((p) => p.status === 'blocked').map((p) => ({
    title: p.title,
    detail: p.description || 'Marked as blocked in the plan file. No further detail was recorded there.',
    chips: [`Step ${String(p.n).padStart(2, '0')}`, 'from plan file']
  }));

  const state = {
    project: {
      name: pkg.name || gitData.name || path.basename(path.resolve(root)),
      version: pkg.version ? 'v' + pkg.version : null,
      branch: gitData.branch,
      started: fmtDate(gitData.firstDate),
      synced: syncedLabel(gitData)
    },
    coverage: {
      mappedPct: totalSource ? Math.round((mapped / totalSource) * 100) : 0,
      unmappedFiles: Math.max(0, totalSource - mapped)
    },
    summary: { headline: headline(plan, health, gitData, cost), subhead: subhead(gitData, sessions, plans, health, planChanged) },
    headings: {
      plan: {
        title: plans.planFile ? `Plan read from ${plans.planFile}.` : 'No plan file was found.',
        sub: planSub(plans)
      },
      health: {
        title: 'Signals that do not show up as errors.',
        sub: 'Files the agent kept rewriting, modules nothing tests, and how much is declared as a dependency.'
      },
      map: {
        title: 'Your project as a place — one building per folder.',
        sub: 'Buildings are sized by lines of code and grouped by directory. Lines are real imports between them. Names come from folder names until an agent writes better ones.'
      },
      cost: { title: 'What the agents have spent on this folder.', sub: 'Read from local session logs. Nothing is uploaded.' }
    },
    districts,
    modules: modules.map(({ _key, _churn, _tests, _days, _paths, ...m }) => m),
    edges,
    flows: [],
    plan,
    blockers,
    circles,
    activity: activityFrom(gitData),
    health,
    cost,
    meta: {
      generatedBy: 'agent-lens scan',
      agentsDetected,
      planTip: planTip(root, plans, agentsDetected),
      planFile: plans.planFile,
      planChanged,
      planCandidates: plans.considered,
      contextFiles: plans.contextFiles || [],
      needsAuthoring: true
    },
    layout: { pinned: (opts.previous && opts.previous.layout && opts.previous.layout.pinned) || {} }
  };

  return { state, warnings };
}

module.exports = { buildState };
