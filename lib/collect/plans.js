'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { antigravityConversations } = require('./sessions');

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

// How-to documents: setup guides, install notes, deploy runbooks. They are
// full of checkboxes, but they describe how to configure something, not what
// is being built, so "3 of 30 steps" drawn from one is a misleading headline.
const GUIDE_FILENAME = /(^|[-_. ])(setup|set-up|install(ation)?|guide|how-?to|deploy(ment)?|onboarding|getting[-_ ]started|runbook|troubleshooting)([-_. ]|$)/i;

const MARKER_RE = /^\s*<!--\s*agent-lens:plan\s*-->\s*$/im;
// The marker counts only on a line of its own and outside code blocks, so a
// document that explains the marker (like this package's README) is not
// mistaken for one that uses it.
const MARKER = { test: (text) => MARKER_RE.test(text.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, '')) };

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

  // A README describes a project; it is never mined for plan steps (the
  // marker above is the one way to opt a README in).
  if (/^readme\./i.test(base) && !MARKER.test(text)) return { score: -50, why: ['readme — used as context, not as a plan'], checks };

  // Large enough that a guide is only used when nothing else reads as a plan.
  if (GUIDE_FILENAME.test(base)) { score -= 90; why.push('setup or how-to guide'); }

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
  const c = raw.replace(/\*\*/g, '').replace(/`/g, '').replace(/\s+/g, ' ').trim();
  const cut = c.search(/\s[\u2014\u2013-]\s|\.\s|:\s/);
  if (cut > 12 && cut < 80) {
    return { title: c.slice(0, cut).trim(), description: c.slice(cut).replace(/^[\s\u2014\u2013:.-]+/, '').trim() };
  }
  if (c.length <= 90) return { title: c, description: '' };
  // Break at a word boundary, never mid-word.
  const sp = c.lastIndexOf(' ', 90);
  const at = sp > 40 ? sp : 90;
  return { title: c.slice(0, at).trim() + '…', description: '…' + c.slice(at).trim() };
}

/**
 * List items often wrap onto indented continuation lines. Join them onto the
 * item they belong to so a step is not cut off at the first line break.
 */
function joinContinuations(text) {
  const out = [];
  for (const line of text.split('\n')) {
    const prev = out.length - 1;
    const isItem = CHECKED.test(line) || BULLET.test(line) || NUMBERED.test(line) || HEADING.test(line);
    const cont = !isItem && /^\s{2,}\S/.test(line) && prev >= 0 && (CHECKED.test(out[prev]) || BULLET.test(out[prev]) || NUMBERED.test(out[prev]));
    if (cont) out[prev] += ' ' + line.trim();
    else out.push(line);
  }
  return out;
}

function parseCheckboxes(text, source) {
  const steps = [];
  let heading = null;
  for (const line of joinContinuations(text)) {
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
  for (const line of joinContinuations(text)) {
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

  // Antigravity's live task list lives outside the repo. Offer the newest one
  // from a conversation that worked in this folder as a candidate; it is
  // scored like any other file, and an in-repo plan with more checkboxes can
  // still win.
  const external = {};
  if (!forced) {
    const conv = antigravityConversations(root, opts.home || os.homedir())
      .find((c) => c.artifacts['task.md']);
    if (conv) {
      const label = `Antigravity task list (conversation ${conv.id.slice(0, 8)})`;
      external[label] = conv.artifacts['task.md'].text;
      files.unshift(label);
      agents.add('antigravity');
    }
  }

  for (const rel of files) {
    const isExternal = rel in external;
    const text = isExternal ? external[rel] : readIf(root, rel);
    if (text == null) continue;

    const agent = isExternal ? 'antigravity' : AGENT_FILE[path.basename(rel).toLowerCase()];
    if (agent) agents.add(agent);

    let s = forced ? { score: 1000, why: ['chosen explicitly'] } : scoreFile(isExternal ? 'task.md' : rel, text, opts.gitChurn);
    if (isExternal) s = { ...s, score: s.score + 15, why: ['Antigravity\'s own task list', ...s.why] };
    scored.push({ file: rel, text, external: isExternal, ...s });

    // Anything readable is context for the authoring pass, even when it is a
    // poor plan candidate. A README explains a project; it is just not a plan.
    // Being a poor plan (a guide, a README) says nothing about being useful
    // background; only files excluded by name and licence boilerplate are left out.
    const junk = (s.why || []).some((w) => w === 'excluded by name' || w === 'boilerplate');
    if (!junk && !isExternal) contextFiles.push(rel);
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

  const source = winner.external ? 'antigravity' : AGENT_FILE[path.basename(winner.file).toLowerCase()] || 'plan';
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
