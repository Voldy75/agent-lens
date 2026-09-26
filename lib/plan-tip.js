'use strict';
const fs = require('fs');
const path = require('path');

/**
 * When plan statuses are guesses (or there is no plan at all), suggest a few
 * lines the user can add to their agent's instruction file so the agent keeps
 * a real checklist as it works.
 *
 * This only ever SUGGESTS. agent-lens never edits CLAUDE.md, AGENTS.md or any
 * other file outside .agent-lens/ — those files are the user's, often shared
 * with a team, and changing how someone's agent behaves is their call.
 */

const INSTRUCTION_FILES = [
  { file: 'CLAUDE.md', agent: 'claude-code', label: 'Claude Code' },
  { file: 'AGENTS.md', agent: 'codex', label: 'Codex, Cursor and others' }
];

// Present in the suggested lines, so a project that already has them is not asked again.
const HEADING = 'Project plan (read by agent-lens)';

function snippet(planFile) {
  const file = planFile || 'PLAN.md';
  return [
    `## ${HEADING}`,
    '',
    `Keep the build plan in ${file} as a checklist and update it as you work.`,
    `If ${file} has no checklist yet, write one from what is already built and what is left.`,
    '- `- [ ]` not started, `- [~]` in progress, `- [x]` done.',
    '- Tick a step only when it works end to end, not when the code is merely written.',
    '- If a step is stuck, leave it unticked and add "blocked on <reason>" to its line.',
    '- Add steps when the scope grows. Never delete finished ones.'
  ].join('\n');
}

const read = (root, rel) => { try { return fs.readFileSync(path.join(root, rel), 'utf8'); } catch { return null; } };

/**
 * @returns null when no tip is needed, else
 *   { reason, planFile, targets: [{file, label, exists}], text }
 */
function planTip(root, plans, agentsDetected = []) {
  const guessed = plans.steps.length > 0 && plans.inferred;
  const missing = plans.steps.length === 0;
  // A setup guide only wins when nothing else reads as a plan; its checkboxes
  // measure configuration, not what is being built.
  const guide = !guessed && !missing && (plans.planWhy || []).includes('setup or how-to guide');
  if (!guessed && !missing && !guide) return null;

  // Already set up: the lines are in one of the agent's instruction files.
  const candidates = [...INSTRUCTION_FILES.map((f) => f.file), '.claude/CLAUDE.md'];
  if (candidates.some((f) => (read(root, f) || '').includes(HEADING))) return null;

  // Prefer the instruction files this project already has; otherwise the ones
  // for the agents we saw evidence of; otherwise offer both.
  let targets = INSTRUCTION_FILES.filter((f) => read(root, f.file) != null).map((f) => ({ ...f, exists: true }));
  if (!targets.length) targets = INSTRUCTION_FILES.filter((f) => agentsDetected.includes(f.agent)).map((f) => ({ ...f, exists: false }));
  if (!targets.length) targets = INSTRUCTION_FILES.map((f) => ({ ...f, exists: false }));

  // An external Antigravity task list cannot be edited in the repo; point at PLAN.md instead.
  const planFile = guessed && plans.planFile && !/^Antigravity /.test(plans.planFile) ? plans.planFile : null;

  return {
    reason: guessed ? 'guessed' : guide ? 'guide' : 'missing',
    guideFile: guide ? plans.planFile : undefined,
    planFile: planFile || 'PLAN.md',
    targets: targets.map(({ file, label, exists }) => ({ file, label, exists })),
    text: snippet(planFile)
  };
}

function describeTargets(tip) {
  const names = tip.targets.map((t) => `${t.file}${t.exists ? '' : ` (${t.label})`}`);
  return names.length > 1 ? names.slice(0, -1).join(', ') + ' or ' + names[names.length - 1] : names[0];
}

module.exports = { planTip, describeTargets, HEADING };
