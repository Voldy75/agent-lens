#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildState } = require('../lib/build/state');
const { renderToFile } = require('../lib/render');
const { authoringPrompt, applyAuthoring } = require('../lib/author');
const { planTip, describeTargets } = require('../lib/plan-tip');
const { collectPlans } = require('../lib/collect/plans');

const VERSION = require('../package.json').version;
const HOME_DIR = path.join(os.homedir(), '.agent-lens');
const INDEX = path.join(HOME_DIR, 'projects.json');

function parse(argv) {
  const a = { _: [], cwd: process.cwd() };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--out' || v === '-o') a.out = argv[++i];
    else if (v === '--cwd' || v === '-C') a.cwd = argv[++i];
    else if (v === '--apply') a.apply = argv[++i];
    else if (v === '--plan') a.planFile = argv[++i];
    else if (v === '--json') a.json = true;
    else if (v === '--no-open') a.noOpen = true;
    else if (v === '--prompt') a.prompt = true;
    else if (v === '-h' || v === '--help') a.help = true;
    else if (v === '-v' || v === '--version') a.version = true;
    else a._.push(v);
  }
  return a;
}

const HELP = `agent-lens ${VERSION} — see where an agent-built project actually stands

  npx agent-lens-report                 scan this folder and write a report
  npx agent-lens-report scan            same thing, explicitly
  npx agent-lens-report author --prompt print the authoring prompt for your agent
  npx agent-lens-report author --apply f.json   merge an agent's authored fields
  npx agent-lens-report render          re-render from the existing state file
  npx agent-lens-report ls              every project you've scanned
  npx agent-lens-report plan-tip        lines to add so your agent keeps the plan up to date

Options
  -C, --cwd <dir>    project folder (default: here)
  -o, --out <file>   report path (default: .agent-lens/report.html)
      --plan <file>  use this file as the plan instead of guessing
      --json         print the state to stdout instead of a report
      --no-open      don't open the report in your browser afterwards

Everything runs locally. No code, prompt, or path is uploaded.`;

const dir = (p) => { fs.mkdirSync(p, { recursive: true }); return p; };

/**
 * Open the report in the default browser — only for a person at a terminal.
 * Never in CI, never when another program runs us (no TTY), never with
 * --no-open or AGENT_LENS_NO_OPEN=1.
 */
function openReport(file, a) {
  if (a.noOpen || process.env.AGENT_LENS_NO_OPEN || process.env.CI || !process.stdout.isTTY) return false;
  const { spawn } = require('child_process');
  const [cmd, args] = process.platform === 'darwin' ? ['open', [file]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', file]]
      : ['xdg-open', [file]];
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {}); // no browser available: the path is printed anyway
    child.unref();
    return true;
  } catch { return false; }
}

function loadAuthored(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function loadPrevious(stateFile) {
  try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { return null; }
}

function updateIndex(root, state) {
  dir(HOME_DIR);
  let idx = {};
  try { idx = JSON.parse(fs.readFileSync(INDEX, 'utf8')); } catch { /* first run */ }
  const plan = state.plan || [];
  idx[path.resolve(root)] = {
    name: state.project.name,
    scannedAt: new Date().toISOString(),
    lastCommit: state.project.synced,
    steps: plan.length,
    done: plan.filter((p) => p.status === 'done').length,
    blocked: plan.filter((p) => p.status === 'blocked').length,
    modules: (state.modules || []).length
  };
  fs.writeFileSync(INDEX, JSON.stringify(idx, null, 2) + '\n');
}

async function cmdScan(a) {
  const root = path.resolve(a.cwd);
  if (!fs.existsSync(root)) { console.error(`No such folder: ${root}`); process.exit(1); }

  // --json only prints; it must not leave a folder behind in the project.
  const outDir = a.json ? path.join(root, '.agent-lens') : dir(path.join(root, '.agent-lens'));
  const stateFile = path.join(outDir, 'state.json');
  const authoredFile = path.join(outDir, 'authored.json');
  const reportFile = path.resolve(a.out || path.join(outDir, 'report.html'));

  const previous = loadPrevious(stateFile);
  const t0 = Date.now();
  const { state, warnings } = await buildState(root, { previous, planFile: a.planFile });

  // Re-apply what the agent authored. Only the agent's own file is replayed:
  // replaying the whole previous state froze the headline and relabelled a
  // real plan as "reconstructed by your agent".
  const authored = loadAuthored(authoredFile);
  if (authored) {
    applyAuthoring(state, authored, { quiet: true, keepMeasuredPlan: true });
    state.meta.authored = true;
    state.meta.needsAuthoring = false;
  } else if (previous && previous.meta && previous.meta.authored) {
    // Reports authored before 0.2.4 have no saved file; keep names only.
    applyAuthoring(state, { districts: previous.districts, modules: previous.modules, flows: previous.flows }, { quiet: true });
    state.meta.authored = true;
    state.meta.needsAuthoring = false;
  }

  if (a.json) { process.stdout.write(JSON.stringify(state, null, 2) + '\n'); return; }

  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n');
  const { bytes, pinned } = renderToFile(state, reportFile, { version: VERSION, warnings });
  if (pinned) {
    const s = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    s.layout = { pinned };
    fs.writeFileSync(stateFile, JSON.stringify(s, null, 2) + '\n');
  }
  // A folder with nothing in it isn't a project; keep `ls` meaningful.
  if (state.modules.length || state.plan.length) updateIndex(root, state);

  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n  ${state.project.name} — ${state.modules.length} modules, ${state.plan.length} plan steps, ${(state.activity || []).length} recent changes  (${secs}s)`);
  if (state.meta.planFile) console.log(`  plan:   ${state.meta.planFile}`);
  if (state.meta.agentsDetected.length) console.log(`  agents: ${state.meta.agentsDetected.join(', ')}`);
  warnings.forEach((w) => console.log(`  note:   ${w}`));
  for (const c of state.circles || []) console.log(`  watch:  ${c.title}. Ask your agent: "${c.ask}"`);
  const tip = state.meta.planTip;
  if (tip) {
    const why = { guessed: 'Plan statuses above are guesses.', guide: `Progress is measured against ${tip.guideFile}, a setup guide.`, missing: 'There is no plan checklist yet.' }[tip.reason];
    console.log(`  tip:    ${why} Ask your agent to keep a build plan:`);
    console.log(`          npx agent-lens-report plan-tip   (shows lines for ${describeTargets(tip)}; changes nothing)`);
  }
  console.log(`\n  report  ${reportFile}  (${Math.round(bytes / 1024)} KB)`);
  console.log(`  state   ${stateFile}`);
  if (openReport(reportFile, a)) console.log('  opened in your browser');
  if (state.meta.needsAuthoring) {
    console.log(`\n  Folder names are placeholders. For plain-English descriptions, run this\n  inside your coding agent:  npx agent-lens-report author --prompt`);
  }
  console.log('');
}

function cmdRender(a) {
  const root = path.resolve(a.cwd);
  const stateFile = path.join(root, '.agent-lens', 'state.json');
  if (!fs.existsSync(stateFile)) { console.error('No state.json yet — run `npx agent-lens-report` first.'); process.exit(1); }
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  const reportFile = path.resolve(a.out || path.join(root, '.agent-lens', 'report.html'));
  const { bytes } = renderToFile(state, reportFile, { version: VERSION, warnings: [] });
  console.log(`report  ${reportFile}  (${Math.round(bytes / 1024)} KB)`);
}

function cmdAuthor(a) {
  const root = path.resolve(a.cwd);
  const stateFile = path.join(root, '.agent-lens', 'state.json');
  if (!fs.existsSync(stateFile)) { console.error('No state.json yet — run `npx agent-lens-report` first.'); process.exit(1); }
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));

  if (a.apply) {
    const authored = JSON.parse(fs.readFileSync(path.resolve(a.apply), 'utf8'));
    const report = applyAuthoring(state, authored);
    // Kept so every later scan can re-apply it on top of fresh measurements.
    fs.writeFileSync(path.join(root, '.agent-lens', 'authored.json'), JSON.stringify(authored, null, 2) + '\n');
    state.meta.authored = true;
    state.meta.needsAuthoring = false;
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n');
    const reportFile = path.join(root, '.agent-lens', 'report.html');
    renderToFile(state, reportFile, { version: VERSION, warnings: [] });
    console.log(`applied  ${report.names} names, ${report.descriptions} descriptions, ${report.flows} flows${report.plan ? `, ${report.plan} plan steps` : ''}`);
    if (report.rejected.length) console.log(`ignored  ${report.rejected.length} fields that aren't authorable`);
    console.log(`report   ${reportFile}`);
    return;
  }
  process.stdout.write(authoringPrompt(state, root));
}

function cmdPlanTip(a) {
  // Checked fresh rather than read from an old scan, and writes nothing.
  const root = path.resolve(a.cwd);
  const plans = collectPlans(root, { planFile: a.planFile });
  const tip = planTip(root, plans, (plans.agents || []).map((x) => (x === 'claude' ? 'claude-code' : x)));
  if (!tip) { console.log('\n  Nothing to add: the plan is already a checklist your agent can tick off.\n'); return; }
  console.log(`\n  ${{ guessed: 'Plan statuses are guesses right now.', guide: `Progress is measured against ${tip.guideFile}, a setup guide, because no build plan was found.`, missing: 'This project has no plan checklist yet.' }[tip.reason]}`);
  console.log(`  Add these lines to ${describeTargets(tip)} so your agent keeps ${tip.planFile} up to date.`);
  console.log('  agent-lens will not edit that file for you.\n');
  console.log(tip.text.split('\n').map((l) => '    ' + l).join('\n'));
  console.log('\n  Next time your agent works on the project it will keep the checklist, and the');
  console.log('  report will measure real progress against it.\n');
}

function cmdLs() {
  let idx = {};
  try { idx = JSON.parse(fs.readFileSync(INDEX, 'utf8')); } catch { console.log('Nothing scanned yet.'); return; }
  // Forget folders that have been deleted or moved since they were scanned.
  const gone = Object.keys(idx).filter((p) => !fs.existsSync(p));
  if (gone.length) { gone.forEach((p) => delete idx[p]); try { fs.writeFileSync(INDEX, JSON.stringify(idx, null, 2) + '\n'); } catch { /* read-only home */ } }
  const rows = Object.entries(idx).sort((a, b) => (a[1].scannedAt < b[1].scannedAt ? 1 : -1));
  if (!rows.length) { console.log('Nothing scanned yet.'); return; }
  console.log('');
  for (const [p, v] of rows) {
    const pct = v.steps ? Math.round((v.done / v.steps) * 100) + '%' : '—';
    const blocked = v.blocked ? `  ${v.blocked} blocked` : '';
    console.log(`  ${String(pct).padStart(4)}  ${v.name.padEnd(24)} ${String(v.lastCommit || '').padEnd(14)}${blocked}`);
    console.log(`        ${p}`);
  }
  console.log('');
}

async function main() {
  const a = parse(process.argv.slice(2));
  if (a.version) return console.log(VERSION);
  if (a.help) return console.log(HELP);
  const cmd = a._[0] || 'scan';
  try {
    if (cmd === 'scan') return await cmdScan(a);
    if (cmd === 'render') return cmdRender(a);
    if (cmd === 'author') return cmdAuthor(a);
    if (cmd === 'ls') return cmdLs();
    if (cmd === 'plan-tip') return cmdPlanTip(a);
    console.log(HELP);
  } catch (e) {
    console.error(`agent-lens failed: ${e.message}`);
    if (process.env.AGENTLENS_DEBUG) console.error(e.stack);
    process.exit(1);
  }
}

main();
