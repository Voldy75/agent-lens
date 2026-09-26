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
  // Carried on the array so every caller that resolves imports gets it.
  files.resolver = buildResolver(root, paths);
  return files;
}

/* --------------------------------------------------- non-relative imports */

/** JSON with comments and trailing commas, as tsconfig.json allows. */
function parseLooseJson(text) {
  let out = '', inStr = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (inStr) { out += c; if (c === '\\') { out += n; i++; } else if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === '/' && n === '/') { while (i < text.length && text[i] !== '\n') i++; out += '\n'; continue; }
    if (c === '/' && n === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++; i++; continue; }
    out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

/**
 * Everything needed to resolve imports that are not relative:
 * - "paths" shortcuts such as "@/*" from the nearest tsconfig.json or jsconfig.json
 *   (monorepos have one per app, so each file uses the closest one above it)
 * - "baseUrl" imports such as "components/Button"
 * - workspace packages imported by name, such as "@acme/shared"
 */
function buildResolver(root, paths) {
  const configs = [];
  const packages = [];
  for (const p of paths) {
    const base = path.posix.basename(p);
    const dir = path.posix.dirname(p) === '.' ? '' : path.posix.dirname(p);
    if (base === 'tsconfig.json' || base === 'jsconfig.json') {
      let c;
      try { c = parseLooseJson(fs.readFileSync(path.join(root, p), 'utf8')).compilerOptions || {}; } catch { continue; }
      const baseDir = c.baseUrl ? path.posix.normalize(path.posix.join(dir, c.baseUrl)).replace(/^\.$/, '') : dir;
      const aliases = Object.entries(c.paths || {}).map(([pattern, targets]) => ({ pattern, targets: Array.isArray(targets) ? targets : [] }));
      // A tsconfig with neither is still the nearest config; it just adds nothing.
      configs.push({ dir, baseDir, aliases, baseUrl: !!c.baseUrl });
    } else if (base === 'package.json' && dir) {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
        if (pkg.name) packages.push({ name: pkg.name, dir, main: pkg.main || pkg.module || null });
      } catch { /* not a package */ }
    }
  }
  // Longest directory first, so the nearest config wins.
  configs.sort((a, b) => b.dir.length - a.dir.length);
  packages.sort((a, b) => b.name.length - a.name.length);
  return { configs, packages };
}

function expand(base) {
  const cands = [base];
  const stripped = base.replace(/\.(js|mjs|cjs)$/, '');
  if (stripped !== base) {
    cands.push(stripped);
    for (const e of ['.ts', '.tsx', '.js', '.jsx']) cands.push(stripped + e);
    for (const e of ['.ts', '.tsx', '.js', '.jsx']) cands.push(stripped + '/index' + e);
  }
  for (const e of ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.py', '.go', '.rb', '.vue', '.svelte']) cands.push(base + e);
  for (const e of ['.ts', '.tsx', '.js', '.jsx', '.py']) cands.push(base + '/index' + e);
  cands.push(base + '/__init__.py');
  return cands;
}

const firstHit = (bases, fileSet) => {
  for (const b of bases) for (const c of expand(path.posix.normalize(b).replace(/^\.\//, ''))) if (fileSet.has(c)) return c;
  return null;
};

function resolveNonRelative(fromPath, spec, fileSet, resolver) {
  const cfg = resolver.configs.find((c) => !c.dir || fromPath.startsWith(c.dir + '/'));
  if (cfg) {
    for (const { pattern, targets } of cfg.aliases) {
      const star = pattern.indexOf('*');
      let rest = null;
      if (star < 0) { if (spec === pattern) rest = ''; }
      else {
        const pre = pattern.slice(0, star), post = pattern.slice(star + 1);
        if (spec.startsWith(pre) && spec.endsWith(post) && spec.length >= pre.length + post.length) rest = spec.slice(pre.length, spec.length - post.length);
      }
      if (rest === null) continue;
      const hit = firstHit(targets.map((t) => path.posix.join(cfg.baseDir, t.replace('*', rest))), fileSet);
      if (hit) return hit;
    }
    if (cfg.baseUrl) {
      const hit = firstHit([path.posix.join(cfg.baseDir, spec)], fileSet);
      if (hit) return hit;
    }
  }
  for (const pkg of resolver.packages) {
    if (spec !== pkg.name && !spec.startsWith(pkg.name + '/')) continue;
    const sub = spec.slice(pkg.name.length + 1);
    const bases = sub
      ? [path.posix.join(pkg.dir, sub), path.posix.join(pkg.dir, 'src', sub)]
      : [pkg.main && path.posix.join(pkg.dir, pkg.main), path.posix.join(pkg.dir, 'src', 'index'), path.posix.join(pkg.dir, 'index')].filter(Boolean);
    const hit = firstHit(bases, fileSet);
    if (hit) return hit;
  }
  return null;
}

/**
 * Resolve an import to a real file path in the set. Relative imports always;
 * "@/..." shortcuts, baseUrl imports and workspace packages when a resolver is
 * given. TypeScript ESM writes "./core/index.js" for a file that is index.ts,
 * so .js is also tried as .ts.
 */
function resolveImport(fromPath, spec, fileSet, resolver) {
  if (spec.startsWith('.')) {
    return firstHit([path.posix.join(path.posix.dirname(fromPath), spec)], fileSet);
  }
  return resolver ? resolveNonRelative(fromPath, spec, fileSet, resolver) : null;
}

function readPkgDeps(root) {
  try {
    const p = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    return { name: p.name, version: p.version, deps: Object.keys({ ...p.dependencies, ...p.devDependencies }) };
  } catch { return { name: null, version: null, deps: [] }; }
}

module.exports = { collectFiles, resolveImport, buildResolver, parseLooseJson, readPkgDeps, walk, isTest, CODE };
