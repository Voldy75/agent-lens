'use strict';
const fs = require('fs');
const path = require('path');

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt', 'vendor',
  '__pycache__', '.venv', 'venv', 'target', '.cache', 'coverage', '.turbo',
  '.agent-lens', '.idea', '.vscode', 'site-packages', '.pytest_cache'
]);

const LANG = {
  '.ts': 'ts', '.tsx': 'ts', '.js': 'js', '.jsx': 'js', '.mjs': 'js', '.cjs': 'js',
  '.py': 'py', '.rb': 'rb', '.go': 'go', '.rs': 'rs', '.java': 'java', '.kt': 'kt',
  '.php': 'php', '.cs': 'cs', '.swift': 'swift', '.vue': 'js', '.svelte': 'js',
  '.sql': 'sql', '.css': 'css', '.scss': 'css', '.html': 'html'
};
const CODE = new Set(['ts', 'js', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'php', 'cs', 'swift']);

const isTest = (p) =>
  /(^|\/)(tests?|__tests__|spec|e2e)(\/|$)/i.test(p) ||
  /\.(test|spec)\.[a-z]+$/i.test(p) ||
  /(^|\/)test_[^/]+\.py$/i.test(p);

function walk(root, rel = '', acc = [], depth = 0) {
  if (depth > 12) return acc;
  let entries;
  try { entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.agent') continue;
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(root, r, acc, depth + 1);
    } else if (e.isFile()) {
      acc.push(r);
    }
  }
  return acc;
}

const IMPORT_RE = [
  /(?:^|\n)\s*import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g,
  /require\(\s*['"]([^'"]+)['"]\s*\)/g,
  /(?:^|\n)\s*from\s+([A-Za-z0-9_.]+)\s+import\s/g
];

function collectFiles(root) {
  const paths = walk(root);
  const files = [];
  for (const p of paths) {
    const ext = path.extname(p).toLowerCase();
    const lang = LANG[ext];
    if (!lang) continue;
    let text = '';
    let size = 0;
    try {
      size = fs.statSync(path.join(root, p)).size;
      if (size > 900 * 1024) { files.push({ path: p, lang, lines: 0, test: isTest(p), imports: [], huge: true }); continue; }
      text = fs.readFileSync(path.join(root, p), 'utf8');
    } catch { continue; }

    const lines = text ? text.split('\n').length : 0;
    const imports = [];
    if (CODE.has(lang)) {
      for (const re of IMPORT_RE) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(text))) imports.push(m[1]);
      }
    }
    files.push({ path: p, lang, lines, test: isTest(p), imports });
  }
  return files;
}

/** Resolve a relative import to a real file path in the set. */
function resolveImport(fromPath, spec, fileSet) {
  if (!spec.startsWith('.')) return null;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromPath), spec));
  const cands = [base];
  // TypeScript ESM writes "./core/index.js" for a file that is actually index.ts.
  const stripped = base.replace(/\.(js|mjs|cjs)$/, '');
  if (stripped !== base) {
    cands.push(stripped);
    for (const e of ['.ts', '.tsx', '.js', '.jsx']) cands.push(stripped + e);
    for (const e of ['.ts', '.tsx', '.js', '.jsx']) cands.push(stripped + '/index' + e);
  }
  for (const e of ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.py', '.go', '.rb']) cands.push(base + e);
  for (const e of ['.ts', '.tsx', '.js', '.jsx', '.py']) cands.push(base + '/index' + e);
  cands.push(base + '/__init__.py');
  for (const c of cands) if (fileSet.has(c)) return c;
  return null;
}

function readPkgDeps(root) {
  try {
    const p = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    return { name: p.name, version: p.version, deps: Object.keys({ ...p.dependencies, ...p.devDependencies }) };
  } catch { return { name: null, version: null, deps: [] }; }
}

module.exports = { collectFiles, resolveImport, readPkgDeps, walk, isTest, CODE };
