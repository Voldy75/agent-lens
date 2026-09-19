'use strict';
const { execFileSync } = require('child_process');

function git(cwd, args, max) {
  try {
    return execFileSync('git', args, {
      cwd, encoding: 'utf8', maxBuffer: max || 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore']
    });
  } catch { return null; }
}

function isRepo(cwd) { return git(cwd, ['rev-parse', '--is-inside-work-tree']) !== null; }

const DAY = 864e5;
const ago = (d) => Math.floor((Date.now() - d) / DAY);

function collectGit(cwd, opts = {}) {
  const out = { available: false, commits: [], churn: {}, firstDate: null, lastDate: null, branch: null, name: null };
  if (!isRepo(cwd)) return out;
  out.available = true;

  out.branch = (git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']) || '').trim() || null;
  const remote = (git(cwd, ['config', '--get', 'remote.origin.url']) || '').trim();
  if (remote) out.name = remote.replace(/\.git$/, '').split(/[/:]/).pop();

  // One pass: commit header followed by numstat lines.
  const raw = git(cwd, ['log', '--no-merges', `--max-count=${opts.maxCommits || 4000}`,
    '--numstat', '--date=iso-strict', '--pretty=format:\u0001%H\u0002%at\u0002%an\u0002%s']) || '';

  let cur = null;
  for (const line of raw.split('\n')) {
    if (line.startsWith('\u0001')) {
      if (cur) out.commits.push(cur);
      const [hash, at, author, subject] = line.slice(1).split('\u0002');
      cur = { hash, date: new Date(Number(at) * 1000), author, subject: subject || '', files: [] };
      continue;
    }
    if (!cur || !line.trim()) continue;
    const m = line.split('\t');
    if (m.length < 3) continue;
    const add = m[0] === '-' ? 0 : Number(m[0]);
    const del = m[1] === '-' ? 0 : Number(m[1]);
    let file = m[2];
    // Renames arrive as "old => new" or "dir/{a => b}/f"
    if (file.includes('=>')) file = file.replace(/\{[^}]*=>\s*([^}]*)\}/, '$1').split('=>').pop().trim();
    cur.files.push({ file, add, del });
    const c = (out.churn[file] = out.churn[file] || { commits: 0, add: 0, del: 0, last: null, first: null });
    c.commits++; c.add += add; c.del += del;
    if (!c.last || cur.date > c.last) c.last = cur.date;
    if (!c.first || cur.date < c.first) c.first = cur.date;
  }
  if (cur) out.commits.push(cur);

  if (out.commits.length) {
    out.lastDate = out.commits[0].date;
    out.firstDate = out.commits[out.commits.length - 1].date;
  }
  return out;
}

/** Commits touching a set of files, newest first. */
function commitsTouching(gitData, files) {
  const set = new Set(files);
  return gitData.commits.filter((c) => c.files.some((f) => set.has(f.file)));
}

/** Human activity feed from recent commits, deduped by subject. */
function activityFrom(gitData, limit = 8) {
  const seen = new Set();
  const items = [];
  const fmt = (d) => {
    const a = ago(d);
    if (a === 0) return 'Today';
    if (a === 1) return 'Yday';
    if (a < 7) return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
    return `${d.getDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]}`;
  };
  for (const c of gitData.commits) {
    const key = c.subject.toLowerCase().trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    items.push({ date: fmt(c.date), kind: 'add', text: c.subject.slice(0, 120) });
    if (items.length >= limit) break;
  }
  return items;
}

module.exports = { collectGit, commitsTouching, activityFrom, isRepo, ago };
