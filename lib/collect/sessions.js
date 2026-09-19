'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');

/**
 * Session adapters. Each one is isolated and fails soft: if a layout has
 * changed or a file is unreadable, we return { available:false, reason } and
 * the Cost tab disappears rather than showing a wrong number.
 *
 * Both adapters stream line by line on purpose. Codex rollout files have been
 * reported at hundreds of megabytes; JSON.parse on the whole file is not an
 * option.
 */

const MAX_BYTES_PER_FILE = 400 * 1024 * 1024;

function listFiles(dir, match, acc = [], depth = 0) {
  if (depth > 6) return acc;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) listFiles(p, match, acc, depth + 1);
    else if (match(e.name)) acc.push(p);
  }
  return acc;
}

async function eachLine(file, fn) {
  let stat;
  try { stat = fs.statSync(file); } catch { return; }
  if (stat.size > MAX_BYTES_PER_FILE) return;
  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line || line[0] !== '{') continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    if (fn(o) === false) break;
  }
}

const sameProject = (a, b) => {
  if (!a || !b) return false;
  const norm = (p) => path.resolve(p).replace(/\/+$/, '');
  return norm(a) === norm(b);
};

/* ---------- Claude Code ---------- */
// ~/.claude/projects/<slugified-cwd>/<session>.jsonl
async function claudeCode(projectRoot, home) {
  const base = path.join(home, '.claude', 'projects');
  if (!fs.existsSync(base)) return { available: false, reason: 'no ~/.claude/projects' };

  const slug = path.resolve(projectRoot).replace(/[\\/.:]/g, '-').replace(/^-+/, '-');
  let dirs = [];
  try {
    dirs = fs.readdirSync(base).filter((d) => d === slug || d.endsWith(slug) || slug.endsWith(d));
  } catch { return { available: false, reason: 'could not read ~/.claude/projects' }; }
  if (!dirs.length) return { available: false, reason: 'no Claude Code sessions for this folder' };

  const files = dirs.flatMap((d) => listFiles(path.join(base, d), (n) => n.endsWith('.jsonl')));
  const acc = { sessions: files.length, input: 0, output: 0, messages: 0, days: {}, touched: {} };

  for (const f of files) {
    await eachLine(f, (o) => {
      const u = o?.message?.usage || o?.usage;
      if (u) {
        acc.input += (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
        acc.output += u.output_tokens || 0;
        acc.messages++;
        const d = (o.timestamp || '').slice(0, 10);
        if (d) acc.days[d] = (acc.days[d] || 0) + (u.input_tokens || 0) + (u.output_tokens || 0);
      }
      const inp = o?.message?.content;
      if (Array.isArray(inp)) {
        for (const c of inp) {
          const fp = c?.input?.file_path || c?.input?.path;
          if (typeof fp === 'string') acc.touched[fp] = (acc.touched[fp] || 0) + 1;
        }
      }
    });
  }
  return { available: true, agent: 'claude-code', ...acc };
}

/* ---------- Codex ---------- */
// ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl, filtered by session_meta.cwd.
// The session_index.jsonl is known to go stale, so we glob the transcripts.
async function codex(projectRoot, home) {
  const base = path.join(home, '.codex', 'sessions');
  if (!fs.existsSync(base)) return { available: false, reason: 'no ~/.codex/sessions' };

  const files = listFiles(base, (n) => n.startsWith('rollout-') && n.endsWith('.jsonl'));
  if (!files.length) return { available: false, reason: 'no Codex rollout files' };

  const acc = { sessions: 0, input: 0, output: 0, messages: 0, days: {}, touched: {} };
  for (const f of files) {
    let cwd = null, mine = false, day = null;
    await eachLine(f, (o) => {
      const meta = o?.payload?.session_meta || (o?.type === 'session_meta' ? o.payload || o : null);
      if (meta && meta.cwd && cwd === null) {
        cwd = meta.cwd;
        mine = sameProject(cwd, projectRoot);
        day = (meta.timestamp || o.timestamp || '').slice(0, 10) || null;
        if (!mine) return false; // wrong project: stop reading this file immediately
      }
      if (!mine) return;
      const u = o?.payload?.info?.total_token_usage || o?.payload?.token_usage || o?.token_usage;
      if (u) {
        acc.input += u.input_tokens || 0;
        acc.output += u.output_tokens || 0;
        acc.messages++;
        if (day) acc.days[day] = (acc.days[day] || 0) + (u.input_tokens || 0) + (u.output_tokens || 0);
      }
    });
    if (mine) acc.sessions++;
  }
  if (!acc.sessions) return { available: false, reason: 'no Codex sessions for this folder' };
  return { available: true, agent: 'codex', ...acc };
}

/* ---------- Antigravity ---------- */
// Artifacts are in-repo markdown; no local token ledger is published, so cost
// is genuinely unavailable rather than merely unimplemented. Say so plainly.
function antigravity(projectRoot) {
  const marks = ['task.md', 'implementation_plan.md', 'walkthrough.md', '.agent'];
  const present = marks.some((m) => fs.existsSync(path.join(projectRoot, m)));
  return present
    ? { available: false, agent: 'antigravity', reason: 'Antigravity runs model calls server-side — no local token ledger to read' }
    : { available: false, reason: 'no Antigravity artifacts' };
}

async function collectSessions(projectRoot, opts = {}) {
  const home = opts.home || os.homedir();
  const results = [];
  for (const fn of [claudeCode, codex]) {
    try { results.push(await fn(projectRoot, home)); }
    catch (e) { results.push({ available: false, reason: `adapter failed: ${e.message}` }); }
  }
  results.push(antigravity(projectRoot));

  const live = results.filter((r) => r.available);
  if (!live.length) {
    return { available: false, reasons: results.map((r) => r.reason).filter(Boolean), detected: results.filter(r => r.agent).map(r => r.agent) };
  }

  const merged = { available: true, agents: live.map((r) => r.agent), sessions: 0, input: 0, output: 0, messages: 0, days: {}, touched: {} };
  for (const r of live) {
    merged.sessions += r.sessions; merged.input += r.input; merged.output += r.output; merged.messages += r.messages;
    for (const d in r.days) merged.days[d] = (merged.days[d] || 0) + r.days[d];
    for (const t in r.touched) merged.touched[t] = (merged.touched[t] || 0) + r.touched[t];
  }
  merged.reasons = results.filter((r) => !r.available && r.reason).map((r) => r.reason);
  return merged;
}

module.exports = { collectSessions };
