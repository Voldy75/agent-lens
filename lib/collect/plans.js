'use strict';
const fs = require('fs');
const path = require('path');

/**
 * Finding the plan.
 *
 * A hardcoded filename list was the original design and it was wrong: people
 * keep their plan in sprint-3.md, ROADMAP.md, notes/build-order.md, or
 * anywhere else. So we look at every markdown file in a few likely places and
 * score them.
 *
 * The asymmetry that shapes this: a missed plan is a visible gap the user can
 * fix. A plan fabricated out of a CHANGELOG is a wrong report that looks
 * right. So discovery is wide, the bar for USING a file is high, and the
 * report always names what was picked and what else was considered.
 *
 * Three ways to override, in order of precedence:
 *   1. --plan <path>
 *   2. "plan" in .agent-lens.json
 *   3. an <!-- agent-lens:plan --> marker anywhere in the file
 */

const SEARCH_DIRS = ['', 'docs', 'doc', '.agent', '.claude', '.codex', 'notes', 'planning', '.github'];
const MAX_FILES = 60;
const MAX_BYTES = 400 * 1024;

// Files that look plan-ish but never are. A changelog in particular is the
// classic false positive: dated headings, bullet lists, verb-initial lines.
const DENY = /^(changelog|history|releases?|license|licence|copying|notice|contributing|code_of_conduct|security|authors|funding|pull_request_template|issue_template)(\.(md|markdown|mdx))?$/i;

const MARKER = /<!--\s*agent-lens:plan\s*-->/i;

const CHECKED = /^\s*[-*+]\s*\[([ xX~\-/])\]\s+(.*)$/;
const NUMBERED = /^\s*(\d+)[.)]\s+(.*)$/;
const HEADING = /^\s*#{1,4}\s+(.*)$/;
const BULLET = /^\s*[-*+]\s+(?!\[)(.*)$/;

const PLAN_HEADING = /\b(plan|roadmap|todo|to-do|tasks?|steps?|phases?|milestones?|backlog|progress|status|scope|deliverables?|next up|up next|remaining|checklist)\b/i;
const PLAN_FILENAME = /\b(plan|roadmap|todo|tasks?|milestones?|backlog|sprint|phases?|build[-_]order|implementation|spec|scope|checklist)\b/i;
const CHANGELOG_SHAPE = /^##+\s*\[?v?\d+\.\d+|^##+\s*unreleased\b/im;

const AGENT_FILE = {
  'claude.md': 'claude', 'agents.md': 'codex', 'task.md': 'antigravity',
  'implementation_plan.md': 'antigravity', 'walkthrough.md': 'antigravity'
};

/* ---------------------------------------------------------------- scoring */

function scoreFile(rel, text, gitChurn) {
  const base = path.basename(rel);
  if (DENY.test(base)) return { score: -100, why: ['excluded by name'] };

  const lines = text.split('\n');
  const why = [];
  let score = 0;

  const checkLines = lines.map((l) => l.match(CHECKED)).filter(Boolean);
  const checks = checkLines.length;
  if (checks >= 3) { score += 50 + Math.min(20, checks); why.push(`${checks} checkboxes`); }
  else if (checks > 0) { score += 15; why.push(`${checks} checkboxes`); }

  if (checks >= 3) {
    // A checkbox list made of links is a table of contents, not a plan.
    // got's readme is the canonical example: "- [x] [Promise API](docs/1.md)".
    const linky = checkLines.filter((m) => /^\s*\[[^\]]+\]\([^)]+\)\s*$/.test(m[2])).length;
    if (linky / checks > 0.6) { score -= 70; why.push('checkbox list of links'); }

    // Nothing left to do usually means a feature list, not work in progress.
    const ticked = checkLines.filter((m) => /[xX]/.test(m[1])).length;
    if (ticked === checks && checks >= 8) { score -= 30; why.push('every box ticked'); }
  }

  const headings = lines.map((l) => (l.match(HEADING) || [])[1]).filter(Boolean);
  const planHeads = headings.filter((h) => PLAN_HEADING.test(h));
  if (planHeads.length) { score += 25 * Math.min(2, planHeads.length); why.push(`plan section "${planHeads[0].slice(0, 30)}"`); }

  if (PLAN_FILENAME.test(base)) { score += 20; why.push('filename'); }

  // Files an agent maintains are plan-adjacent by design, even when freeform.
  if (AGENT_FILE[base.toLowerCase()]) { score += 20; why.push('agent context file'); }

  // A README describes a project; it is almost never the plan for it.
  if (/^readme\./i.test(base) && !planHeads.length) { score -= 40; why.push('readme'); }

  // Verb-initial bullets read like work items rather than documentation.
  const verbs = lines.filter((l) => {
    const m = l.match(BULLET);
    return m && /^(add|build|create|implement|set ?up|wire|fix|migrate|ship|write|design|integrate|support|handle|refactor|replace|remove)\b/i.test(m[1]);
  }).length;
  if (verbs >= 3) { score += 12; why.push(`${verbs} action bullets`); }

  const churn = gitChurn && gitChurn[rel];
  if (churn && churn.commits >= 3) { score += 10; why.push(`edited ${churn.commits}x`); }

  // Negatives
  if (CHANGELOG_SHAPE.test(text)) { score -= 60; why.push('looks like a changelog'); }
  const fences = (text.match(/^```/gm) || []).length / 2;
  if (fences > 6 && checks === 0) { score -= 25; why.push('mostly code samples'); }
  if (text.length < 120) { score -= 30; why.push('too short'); }
  if (/\b(MIT License|Apache License|Contributor Covenant)\b/.test(text)) { score -= 80; why.push('boilerplate'); }

  if (MARKER.test(text)) return { score: 1000, why: ['agent-lens:plan marker'], checks };

  return { score, why, checks };
}

/* -------------------------------------------------------------- discovery */

function listMarkdown(root) {
  const out = [];
  for (const dir of SEARCH_DIRS) {
    let entries;
    try { entries = fs.readdirSync(path.join(root, dir), { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isFile() || !/\.(md|markdown|mdx)$/i.test(e.name)) continue;
      out.push(dir ? `${dir}/${e.name}` : e.name);
      if (out.length >= MAX_FILES) return out;
    }
  }
  return out;
}

function readIf(root, rel) {
  try {
    const st = fs.statSync(path.join(root, rel));
    if (!st.isFile() || st.size > MAX_BYTES) return null;
    return fs.readFileSync(path.join(root, rel), 'utf8');
  } catch { return null; }
}

/* ---------------------------------------------------------------- parsing */

function stateFor(mark, text) {
  const t = text.toLowerCase();
  if (mark === 'x' || mark === 'X') return 'done';
  if (mark === '~' || mark === '/' || mark === '-') return 'active';
  if (/\b(in progress|wip|doing|underway)\b/.test(t)) return 'active';
  if (/\b(blocked|stuck|waiting on|pending approval)\b/.test(t)) return 'blocked';
  return 'pending';
}

function splitTitle(raw) {
  const c = raw.replace(/\*\*/g, '').replace(/`/g, '').trim();
  const cut = c.search(/\s[\u2014\u2013-]\s|\.\s|:\s/);
  if (cut > 12 && cut < 80) {
    return { title: c.slice(0, cut).trim(), description: c.slice(cut).replace(/^[\s\u2014\u2013:.-]+/, '').trim() };
  }
  return { title: c.slice(0, 90), description: c.length > 90 ? c.slice(90) : '' };
}

function parseCheckboxes(text, source) {
  const steps = [];
  let heading = null;
  for (const line of text.split('\n')) {
    const h = line.match(HEADING);
    if (h) { heading = h[1].replace(/\*\*/g, '').trim(); continue; }
    const c = line.match(CHECKED);
    if (!c) continue;
    const { title, description } = splitTitle(c[2]);
    if (title) steps.push({ title, description, status: stateFor(c[1], c[2]), source, section: heading });
  }
  return steps;
}

/** Bullets inside a plan-looking heading. Statuses here are guesses. */
function parseLooseSections(text, source) {
  const steps = [];
  let heading = null, inPlan = false;
  for (const line of text.split('\n')) {
    const h = line.match(HEADING);
    if (h) { heading = h[1].replace(/\*\*/g, '').trim(); inPlan = PLAN_HEADING.test(heading); continue; }
    if (!inPlan) continue;
    const b = line.match(BULLET) || line.match(NUMBERED);
    if (!b) continue;
    let raw = (b[2] !== undefined ? b[2] : b[1]).trim();
    if (!raw || raw.length < 4) continue;

    let status = 'pending';
    const struck = raw.match(/^~~(.+?)~~$/);
    if (struck) { raw = struck[1]; status = 'done'; }
    else if (/\b(done|shipped|complete[d]?)\b/i.test(raw)) status = 'done';
    else if (/\b(in progress|wip|doing|underway)\b/i.test(raw)) status = 'active';
    else if (/\b(blocked|stuck|waiting on)\b/i.test(raw)) status = 'blocked';

    const { title, description } = splitTitle(raw);
    if (title) steps.push({ title, description, status, source, section: heading, inferred: true });
  }
  return steps;
}

/* ------------------------------------------------------------------ entry */

function collectPlans(root, opts = {}) {
  let forced = opts.planFile || null;
  if (!forced) {
    try {
      const cfg = JSON.parse(fs.readFileSync(path.join(root, '.agent-lens.json'), 'utf8'));
      if (cfg && typeof cfg.plan === 'string') forced = cfg.plan;
    } catch { /* no config, fine */ }
  }

  const files = forced ? [forced] : listMarkdown(root);
  const scored = [];
  const agents = new Set();
  const contextFiles = [];

  for (const rel of files) {
    const text = readIf(root, rel);
    if (text == null) continue;

    const agent = AGENT_FILE[path.basename(rel).toLowerCase()];
    if (agent) agents.add(agent);

    const s = forced ? { score: 1000, why: ['chosen explicitly'] } : scoreFile(rel, text, opts.gitChurn);
    scored.push({ file: rel, text, ...s });

    // Anything readable is context for the authoring pass, even when it is a
    // poor plan candidate. A README explains a project; it is just not a plan.
    if (s.score > -80) contextFiles.push(rel);
  }

  scored.sort((a, b) => b.score - a.score || a.file.length - b.file.length);

  const THRESHOLD = 30;
  const considered = scored.filter((f) => f.score > 0).slice(0, 5)
    .map((f) => ({ file: f.file, score: f.score, why: f.why.slice(0, 2) }));
  const base = {
    steps: [], planFile: null, agents: [...agents], considered,
    filesSeen: scored.map((f) => f.file), contextFiles, inferred: false,
    rejected: scored.filter((f) => f.score <= 0).slice(0, 4).map((f) => ({ file: f.file, why: f.why[0] || 'low score' }))
  };

  const winner = scored.find((f) => f.score >= THRESHOLD);
  if (!winner) return base;

  const source = AGENT_FILE[path.basename(winner.file).toLowerCase()] || 'plan';
  let steps = parseCheckboxes(winner.text, source);
  let inferred = false;
  if (!steps.length) { steps = parseLooseSections(winner.text, source); inferred = steps.length > 0; }
  if (!steps.length) return base;

  return {
    ...base,
    steps: steps.slice(0, 40).map((s, i) => ({ n: i + 1, ...s })),
    planFile: winner.file,
    planWhy: winner.why,
    inferred
  };
}

module.exports = { collectPlans, scoreFile, parseCheckboxes, parseLooseSections, listMarkdown };
