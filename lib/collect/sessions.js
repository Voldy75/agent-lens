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

// A folder can be reached by more than one path (on macOS /var is really
// /private/var). Agents log whichever one the shell had, so match either.
const pathsFor = (p) => {
  const out = [path.resolve(p).replace(/[\\/]+$/, '')];
  try { out.push(fs.realpathSync(p).replace(/[\\/]+$/, '')); } catch { /* gone */ }
  return [...new Set(out)];
};
const sameProject = (a, b) => {
  if (!a || !b) return false;
  const other = pathsFor(b);
  return pathsFor(a).some((p) => other.includes(p));
};

/* ---------- events for the going-in-circles check ---------- */

const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);

// Tool outcomes that are about the agent's session, not the project.
const NOT_A_PROJECT_FAILURE = /user doesn't want to proceed|was rejected|permission|denied by|interrupted|timed out|<tool_use_error>|not been read yet/i;

/** Normalised first line of a failed command, so repeats group together. */
function failureKey(text) {
  if (!text || NOT_A_PROJECT_FAILURE.test(text)) return null;
  const lines = text.replace(/\x1b\[[0-9;]*m/g, '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length && /^Exit code \d+$/.test(lines[0])) lines.shift();
  // Prefer the line that names the error over progress chatter.
  // Prefer the line that names the error over progress chatter, and a specific
  // message ("Module not found: ...") over a generic header ("Failed to compile.").
  const line = lines.find((l) => /error|cannot|can't|not found|exception|undefined|missing/i.test(l))
    || lines.find((l) => /failed|✗|FAIL/.test(l)) || lines[0];
  if (!line || line.length < 8) return null;
  const key = line
    .replace(/(?:[A-Za-z]:)?(?:[\\/][^\s:'"()]+)+/g, '<path>')
    .replace(/0x[0-9a-f]+|\b\d+\b/gi, '<n>')
    .replace(/"[^"]{0,120}"|'[^']{0,120}'|`[^`]{0,120}`/g, '<s>')
    .toLowerCase().slice(0, 160);
  return { key, sample: line.slice(0, 160).replace(/[.\s]+$/, '') };
}

function noteEvent(map, key, session, ts, sample) {
  const e = (map[key] = map[key] || { count: 0, sessions: {}, sample });
  e.count++;
  // Latest time per session, so callers can count sessions inside a window.
  if (!e.sessions[session] || (ts && ts > e.sessions[session])) e.sessions[session] = ts || e.sessions[session] || 0;
}

/* ---------- Claude Code ---------- */
// ~/.claude/projects/<slug>/<session>.jsonl, where the slug is the absolute
// path with every character that is not a letter or digit replaced by "-".
// "/Users/me/My App" becomes "-Users-me-My-App" — spaces included, which is
// the common case for people who don't name folders like programmers.
const claudeSlug = (root) => path.resolve(root).replace(/[^a-zA-Z0-9]/g, '-');
const claudeSlugs = (root) => [...new Set(pathsFor(root).map(claudeSlug))];

async function claudeCode(projectRoot, home) {
  const base = path.join(home, '.claude', 'projects');
  if (!fs.existsSync(base)) return { available: false, reason: 'no ~/.claude/projects' };

  const slugs = claudeSlugs(projectRoot);
  let dirs = [];
  try {
    // Exact match only: a suffix match would pull in sessions from a
    // different project whose path happens to end the same way.
    dirs = fs.readdirSync(base).filter((d) => slugs.includes(d));
  } catch { return { available: false, reason: 'could not read ~/.claude/projects' }; }
  if (!dirs.length) return { available: false, reason: 'no Claude Code sessions for this folder' };

  const files = dirs.flatMap((d) => listFiles(path.join(base, d), (n) => n.endsWith('.jsonl')));
  const acc = { sessions: files.length, input: 0, cache: 0, output: 0, messages: 0, days: {}, touched: {}, edits: {}, failures: {} };

  // One API response is written as several lines (one per content block),
  // each repeating the same usage. Count each response once, by message id.
  const seen = new Set();
  for (const f of files) {
    const session = path.basename(f, '.jsonl');
    const toolNames = new Map(); // tool_use id -> tool name, to know what a failed result came from
    await eachLine(f, (o) => {
      const u = o?.message?.usage || o?.usage;
      const id = o?.message?.id || o?.requestId;
      if (u && !(id && seen.has(id))) {
        if (id) seen.add(id);
        const input = u.input_tokens || 0;
        const cache = (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
        const output = u.output_tokens || 0;
        acc.input += input; acc.cache += cache; acc.output += output;
        acc.messages++;
        const d = (o.timestamp || '').slice(0, 10);
        if (d) acc.days[d] = (acc.days[d] || 0) + input + cache + output;
      }
      const inp = o?.message?.content;
      if (Array.isArray(inp)) {
        const ts = Date.parse(o.timestamp || '') || null;
        for (const c of inp) {
          const fp = c?.input?.file_path || c?.input?.path;
          if (typeof fp === 'string') acc.touched[fp] = (acc.touched[fp] || 0) + 1;
          if (c?.type === 'tool_use') {
            if (c.id) toolNames.set(c.id, c.name);
            if (EDIT_TOOLS.has(c.name) && typeof fp === 'string') noteEvent(acc.edits, fp, session, ts);
          }
          // Only failed shell commands count as "the same error again". The
          // agent's own tooling hiccups (a browser timeout, a declined tool
          // call, a permission prompt) are not problems with the project.
          if (c?.type === 'tool_result' && c.is_error && toolNames.get(c.tool_use_id) === 'Bash') {
            const text = typeof c.content === 'string' ? c.content
              : Array.isArray(c.content) ? c.content.map((x) => x?.text || '').join('\n') : '';
            const key = failureKey(text);
            if (key) noteEvent(acc.failures, key.key, session, ts, key.sample);
          }
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

  const acc = { sessions: 0, input: 0, cache: 0, output: 0, messages: 0, days: {}, touched: {} };
  for (const f of files) {
    let cwd = null, mine = false, day = null, last = null, turns = 0;
    await eachLine(f, (o) => {
      const meta = o?.payload?.session_meta || (o?.type === 'session_meta' ? o.payload || o : null);
      if (meta && meta.cwd && cwd === null) {
        cwd = meta.cwd;
        mine = sameProject(cwd, projectRoot);
        day = (meta.timestamp || o.timestamp || '').slice(0, 10) || null;
        if (!mine) return false; // wrong project: stop reading this file immediately
      }
      if (!mine) return;
      // total_token_usage is a running total for the session, repeated on
      // every token_count event. Keep the latest one; summing them counts the
      // start of the session over and over.
      const u = o?.payload?.info?.total_token_usage || o?.payload?.token_usage || o?.token_usage;
      if (u) { last = u; turns++; }
    });
    if (!mine) continue;
    acc.sessions++;
    if (last) {
      const cached = last.cached_input_tokens || 0;
      const input = Math.max(0, (last.input_tokens || 0) - cached);
      const output = last.output_tokens || 0;
      acc.input += input; acc.cache += cached; acc.output += output;
      acc.messages += turns;
      if (day) acc.days[day] = (acc.days[day] || 0) + input + cached + output;
    }
  }
  if (!acc.sessions) return { available: false, reason: 'no Codex sessions for this folder' };
  return { available: true, agent: 'codex', ...acc };
}

/* ---------- Antigravity ---------- */
// Antigravity keeps its artifacts (task.md, implementation_plan.md) outside
// the repo, in ~/.gemini/antigravity/brain/<conversation-id>/. Nothing in
// there names the workspace, but the artifacts link to the files they talk
// about as file:// URIs, so a conversation belongs to this project when its
// artifacts link into this folder. No local token ledger is published, so
// cost is genuinely unavailable rather than merely unimplemented.
const AG_ARTIFACTS = ['task.md', 'implementation_plan.md', 'walkthrough.md'];

function fileUrlFor(p) {
  return 'file://' + p.split(path.sep).map((seg) => encodeURIComponent(seg)).join('/').replace(/^\/?/, '/');
}

function antigravityConversations(projectRoot, home) {
  const brain = path.join(home, '.gemini', 'antigravity', 'brain');
  let ids;
  try { ids = fs.readdirSync(brain, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); }
  catch { return []; }
  const prefixes = pathsFor(projectRoot).flatMap((p) => ['file://' + p, fileUrlFor(p)]);
  const linksHere = (text) => prefixes.some((p) => text.includes(p + '/') || text.includes(p + ')'));
  const out = [];
  for (const id of ids) {
    const dir = path.join(brain, id);
    const artifacts = {};
    for (const name of AG_ARTIFACTS) {
      try {
        const st = fs.statSync(path.join(dir, name));
        if (st.isFile() && st.size < 400 * 1024) artifacts[name] = { text: fs.readFileSync(path.join(dir, name), 'utf8'), mtime: st.mtimeMs };
      } catch { /* not in this conversation */ }
    }
    const texts = Object.values(artifacts).map((a) => a.text);
    if (!texts.length || !texts.some(linksHere)) continue;
    out.push({ id, dir, artifacts, updated: Math.max(...Object.values(artifacts).map((a) => a.mtime)) });
  }
  return out.sort((a, b) => b.updated - a.updated);
}

function antigravity(projectRoot, home) {
  const inRepo = ['task.md', 'implementation_plan.md', 'walkthrough.md', '.agent'].some((m) => fs.existsSync(path.join(projectRoot, m)));
  const convs = antigravityConversations(projectRoot, home);
  return inRepo || convs.length
    ? { available: false, agent: 'antigravity', conversations: convs.length, reason: 'Antigravity runs model calls server-side — no local token ledger to read' }
    : { available: false, reason: 'no Antigravity artifacts' };
}

async function collectSessions(projectRoot, opts = {}) {
  const home = opts.home || os.homedir();
  const results = [];
  for (const fn of [claudeCode, codex]) {
    try { results.push(await fn(projectRoot, home)); }
    catch (e) { results.push({ available: false, reason: `adapter failed: ${e.message}` }); }
  }
  results.push(antigravity(projectRoot, home));

  const live = results.filter((r) => r.available);
  if (!live.length) {
    return { available: false, reasons: results.map((r) => r.reason).filter(Boolean), detected: results.filter(r => r.agent).map(r => r.agent) };
  }

  const merged = { available: true, agents: live.map((r) => r.agent), sessions: 0, input: 0, cache: 0, output: 0, messages: 0, days: {}, touched: {} };
  for (const r of live) {
    merged.sessions += r.sessions; merged.input += r.input; merged.cache += r.cache || 0; merged.output += r.output; merged.messages += r.messages;
    for (const d in r.days) merged.days[d] = (merged.days[d] || 0) + r.days[d];
    for (const t in r.touched) merged.touched[t] = (merged.touched[t] || 0) + r.touched[t];
    for (const kind of ['edits', 'failures']) {
      merged[kind] = merged[kind] || {};
      for (const [k, e] of Object.entries(r[kind] || {})) {
        const m = (merged[kind][k] = merged[kind][k] || { count: 0, sessions: {}, sample: e.sample });
        m.count += e.count; Object.assign(m.sessions, e.sessions);
      }
    }
  }
  merged.reasons = results.filter((r) => !r.available && r.reason).map((r) => r.reason);
  return merged;
}

module.exports = { collectSessions, claudeSlug, antigravityConversations, failureKey };
