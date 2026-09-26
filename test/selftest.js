#!/usr/bin/env node
'use strict';

/**
 * Self-test. Builds a throwaway git repo, scans it, applies an authoring pass,
 * and checks the report came out intact. Run after installing:
 *
 *   agent-lens-selftest        (if installed globally)
 *   node test/selftest.js       (from a checkout)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const BIN = path.join(__dirname, '..', 'bin', 'agent-lens.js');
let pass = 0, fail = 0;

function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? '  — ' + detail : ''}`); }
}

// Every run gets its own fake home folder, so the selftest never reads your
// real agent logs and never adds its throwaway projects to your `ls` list.
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-lens-home-'));
const ENV = { ...process.env, HOME, USERPROFILE: HOME };
const run = (args, cwd) => execFileSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', env: ENV });
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const gitInit = (cwd) => {
  try {
    execFileSync('git', ['init', '-q'], { cwd, stdio: 'ignore' });
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A'], { cwd, stdio: 'ignore' });
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'i'], { cwd, stdio: 'ignore' });
  } catch { /* git unavailable; the checks below do not depend on it */ }
};
const stateOf = (cwd) => JSON.parse(fs.readFileSync(path.join(cwd, '.agent-lens', 'state.json'), 'utf8'));

function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-lens-selftest-'));
  console.log(`\nagent-lens selftest\n  scratch ${dir}\n`);

  // --- build a small repo -------------------------------------------------
  fs.mkdirSync(path.join(dir, 'src', 'checkout'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src', 'catalog'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src', 'db'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'test'), { recursive: true });

  const body = (n) => Array.from({ length: n }, (_, i) => `export const v${i} = ${i};`).join('\n');
  fs.writeFileSync(path.join(dir, 'src/db/client.ts'), body(60));
  fs.writeFileSync(path.join(dir, 'src/catalog/list.ts'), `import { v0 } from '../db/client.js';\n` + body(80));
  fs.writeFileSync(path.join(dir, 'src/catalog/card.ts'), body(30));
  fs.writeFileSync(path.join(dir, 'src/checkout/form.ts'), `import { v0 } from '../catalog/list.js';\n` + body(90));
  fs.writeFileSync(path.join(dir, 'test/catalog.test.ts'), `import { v0 } from '../src/catalog/list.js';\n`);
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'selftest-app', version: '0.2.0' }, null, 2));
  fs.writeFileSync(path.join(dir, 'task.md'), [
    '# Task: Build the shop',
    '',
    '- [x] Set up the database',
    '- [x] Product catalog',
    '- [~] Checkout form',
    '- [ ] Payment capture — blocked on gateway approval',
    '- [ ] Order emails'
  ].join('\n'));

  const g = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
  try {
    g('init', '-q');
    g('-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A');
    g('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'initial shop scaffold');
  } catch { console.log('  skip  git unavailable — some checks will be weaker'); }

  // --- scan ---------------------------------------------------------------
  let out = '';
  try {
    out = run(['scan'], dir);
  } catch (e) {
    console.log(`  FAIL  scan crashed: ${e.message}`);
    process.exit(1);
  }
  ok('scan runs', out.includes('selftest-app'));

  const stateFile = path.join(dir, '.agent-lens', 'state.json');
  const reportFile = path.join(dir, '.agent-lens', 'report.html');
  ok('state.json written', fs.existsSync(stateFile));
  ok('report.html written', fs.existsSync(reportFile));

  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  ok('modules found', state.modules.length >= 3, `${state.modules.length} modules`);
  ok('imports resolved into edges', state.edges.length >= 2, `${state.edges.length} edges`);
  ok('plan parsed', state.plan.length === 5, `${state.plan.length} steps`);
  ok('done steps detected', state.plan.filter((p) => p.status === 'done').length === 2);
  ok('in-progress step detected', state.plan.some((p) => p.status === 'active'));
  ok('blocked step detected', state.plan.some((p) => p.status === 'blocked'));
  ok('blocker surfaced', state.blockers.length === 1);
  ok('antigravity artifact detected', (state.meta.agentsDetected || []).includes('antigravity'));

  const tested = state.modules.find((m) => m.id.includes('catalog'));
  ok('catalog module present', !!tested);

  const html = fs.readFileSync(reportFile, 'utf8');
  ok('report is self-contained', !/<script\s+src=|<link[^>]+href="http/i.test(html));
  ok('report embeds state', html.includes('const STATE ='));
  ok('no unreplaced placeholders', !html.includes('__STATE__') && !html.includes('__TITLE__'));

  // --- determinism --------------------------------------------------------
  const first = fs.readFileSync(reportFile, 'utf8').match(/const STATE = .*/)[0];
  run(['scan'], dir);
  const second = fs.readFileSync(reportFile, 'utf8').match(/const STATE = .*/)[0];
  ok('two scans give identical state', first === second);

  // --- authoring ----------------------------------------------------------
  const authored = {
    modules: state.modules.slice(0, 2).map((m, i) => ({
      id: m.id, name: ['Checkout', 'Catalog'][i], description: 'Authored in the selftest.'
    })).concat([{ id: 'does-not-exist', name: 'Injected', description: 'should be rejected' }]),
    flows: state.modules.length >= 2 ? [{
      id: 'buy', name: 'Buy something', status: 'built', description: 'Selftest flow.',
      path: state.modules.slice(0, 2).map((m) => ({ module: m.id, note: 'step' }))
    }] : [],
    summary: { headline: 'Authored headline.', subhead: 'Authored subhead.' }
  };
  const af = path.join(dir, 'authored.json');
  fs.writeFileSync(af, JSON.stringify(authored));
  const aout = run(['author', '--apply', af], dir);
  ok('authoring applied', /applied\s+2 names/.test(aout), aout.trim());

  const after = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  ok('authored name took effect', after.modules[0].name === 'Checkout' || after.modules.some((m) => m.name === 'Checkout'));
  ok('fabricated module rejected', !after.modules.some((m) => m.id === 'does-not-exist'));
  ok('measured status untouched', after.modules.every((m) => ['built', 'active', 'flag', 'ghost', 'ext'].includes(m.status)));
  ok('flow accepted', after.flows.length === 1);

  run(['scan'], dir);
  const rescanned = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  ok('authoring survives a rescan', rescanned.flows.length === 1 && rescanned.modules.some((m) => m.name === 'Checkout'));

  // --- plan discovery -----------------------------------------------------
  const disc = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-lens-discovery-'));
  fs.mkdirSync(path.join(disc, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(disc, 'src', 'app'), { recursive: true });
  fs.writeFileSync(path.join(disc, 'src/app/x.ts'), body(40));
  // a decoy changelog that does not use the word "changelog"
  fs.writeFileSync(path.join(disc, 'RELEASE-NOTES.md'),
    '# Release notes\n\n## v2.1.0 - 2026-08-02\n- Add retries\n- Fix totals\n- Build the page\n- Implement search\n');
  fs.writeFileSync(path.join(disc, 'docs/sprint-7.md'),
    '# Sprint 7\n\n## Remaining work\n- [x] Search\n- [~] Checkout\n- [ ] Payments — blocked on keys\n');
  try {
    execFileSync('git', ['init', '-q'], { cwd: disc, stdio: 'ignore' });
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A'], { cwd: disc, stdio: 'ignore' });
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'i'], { cwd: disc, stdio: 'ignore' });
  } catch { /* fine */ }
  run(['scan'], disc);
  const ds = JSON.parse(fs.readFileSync(path.join(disc, '.agent-lens', 'state.json'), 'utf8'));
  ok('finds a custom-named plan file', ds.meta.planFile === 'docs/sprint-7.md', String(ds.meta.planFile));
  ok('rejects a disguised changelog', ds.plan.every((p) => !/retries|totals/i.test(p.title)));
  ok('plan statuses survive discovery', ds.plan.some((p) => p.status === 'blocked'));

  // marker beats scoring
  fs.writeFileSync(path.join(disc, 'weird-name.md'),
    '# Notes\n\n<!-- agent-lens:plan -->\n\n- [x] Alpha\n- [ ] Beta\n');
  run(['scan'], disc);
  const ms = JSON.parse(fs.readFileSync(path.join(disc, '.agent-lens', 'state.json'), 'utf8'));
  ok('agent-lens:plan marker wins', ms.meta.planFile === 'weird-name.md', String(ms.meta.planFile));

  // --plan wins over the marker
  const po = run(['scan', '--plan', 'docs/sprint-7.md'], disc);
  ok('--plan overrides everything', /docs\/sprint-7\.md/.test(po));

  // credentials never reach the prompt
  fs.writeFileSync(path.join(disc, 'SETUP.md'), '# Setup\n\nUse `api_key=sk-live-zzz` here.\n');
  run(['scan'], disc);
  const prompt = run(['author', '--prompt'], disc);
  ok('credential-looking docs are skipped', !prompt.includes('sk-live-zzz'));

  // --- degradation --------------------------------------------------------
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-lens-bare-'));
  let bareOut = '';
  try { bareOut = run(['scan'], bare); }
  catch (e) { bareOut = 'CRASH: ' + e.message; }
  ok('empty folder does not crash', !bareOut.startsWith('CRASH'));
  ok('empty folder explains itself', /not a git repository|no recognised source files/.test(bareOut));

  fixes();

  console.log(`\n  ${pass} passed, ${fail} failed`);
  console.log(`  open ${reportFile}\n`);
  if (fail) process.exit(1);
}

/* Regression checks for problems found by running 0.2.3 on real projects. */
function fixes() {
  const body = (n) => Array.from({ length: n }, (_, i) => `export const v${i} = ${i};`).join('\n');

  // --- a folder name with spaces, and Claude Code logs for it -------------
  const proj = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-lens-fix-')), 'My Shop App');
  write(path.join(proj, 'src/app/main.ts'), body(30));
  fs.mkdirSync(proj, { recursive: true });
  // Agents log the physical path (on macOS the temp folder /var is really /private/var).
  const real = fs.realpathSync(proj);
  const slug = real.replace(/[^a-zA-Z0-9]/g, '-');
  const usage = { input_tokens: 1e5, cache_read_input_tokens: 1e7, cache_creation_input_tokens: 0, output_tokens: 1e6 };
  const reply = (id) => JSON.stringify({ type: 'assistant', timestamp: '2026-09-01T10:00:00Z', requestId: 'r' + id, message: { id: 'msg_' + id, usage, content: [{ type: 'tool_use', input: { file_path: path.join(real, 'src/app/main.ts') } }] } });
  // One API response is logged as several lines; a second response once.
  write(path.join(HOME, '.claude', 'projects', slug, 's1.jsonl'), [reply(1), reply(1), reply(1), reply(2)].join('\n') + '\n');

  // --- a Codex session whose token_count events are running totals --------
  const tc = (inp, cached, out) => JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: inp, cached_input_tokens: cached, output_tokens: out } } } });
  write(path.join(HOME, '.codex', 'sessions', '2026', '09', '02', 'rollout-x.jsonl'), [
    JSON.stringify({ type: 'session_meta', timestamp: '2026-09-02T10:00:00Z', payload: { cwd: real } }),
    tc(1e6, 0, 1e5), tc(2.5e6, 1e6, 3e5), tc(4e6, 2e6, 5e5)
  ].join('\n') + '\n');

  // --- an Antigravity task list kept outside the repo ---------------------
  write(path.join(HOME, '.gemini', 'antigravity', 'brain', 'abcdef12-0000', 'task.md'), [
    '# Task', '', `Working in [main.ts](file://${real.split(path.sep).map(encodeURIComponent).join('/').replace(/^\/?/, '/')}/src/app/main.ts)`, '',
    '- [x] Scaffold the app', '- [/] Build the cart', '- [ ] Add payments', ''
  ].join('\n'));
  // Another conversation, for a different project, must be ignored.
  write(path.join(HOME, '.gemini', 'antigravity', 'brain', 'ffff0000-1111', 'task.md'),
    '# Task\n\nSee [x](file:///somewhere/else/x.ts)\n\n- [x] One\n- [x] Two\n- [x] Three\n- [x] Four\n');

  // --- decoys: a README and a setup guide full of checkboxes --------------
  write(path.join(proj, 'README.md'), '# My Shop\n\n## Roadmap\n- [x] a\n- [x] b\n- [ ] c\n- [ ] d\n');
  write(path.join(proj, 'MOBILE_SETUP.md'), '# Mobile setup\n\n## Steps\n' + Array.from({ length: 12 }, (_, i) => `- [ ] Configure thing ${i}`).join('\n') + '\n');
  gitInit(proj);

  const out = run(['scan'], proj);
  const st = stateOf(proj);
  const stat = (label) => ((st.cost.stats || []).find((x) => x.label === label) || {}).value;

  ok('finds Claude Code logs for a folder with spaces', st.meta.agentsDetected.includes('claude-code'), st.meta.agentsDetected.join(','));
  // 2 unique Claude replies (4 log lines) + 3 Codex turns.
  ok('counts each Claude reply once', stat('Replies') === '5', `replies ${stat('Replies')}`);
  // Claude: 2 unique replies x 11.1M = 22.2M (counting every log line gives 44.4M).
  // Codex: the last running total, 4M in + 0.5M out = 4.5M (summing them gives 8.4M).
  ok('token total is not inflated', stat('Tokens') === '26.7M', `tokens ${stat('Tokens')}`);
  ok('cost total matches the weekly chart', Math.abs(st.cost.series.reduce((n, w) => n + w.value, 0) - 26.7) < 0.05, JSON.stringify(st.cost.series));
  ok('finds the Antigravity task list outside the repo', /^Antigravity task list/.test(st.meta.planFile || ''), String(st.meta.planFile));
  ok('Antigravity statuses read', st.plan.length === 3 && st.plan[1].status === 'active', JSON.stringify(st.plan.map((p) => p.status)));
  ok('README is never the plan', st.meta.planFile !== 'README.md');
  ok('a setup guide does not beat a real plan', st.meta.planFile !== 'MOBILE_SETUP.md');
  ok('no noise about agents you do not use', !/no Codex sessions|no Antigravity artifacts|scan was incomplete/i.test(out + fs.readFileSync(path.join(proj, '.agent-lens', 'report.html'), 'utf8')));

  // A doc that explains the marker inside a code block is not using it.
  const doc = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-lens-fix-'));
  write(path.join(doc, 'src/a/x.ts'), body(5));
  write(path.join(doc, 'GUIDE-TO-TOOL.md'), '# How it works\n\n## Plan\n\n```markdown\n<!-- agent-lens:plan -->\n```\n\n- [x] a\n- [ ] b\n');
  write(path.join(doc, 'PLAN.md'), '# Plan\n\n- [x] Real one\n- [ ] Real two\n- [ ] Real three\n');
  run(['scan'], doc);
  ok('marker inside a code block is ignored', stateOf(doc).meta.planFile === 'PLAN.md', String(stateOf(doc).meta.planFile));

  // --- plan text: wrapped items and long titles ---------------------------
  const wrap = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-lens-fix-'));
  write(path.join(wrap, 'src/a/x.ts'), body(10));
  write(path.join(wrap, 'PLAN.md'), [
    '# Plan', '',
    '- [ ] Export ANDROID_HOME in your shell profile so every build can find the SDK without setting it per command',
    '- [ ] Upload the APNs key to Firebase', '  this is what lets push notifications reach iPhones',
    '- [x] Done thing here', ''
  ].join('\n'));
  run(['scan'], wrap);
  const wp = stateOf(wrap).plan;
  ok('long step titles break between words', wp[0] && !/\w…\w/.test(wp[0].title + wp[0].description) && /…$/.test(wp[0].title) && wp[0].title.endsWith('without…') === false && !/ \w{1,2}…$/.test(wp[0].title), wp[0] && wp[0].title);
  ok('wrapped plan items stay whole', wp.some((p) => /reach iPhones/.test(p.title + ' ' + p.description)), JSON.stringify(wp.map((p) => p.title + ' | ' + p.description)));

  // --- authoring must not freeze the plan or the headline -----------------
  const snap = stateOf(wrap);
  const af = path.join(wrap, 'authored.json');
  write(af, JSON.stringify({
    modules: [{ id: snap.modules[0].id, name: 'Android build', description: 'Build settings.' }],
    summary: { headline: 'Everything is finished!', subhead: 'Trust me.' }
  }));
  run(['author', '--apply', af], wrap);
  const authored = stateOf(wrap);
  ok('agent cannot replace the measured headline', /\[\[1 of 3 steps\]\]/.test(authored.summary.headline), authored.summary.headline);
  ok("agent's summary is shown separately", /Everything is finished/.test(authored.summary.about || ''));
  write(path.join(wrap, 'PLAN.md'), '# Plan\n\n- [x] One\n- [x] Two\n- [x] Three\n- [ ] Four\n');
  run(['scan'], wrap); run(['scan'], wrap);
  const later = stateOf(wrap);
  ok('rescans pick up plan changes after authoring', later.plan.length === 4 && later.plan.filter((p) => p.status === 'done').length === 3, later.summary.headline);
  ok('real plan is not relabelled as reconstructed', later.plan.every((p) => !/reconstructed/.test((p.evidence || []).join())));
  ok('authored names survive two rescans', later.modules.some((m) => m.name === 'Android build'));

  // The cost breakdown follows authored names, and one-off files are not "rewrites".
  const shopMod = st.modules.find((m) => (st.cost.byArea || []).some((r) => r.id === m.id));
  if (shopMod) {
    const af2 = path.join(proj, 'authored.json');
    write(af2, JSON.stringify({ modules: [{ id: shopMod.id, name: 'Storefront', description: 'x' }] }));
    run(['author', '--apply', af2], proj);
  }
  ok('cost breakdown uses authored names', !!shopMod && stateOf(proj).cost.byArea.some((r) => r.label === 'Storefront'), JSON.stringify(stateOf(proj).cost.byArea));
  ok('files changed once are not listed as rewrites', stateOf(proj).health.rows.every((r) => r.rewrites >= 2), JSON.stringify(stateOf(proj).health.rows.map((r) => r.rewrites)));
  ok('"1 test file", not "1 test files"', !/\b1 test files\b/.test(JSON.stringify(stateOf(proj).health)));

  // --- the index and the commands -----------------------------------------
  const idx = JSON.parse(fs.readFileSync(path.join(HOME, '.agent-lens', 'projects.json'), 'utf8'));
  ok('selftest projects stay out of your real ls list', Object.keys(idx).some((p) => p.includes('My Shop App')));
  const gone = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-lens-fix-'));
  write(path.join(gone, 'src/a/x.ts'), body(5)); write(path.join(gone, 'PLAN.md'), '# Plan\n\n- [ ] a\n- [ ] b\n- [ ] c\n');
  run(['scan'], gone); fs.rmSync(gone, { recursive: true, force: true });
  ok('ls forgets deleted folders', !run(['ls'], wrap).includes(gone));
  const prompt = run(['author', '--prompt'], wrap);
  ok('printed commands work without a global install', /npx agent-lens-report author --apply/.test(prompt) && !/(^|\s)agent-lens author/m.test(prompt));
  const jsonDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-lens-fix-'));
  run(['--json'], jsonDir);
  ok('--json leaves nothing behind', !fs.existsSync(path.join(jsonDir, '.agent-lens')));

  // --- plan tip: suggest lines for CLAUDE.md, never write them -------------
  const tipProj = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-lens-fix-'));
  write(path.join(tipProj, 'src/a/x.ts'), body(5));
  write(path.join(tipProj, 'handoff.md'), '# Handoff\n\nNotes for whoever picks this up next, human or agent.\n\n## Plan\n- Search is done\n- Checkout in progress\n- Payments blocked on keys from the provider\n- Order emails\n\n## Status\nWorking on checkout this week.\n');
  const claudeMd = '# My app\n\nUse TypeScript.\n';
  write(path.join(tipProj, 'CLAUDE.md'), claudeMd);
  gitInit(tipProj);
  const before = fs.readdirSync(tipProj).sort().join(',');
  const tipOut = run(['scan'], tipProj);
  const tip = stateOf(tipProj).meta.planTip;
  ok('suggests plan lines when statuses are guesses', !!tip && tip.reason === 'guessed' && tip.planFile === 'handoff.md', JSON.stringify(tip));
  ok('suggestion names the instruction file the project has', !!tip && tip.targets.length === 1 && tip.targets[0].file === 'CLAUDE.md');
  ok('scan points to the plan-tip command', /npx agent-lens-report plan-tip/.test(tipOut));
  ok('CLAUDE.md is never modified', fs.readFileSync(path.join(tipProj, 'CLAUDE.md'), 'utf8') === claudeMd);
  ok('no files are added outside .agent-lens', fs.readdirSync(tipProj).filter((f) => f !== '.agent-lens').sort().join(',') === before.split(',').filter((f) => f !== '.agent-lens').join(','));
  const tipCmd = run(['plan-tip'], tipProj);
  const freshDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-lens-fix-'));
  write(path.join(freshDir, 'src/a/x.ts'), body(5));
  ok('plan-tip works without a scan and writes nothing', /Project plan \(read by agent-lens\)/.test(run(['plan-tip'], freshDir)) && !fs.existsSync(path.join(freshDir, '.agent-lens')));
  ok('plan-tip prints the lines to add', /Project plan \(read by agent-lens\)/.test(tipCmd) && /handoff\.md/.test(tipCmd) && /will not edit/.test(tipCmd));
  const tipHtml = fs.readFileSync(path.join(tipProj, '.agent-lens', 'report.html'), 'utf8');
  const embedded = JSON.parse(tipHtml.match(/const STATE = (.*);\s*$/m)[1]);
  ok('report embeds the suggestion for the page to show', embedded.planTip && embedded.planTip.reason === 'guessed', JSON.stringify(Object.keys(embedded)));
  // Once the user has pasted the lines in, stop asking.
  write(path.join(tipProj, 'CLAUDE.md'), claudeMd + '\n' + tip.text + '\n');
  run(['scan'], tipProj);
  ok('no suggestion once the lines are in CLAUDE.md', !stateOf(tipProj).meta.planTip);
  // A real checklist needs no suggestion.
  ok('no suggestion for a checkbox plan', !stateOf(wrap).meta.planTip);
  // A setup guide that won only because nothing else qualified still gets the suggestion.
  const guideProj = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-lens-fix-'));
  write(path.join(guideProj, 'src/a/x.ts'), body(5));
  write(path.join(guideProj, 'MOBILE_SETUP.md'), '# Mobile setup\n\n## Steps\n' + Array.from({ length: 12 }, (_, i) => `- [${i < 3 ? 'x' : ' '}] Set up thing ${i}`).join('\n') + '\n\n## Remaining checklist\n- [ ] Submit to the store\n');
  // Like a real one, it has been edited several times.
  gitInit(guideProj);
  for (let i = 0; i < 3; i++) {
    fs.appendFileSync(path.join(guideProj, 'MOBILE_SETUP.md'), `\nNote ${i}.\n`);
    try { execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qam', 'edit ' + i], { cwd: guideProj, stdio: 'ignore' }); } catch { /* git unavailable */ }
  }
  run(['scan'], guideProj);
  const gt = stateOf(guideProj);
  ok('suggests a build plan when progress comes from a setup guide', gt.meta.planFile === 'MOBILE_SETUP.md' && gt.meta.planTip && gt.meta.planTip.reason === 'guide' && gt.meta.planTip.planFile === 'PLAN.md', JSON.stringify(gt.meta.planTip));

  // No plan and no instruction files: offer both, with a new PLAN.md.
  const bareTip = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-lens-fix-'));
  write(path.join(bareTip, 'src/a/x.ts'), body(5));
  run(['scan'], bareTip);
  const bt = stateOf(bareTip).meta.planTip;
  ok('with no plan, suggests a new PLAN.md for either agent file', !!bt && bt.reason === 'missing' && bt.planFile === 'PLAN.md' && bt.targets.map((t) => t.file).join() === 'CLAUDE.md,AGENTS.md', JSON.stringify(bt));

  // --- the map: clicking a building must reach the building ---------------
  const tpl = fs.readFileSync(path.join(__dirname, '..', 'lib', 'template.html'), 'utf8');
  const down = (tpl.match(/addEventListener\("pointerdown",[^\n]*/) || [''])[0];
  ok('map does not capture the pointer on press', down && !/setPointerCapture/.test(down));
}

main();
