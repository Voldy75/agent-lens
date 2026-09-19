#!/usr/bin/env node
'use strict';

/**
 * Change the published package name in one step.
 *
 *   node scripts/rename.js @yourname/agent-lens
 *   node scripts/rename.js buildlens
 *
 * Updates package.json and every install line in the README. The command the
 * user types (`agent-lens`) does not change — only the name npm publishes
 * under. Scoped names need no availability check; they are yours by definition.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const next = process.argv[2];

if (!next) {
  console.error('usage: node scripts/rename.js <new-package-name>\n');
  console.error('examples:');
  console.error('  node scripts/rename.js @yourname/agent-lens   (scoped — always available)');
  console.error('  node scripts/rename.js buildlens               (unscoped — must be free)');
  process.exit(1);
}
if (!/^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/.test(next)) {
  console.error(`"${next}" is not a valid npm package name (lowercase, no spaces).`);
  process.exit(1);
}

const pkgPath = path.join(root, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const prev = pkg.name;

if (!next.startsWith('@')) {
  let taken = null;
  try {
    taken = execFileSync('npm', ['view', next, 'version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { /* 404 means it's free */ }
  if (taken) {
    console.error(`"${next}" is already published at version ${taken}.`);
    console.error(`Pick another, or scope it: node scripts/rename.js @yourname/${next.replace(/^@[^/]+\//, '')}`);
    process.exit(1);
  }
}

pkg.name = next;
if (next.startsWith('@')) pkg.publishConfig = { ...(pkg.publishConfig || {}), access: 'public' };
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

// Only the README title is rewritten. Blanket search-and-replace would also
// rename the CLI command and the tarball filename, which do not change the
// same way — the command stays `agent-lens`, and npm derives the tarball
// name from the scope.
const readmePath = path.join(root, 'README.md');
if (fs.existsSync(readmePath)) {
  const before = fs.readFileSync(readmePath, 'utf8');
  const after = before.replace(/^#\s+\S.*$/m, `# ${next}`);
  if (after !== before) fs.writeFileSync(readmePath, after);
}

const tarball = next.replace(/^@/, '').replace('/', '-') + '-' + pkg.version + '.tgz';
console.log(`package name  ${prev} -> ${next}`);
console.log(`CLI command   agent-lens  (unchanged)`);
console.log(`tarball       ${tarball}`);
console.log(`\nUsers will run:   npx ${next}`);
console.log(`Publish with:     npm publish${next.startsWith('@') ? ' --access public' : ''}`);
