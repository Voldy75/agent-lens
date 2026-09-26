#!/usr/bin/env node
'use strict';

/**
 * Rebuild everything that shows the report to people who have not installed it:
 *
 *   docs/demo/index.html      the clickable live demo (GitHub Pages)
 *   docs/screenshots/*.png    the README screenshots
 *
 * Both come from the fictional "Pantry Pal" project, so no real project's
 * commits or file names are published.
 *
 *   node scripts/screenshots/regenerate.js            demo page and screenshots
 *   node scripts/screenshots/regenerate.js --no-shots demo page only (no Chrome needed)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.join(__dirname, '..', '..');
const BIN = path.join(REPO, 'bin', 'agent-lens.js');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-lens-demo-'));
const PROJECT = path.join(OUT, 'pantry-pal');
// The demo's own fake home folder, so its sample session logs are read
// instead of yours, and it never lands in your `ls` list.
const env = { ...process.env, HOME: path.join(OUT, 'home'), USERPROFILE: path.join(OUT, 'home'), AGENT_LENS_NO_OPEN: '1' };
const run = (args, cwd) => execFileSync(process.execPath, args, { cwd, env, stdio: 'inherit' });

run([path.join(__dirname, 'build-demo.js'), OUT], REPO);
run([BIN, 'scan'], PROJECT);
run([BIN, 'author', '--apply', path.join(__dirname, 'authored.json')], PROJECT);

const report = path.join(PROJECT, '.agent-lens', 'report.html');
const html = fs.readFileSync(report, 'utf8');
// The report must not carry the temporary folder it was built in.
if (html.includes(OUT) || html.includes(fs.realpathSync(OUT))) throw new Error('demo report contains a local path');
fs.mkdirSync(path.join(REPO, 'docs', 'demo'), { recursive: true });
// Visitors arrive from the README; say up front that this is a sample.
const banner = '<div style="background:#131A21;color:#F3F4EF;font:13px/1.5 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;padding:9px 18px;text-align:center">' +
  'Sample report for a made-up app, &ldquo;Pantry Pal&rdquo;. Click around: every tab works. ' +
  'Get one for your own project: <code style="background:rgba(255,255,255,.12);padding:1px 6px">npx agent-lens-report</code> &middot; ' +
  '<a href="https://github.com/Voldy75/agent-lens-report" style="color:#9DC1F0">GitHub</a></div>';
const page = html.replace(/<body([^>]*)>/, (m) => m + banner);
if (page === html) throw new Error('could not place the demo banner');
fs.writeFileSync(path.join(REPO, 'docs', 'demo', 'index.html'), page);
console.log('\n  demo page    docs/demo/index.html');

if (!process.argv.includes('--no-shots')) {
  run([path.join(__dirname, 'shoot.js'), report, path.join(REPO, 'docs', 'screenshots')], REPO);
  console.log('  screenshots  docs/screenshots/');
}
fs.rmSync(OUT, { recursive: true, force: true });
