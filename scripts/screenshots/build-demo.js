// Builds the fictional "Pantry Pal" project used for the README screenshots:
// a small git history, a plan file, and a sample Claude Code log in a fake
// home folder. Nothing in it is real.
//
//   node scripts/screenshots/build-demo.js <out-dir>
const fs = require('fs'), os = require('os'), path = require('path'), { execFileSync } = require('child_process');
const OUT = path.resolve(process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'agent-lens-demo-')));
const ROOT = path.join(OUT, 'pantry-pal'), HOME = path.join(OUT, 'home');
const w = (f, t) => { const p = path.join(ROOT, f); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, t); };
const body = (n, tag) => Array.from({ length: n }, (_, i) => `export const ${tag}${i} = ${i};`).join('\n') + '\n';
const imp = (...xs) => xs.map((x, i) => `import { v${i} } from '${x}';`).join('\n') + '\n';
fs.mkdirSync(ROOT, { recursive: true });
const git = (...a) => execFileSync('git', a, { cwd: ROOT, stdio: 'ignore', env: { ...process.env, GIT_AUTHOR_NAME: 'Sam', GIT_AUTHOR_EMAIL: 'sam@example.com', GIT_COMMITTER_NAME: 'Sam', GIT_COMMITTER_EMAIL: 'sam@example.com', ...(global.D ? { GIT_AUTHOR_DATE: global.D, GIT_COMMITTER_DATE: global.D } : {}) } });
const commit = (days, msg) => { global.D = new Date(Date.now() - days * 864e5).toISOString(); git('add', '-A'); git('commit', '-qm', msg); };
git('init', '-q');
w('package.json', JSON.stringify({ name: 'pantry-pal', version: '0.4.0', dependencies: { next: '16', react: '19', '@supabase/supabase-js': '2', zod: '3' } }, null, 2));
w('src/db/client.ts', body(60, 'v'));
w('src/db/schema.ts', imp('./client') + body(80, 'w'));
commit(40, 'Set up the database');
w('src/auth/session.ts', imp('../db/client') + body(90, 'v'));
w('src/auth/login.tsx', imp('./session') + body(70, 'w'));
commit(35, 'Add sign-in with email');
w('src/recipes/search.ts', imp('../db/schema') + body(140, 'v'));
w('src/recipes/card.tsx', imp('./search') + body(60, 'w'));
w('src/recipes/detail.tsx', imp('./search', '../pantry/stock') + body(110, 'x'));
w('src/pantry/stock.ts', imp('../db/schema') + body(100, 'v'));
w('src/pantry/scan.tsx', imp('./stock') + body(80, 'w'));
commit(28, 'Recipe search and pantry tracking');
w('src/planner/week.tsx', imp('../recipes/search', '../pantry/stock') + body(120, 'v'));
w('src/shopping/list.ts', imp('../planner/week', '../pantry/stock') + body(90, 'v'));
commit(20, 'Weekly meal planner and shopping list');
for (let i = 0; i < 6; i++) { w('src/planner/week.tsx', imp('../recipes/search', '../pantry/stock') + body(127 + i * 7, 'v')); commit(13 - i * 2, ['Fix planner week start', 'Planner: handle empty days', 'Planner layout on phones', 'Rework planner drag and drop', 'Planner: undo', 'Planner performance'][i]); }
w('src/checkout/pay.ts', imp('../shopping/list') + body(50, 'v'));
w('tests/recipes.test.ts', imp('../src/recipes/search'));
w('tests/pantry.test.ts', imp('../src/pantry/stock'));
commit(3, 'Start grocery checkout');
w('PLAN.md', `# Pantry Pal — build plan

## Phase 1 — core
- [x] Database and sign-in
- [x] Recipe search
- [x] Pantry tracking — scan barcodes, track what is running low
- [x] Weekly meal planner

## Phase 2 — shopping
- [x] Shopping list built from the planner
- [~] Grocery checkout
- [ ] Payments — blocked on payment provider approval
- [ ] Delivery slots

## Phase 3 — launch
- [ ] Onboarding screens
- [ ] App store listing
`);
w('README.md', '# Pantry Pal\n\nPlan meals from what is already in your kitchen.\n');
commit(1, 'Update plan: checkout in progress');

// Sample Claude Code log in a fake home folder.
const slug = fs.realpathSync(ROOT).replace(/[^a-zA-Z0-9]/g, '-');
const lines = []; let id = 0;
for (let d = 40; d >= 1; d -= 3) for (let k = 0; k < 6 + (d % 5); k++) {
  const ts = new Date(Date.now() - d * 864e5).toISOString();
  lines.push(JSON.stringify({ type: 'assistant', timestamp: ts, requestId: 'r' + id, message: { id: 'msg_' + (id++), usage: { input_tokens: 3000, cache_read_input_tokens: 60000 + d * 900, cache_creation_input_tokens: 4000, output_tokens: 1800 },
    content: [{ type: 'tool_use', input: { file_path: path.join(ROOT, ['src/planner/week.tsx', 'src/recipes/search.ts', 'src/pantry/stock.ts', 'src/shopping/list.ts'][k % 4]) } }] } }));
}
fs.mkdirSync(path.join(HOME, '.claude', 'projects', slug), { recursive: true });
fs.writeFileSync(path.join(HOME, '.claude', 'projects', slug, 'session.jsonl'), lines.join('\n') + '\n');

// Two later sessions where the same type error keeps coming back from the build.
const failing = (sid, d, n) => [
  JSON.stringify({ type: 'assistant', timestamp: new Date(Date.now() - d * 864e5).toISOString(), message: { id: `f_${sid}_${n}`, content: [{ type: 'tool_use', id: `tf_${sid}_${n}`, name: 'Bash', input: { command: 'npm run build' } }] } }),
  JSON.stringify({ type: 'user', timestamp: new Date(Date.now() - d * 864e5).toISOString(), message: { content: [{ type: 'tool_result', tool_use_id: `tf_${sid}_${n}`, is_error: true,
    content: `Exit code 1\nsrc/planner/week.tsx(${40 + n},9): error TS2322: Type 'DayPlan | undefined' is not assignable to type 'DayPlan'.` }] } })
].join('\n');
fs.writeFileSync(path.join(HOME, '.claude', 'projects', slug, 'session-2.jsonl'), [failing('a', 6, 1), failing('a', 6, 2)].join('\n') + '\n');
fs.writeFileSync(path.join(HOME, '.claude', 'projects', slug, 'session-3.jsonl'), [failing('b', 3, 3), failing('b', 3, 4)].join('\n') + '\n');
console.log(OUT);
