#!/usr/bin/env node
'use strict';

/**
 * Point package.json at your GitHub repo.
 *
 *   node scripts/set-repo.js vijaypanwar/agent-lens
 *
 * npm shows these links on the package page, and people will not install a CLI
 * that reads their session logs without being able to read the source first.
 */

const fs = require('fs');
const path = require('path');

const slug = process.argv[2];
if (!slug || !/^[\w.-]+\/[\w.-]+$/.test(slug)) {
  console.error('usage: node scripts/set-repo.js <user>/<repo>');
  console.error('example: node scripts/set-repo.js vijaypanwar/agent-lens');
  process.exit(1);
}

const p = path.join(__dirname, '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(p, 'utf8'));

pkg.repository = { type: 'git', url: `git+https://github.com/${slug}.git` };
pkg.homepage = `https://github.com/${slug}#readme`;
pkg.bugs = { url: `https://github.com/${slug}/issues` };

fs.writeFileSync(p, JSON.stringify(pkg, null, 2) + '\n');

console.log(`repository  https://github.com/${slug}`);
console.log(`\nnext:`);
console.log(`  git remote add origin git@github.com:${slug}.git`);
console.log(`  git branch -M main`);
console.log(`  git push -u origin main`);
