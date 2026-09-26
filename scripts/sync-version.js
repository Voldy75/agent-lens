#!/usr/bin/env node
'use strict';

/**
 * Run by `npm version` (see "version" in package.json) after it bumps
 * package.json and before it commits: gives the Claude Code plugin the same
 * version, so the npm package, the plugin and the git tag never drift apart.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const version = require(path.join(root, 'package.json')).version;
const file = path.join(root, 'plugin', '.claude-plugin', 'plugin.json');
const plugin = JSON.parse(fs.readFileSync(file, 'utf8'));
plugin.version = version;
fs.writeFileSync(file, JSON.stringify(plugin, null, 2) + '\n');
console.log(`plugin.json -> ${version}`);
