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
    out = execFileSync(process.execPath, [BIN, 'scan'], { cwd: dir, encoding: 'utf8' });
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
  execFileSync(process.execPath, [BIN, 'scan'], { cwd: dir, encoding: 'utf8' });
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
  const aout = execFileSync(process.execPath, [BIN, 'author', '--apply', af], { cwd: dir, encoding: 'utf8' });
  ok('authoring applied', /applied\s+2 names/.test(aout), aout.trim());

  const after = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  ok('authored name took effect', after.modules[0].name === 'Checkout' || after.modules.some((m) => m.name === 'Checkout'));
  ok('fabricated module rejected', !after.modules.some((m) => m.id === 'does-not-exist'));
  ok('measured status untouched', after.modules.every((m) => ['built', 'active', 'flag', 'ghost', 'ext'].includes(m.status)));
  ok('flow accepted', after.flows.length === 1);

  execFileSync(process.execPath, [BIN, 'scan'], { cwd: dir, encoding: 'utf8' });
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
  execFileSync(process.execPath, [BIN, 'scan'], { cwd: disc, encoding: 'utf8' });
  const ds = JSON.parse(fs.readFileSync(path.join(disc, '.agent-lens', 'state.json'), 'utf8'));
  ok('finds a custom-named plan file', ds.meta.planFile === 'docs/sprint-7.md', String(ds.meta.planFile));
  ok('rejects a disguised changelog', ds.plan.every((p) => !/retries|totals/i.test(p.title)));
  ok('plan statuses survive discovery', ds.plan.some((p) => p.status === 'blocked'));

  // marker beats scoring
  fs.writeFileSync(path.join(disc, 'weird-name.md'),
    '# Notes\n\n<!-- agent-lens:plan -->\n\n- [x] Alpha\n- [ ] Beta\n');
  execFileSync(process.execPath, [BIN, 'scan'], { cwd: disc, encoding: 'utf8' });
  const ms = JSON.parse(fs.readFileSync(path.join(disc, '.agent-lens', 'state.json'), 'utf8'));
  ok('agent-lens:plan marker wins', ms.meta.planFile === 'weird-name.md', String(ms.meta.planFile));

  // --plan wins over the marker
  const po = execFileSync(process.execPath, [BIN, 'scan', '--plan', 'docs/sprint-7.md'], { cwd: disc, encoding: 'utf8' });
  ok('--plan overrides everything', /docs\/sprint-7\.md/.test(po));

  // credentials never reach the prompt
  fs.writeFileSync(path.join(disc, 'SETUP.md'), '# Setup\n\nUse `api_key=sk-live-zzz` here.\n');
  execFileSync(process.execPath, [BIN, 'scan'], { cwd: disc, encoding: 'utf8' });
  const prompt = execFileSync(process.execPath, [BIN, 'author', '--prompt'], { cwd: disc, encoding: 'utf8' });
  ok('credential-looking docs are skipped', !prompt.includes('sk-live-zzz'));

  // --- degradation --------------------------------------------------------
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-lens-bare-'));
  let bareOut = '';
  try { bareOut = execFileSync(process.execPath, [BIN, 'scan'], { cwd: bare, encoding: 'utf8' }); }
  catch (e) { bareOut = 'CRASH: ' + e.message; }
  ok('empty folder does not crash', !bareOut.startsWith('CRASH'));
  ok('empty folder explains itself', /not a git repository|no recognised source files/.test(bareOut));

  console.log(`\n  ${pass} passed, ${fail} failed`);
  console.log(`  open ${reportFile}\n`);
  if (fail) process.exit(1);
}

main();
