'use strict';
const fs = require('fs');
const path = require('path');

/**
 * The authoring pass.
 *
 * The scanner produces structure but no prose: module names are folder names,
 * descriptions are empty, and there are no flows. Those need a model — and
 * inside a coding agent the model is already there, so we never ask the user
 * for an API key and never send their code anywhere.
 *
 * The contract is deliberately narrow. An agent may rename things and describe
 * them; it may not invent modules, change statuses, move files, or touch
 * counts. Anything outside the allowed shape is dropped and reported.
 */

// Secret VALUES, not words. Docs talk about "design tokens" and "API keys"
// all the time; what must never reach a prompt is an actual key.
const SECRET_VALUES = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\bAKIA[0-9A-Z]{16}\b/g,                                   // AWS access key id
  /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}/g,                 // Anthropic / OpenAI
  /\b[rs]k_(?:live|test)_[A-Za-z0-9]{8,}/g,                  // Stripe
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}/g, // GitHub
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,                         // Slack
  /\bAIza[0-9A-Za-z_-]{35}\b/g,                              // Google
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // JWT
  /(?<=[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:)[^\s@/]+(?=@)/gi       // password inside a URL
];
// key = value, where the value is not an obvious placeholder.
const ASSIGNED = /\b(api[_-]?key|secret|client[_-]?secret|password|passwd|token|access[_-]?key|private[_-]?key)(["'`]?\s*[:=]\s*["'`]?)([^\s"'`,;)]{8,})/gi;
const PLACEHOLDER = /^(<.*>|\$\{.*|process\.env.*|your[_-].*|x{4,}.*|\*{3,}.*|\.\.\..*|changeme|example.*|dummy.*|test.*|placeholder.*)$/i;

/** Replace anything that looks like a real credential. Returns { text, count }. */
function redactSecrets(text) {
  let count = 0;
  let out = text;
  for (const re of SECRET_VALUES) out = out.replace(re, () => { count++; return '[redacted]'; });
  out = out.replace(ASSIGNED, (m, key, sep, value) => {
    if (value === '[redacted]' || PLACEHOLDER.test(value)) return m;
    count++;
    return key + sep + '[redacted]';
  });
  return { text: out, count };
}
const CONTEXT_BUDGET = 60 * 1024;
const PER_FILE = 12 * 1024;

/**
 * Freeform docs are not parseable, but they are exactly what a model needs to
 * name things well. So README, ARCHITECTURE, specs and notes are passed
 * through as context rather than being mined for structure.
 *
 * Two guards: a byte budget, and a skip for anything that looks like it
 * carries credentials — this text ends up in a report people share.
 */
function gatherContext(state, root) {
  const files = (state.meta && state.meta.contextFiles) || [];
  const out = [];
  let budget = CONTEXT_BUDGET;
  for (const rel of files) {
    if (budget <= 0) break;
    if (state.meta && rel === state.meta.planFile) continue; // already read as the plan
    let text;
    try { text = fs.readFileSync(path.join(root, rel), 'utf8'); } catch { continue; }
    const clean = redactSecrets(text);
    const slice = clean.text.slice(0, Math.min(PER_FILE, budget));
    budget -= slice.length;
    out.push({ file: rel, text: slice, truncated: slice.length < clean.text.length, redacted: clean.count });
  }
  return out;
}

function authoringPrompt(state, root) {
  const mods = state.modules.map((m) => ({
    id: m.id, folder: m.sources[0] || '', files: m.files, lines: m.lines, status: m.status
  }));
  const edges = state.edges.slice(0, 40);
  const needPlan = !state.plan || !state.plan.length;
  const context = root ? gatherContext(state, root) : [];
  const contextBlock = context.length ? `
## Project documentation, for context

These files are not plans — do not turn them into steps. Read them so the
names and descriptions you write match how this project already talks about
itself.

${context.map((c) => c.skipped
    ? `### ${c.file}\n(skipped — ${c.skipped})`
    : `### ${c.file}${c.truncated ? ' (truncated)' : ''}${c.redacted ? ` (${c.redacted} value${c.redacted === 1 ? '' : 's'} that looked like credentials replaced with [redacted])` : ''}\n\n${c.text}`).join('\n\n---\n\n')}
` : '';

  const planBlock = needPlan ? `
## There is no plan yet — write one

This project has no checklist an agent has been ticking off, so the report has
no sense of progress. Reconstruct one.

Read the plan or spec files in this repo (CLAUDE.md, AGENTS.md, README, docs)
AND the git history, then write the steps this project has actually been built
in. Rules:

- 5 to 12 steps. Ordered as they happened, earliest first.
- A step is a thing the owner would recognise ("Restaurant feed", "Sign in"),
  not a commit message and not a file name.
- status: "done" only if the code for it exists and is being used. "active" if
  it is half-built right now. "blocked" if something outside the code is
  stopping it. "pending" if it has not been started.
- Be conservative. If you cannot tell whether something is finished, say
  "active", not "done". A wrong "done" is the worst error this tool can make.
- Put the reason in \`flag\` when a step is blocked or went badly.

Recent commits, for grounding:
${JSON.stringify((state.activity || []).map((a) => a.text), null, 1)}
` : '';

  return `# Agent Lens authoring pass

You are looking at a scan of the project in this folder. The scan found the
structure but wrote no prose. Your job is to name and explain it for someone
who is NOT a programmer — the person who has been building this with an agent
and does not read code.

## What you must not do

- Do not invent, merge, split, or remove modules. Use exactly the ids below.
- Do not change files, lines, or status. Those are measured, not opinions.
- Do not guess. If you cannot tell what something does from its files, write a
  short factual description of what is in it and move on.

## Rules for the writing

- Module names: what it DOES, in plain words. "Checkout" not "CheckoutModule".
  Two or three words. No jargon, no file extensions, no camelCase.
- Descriptions: one or two sentences, addressed to the owner of the project.
  Say what it is for, not how it is implemented.
- District names: the area of the product these modules belong to. Invent a
  clear human grouping name ("Ordering", "Server & data"). Keep the same ids.
- Flows: a flow is one journey a real user takes through the app, listed as a
  path of module ids that genuinely import one another (check the edges below).
  Two to six stops. Each stop gets a short note in plain language. Write two to
  five flows, or none if you cannot find a real path.

${contextBlock}${planBlock}
## Modules

${JSON.stringify(mods, null, 1)}

## Real imports between modules (from → to)

${JSON.stringify(edges)}

## Existing district ids

${JSON.stringify(state.districts.map((d) => ({ id: d.id, name: d.name })), null, 1)}

## Output

Write ONLY this JSON to a file called agent-lens.authored.json, nothing else:

{
  "districts": [{ "id": "<existing id>", "name": "<human name>" }],
  "modules":   [{ "id": "<existing id>", "name": "<human name>", "description": "<1-2 sentences>" }],
  "flows":     [{
    "id": "<slug>", "name": "<plain name>", "status": "built|blocked|ghost|active",
    "description": "<one sentence>",
    "path": [{ "module": "<existing id>", "note": "<what happens here>" }]
  }],
  "summary":   { "headline": "<one sentence, plain English>", "subhead": "<two sentences>" }${needPlan ? `,
  "plan":      [{
    "n": 1, "title": "<what was built>", "description": "<one sentence>",
    "status": "done|active|blocked|pending",
    "modules": ["<existing module ids this touched>"],
    "flag": "<optional: why it is stuck or went badly>"
  }]` : ''}
}

Then run: npx agent-lens-report author --apply agent-lens.authored.json
`;
}

const clean = (v, max) => typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max) : null;

function applyAuthoring(state, authored, opts = {}) {
  const report = { names: 0, descriptions: 0, flows: 0, districts: 0, plan: 0, rejected: [] };
  const modIds = new Set(state.modules.map((m) => m.id));
  const distIds = new Set(state.districts.map((d) => d.id));

  for (const d of authored.districts || []) {
    if (!distIds.has(d.id)) { report.rejected.push(`district ${d.id}`); continue; }
    const name = clean(d.name, 40);
    if (name) { state.districts.find((x) => x.id === d.id).name = name; report.districts++; }
  }

  for (const m of authored.modules || []) {
    if (!modIds.has(m.id)) { report.rejected.push(`module ${m.id}`); continue; }
    const target = state.modules.find((x) => x.id === m.id);
    const name = clean(m.name, 40);
    const desc = clean(m.description, 400);
    if (name) { target.name = name; report.names++; }
    if (desc) { target.description = desc; report.descriptions++; }
    // status, files, lines, sources are measured — never taken from the model.
  }

  // Rows elsewhere in the report that name a module follow its new name.
  for (const c of state.circles || []) {
    const m = c.moduleId && state.modules.find((x) => x.id === c.moduleId);
    if (m && c.kind === 'rework') c.title = `${m.name} keeps being reworked`;
  }
  for (const row of (state.cost && state.cost.byArea) || []) {
    const m = row.id && state.modules.find((x) => x.id === row.id);
    if (m) row.label = m.name;
  }

  const flows = [];
  for (const f of authored.flows || []) {
    const path = (f.path || []).filter((p) => modIds.has(p.module));
    if (path.length < 2) { report.rejected.push(`flow ${f.id || '?'}`); continue; }
    flows.push({
      id: clean(f.id, 40) || 'flow-' + flows.length,
      name: clean(f.name, 40) || 'Flow',
      tag: clean(f.tag, 30) || undefined,
      status: ['built', 'blocked', 'ghost', 'active'].includes(f.status) ? f.status : 'built',
      description: clean(f.description, 300) || '',
      path: path.slice(0, 8).map((p) => ({ module: p.module, note: clean(p.note, 120) || '' }))
    });
  }
  if (flows.length) { state.flows = flows.slice(0, 8); report.flows = state.flows.length; }

  // A reconstructed plan only fills a gap. When the scan read a real plan
  // file, that file is the truth and a stale reconstruction must not replace it.
  const plan = [];
  for (const p of (opts.keepMeasuredPlan && state.plan.length ? [] : authored.plan || [])) {
    const title = clean(p.title, 90);
    if (!title) { report.rejected.push('plan step without a title'); continue; }
    plan.push({
      n: plan.length + 1,
      title,
      description: clean(p.description, 300) || '',
      status: ['done', 'active', 'blocked', 'pending'].includes(p.status) ? p.status : 'pending',
      // Labelled so nobody mistakes a reconstruction for a ticked checkbox.
      evidence: ['reconstructed by your agent'],
      modules: (p.modules || []).filter((m) => modIds.has(m)).slice(0, 4),
      flag: clean(p.flag, 200) || undefined
    });
  }
  if (plan.length) {
    state.plan = plan.slice(0, 20);
    state.blockers = state.plan.filter((p) => p.status === 'blocked').map((p) => ({
      title: p.title,
      detail: p.flag || p.description || 'Marked blocked by your agent. No further detail was given.',
      chips: [`Step ${String(p.n).padStart(2, '0')}`, 'from your agent']
    }));
    report.plan = state.plan.length;
  }

  // The headline ("3 of 15 steps, last touched yesterday") is measured and
  // stays that way. The agent's summary is shown under it, labelled as its.
  if (authored.summary) {
    const about = [clean(authored.summary.headline, 220), clean(authored.summary.subhead, 500)].filter(Boolean).join(' ');
    if (about) state.summary.about = about;
  }

  if (!opts.quiet && report.rejected.length > 6) report.rejected = report.rejected.slice(0, 6).concat(['…']);
  return report;
}

module.exports = { authoringPrompt, applyAuthoring, redactSecrets };
