# agent-lens-report

See where an agent-built project actually stands — without reading the code.

Point it at a folder. It reads git history, your plan files, and (if present)
your coding agent's local session logs, and writes one self-contained HTML
report: what's done, what's in progress, what's blocked, what the agent kept
rewriting, what it cost, and a map of the codebase you can click through.

Run it in any project folder — no install needed:

```bash
npx agent-lens-report
```

Or install it once and use the short `agent-lens` command:

```bash
npm install -g agent-lens-report
agent-lens
```

Verify the install with `agent-lens-selftest` — it builds a throwaway repo,
scans it, and checks 24 things end to end.

No config, no API key, no account. Everything runs on your machine
and nothing is uploaded.

## What you get

```
.agent-lens/
  state.json     the facts, versioned and diffable
  report.html    open it in any browser
```

| Tab | Answers |
|---|---|
| **Now** | Where am I, what changed, what's stuck |
| **Plan** | Each step's status, linked to the modules it touched |
| **Health** | What got rewritten most, what has no tests |
| **Map** | Isometric map of the codebase, real imports between modules |
| **Cost** | Tokens and sessions per week, and where they went |

Tabs you have no data for don't appear, and the report says so on the Now tab
rather than pretending the scan was complete.

## Works with

| Agent | Plan status | Cost | Notes |
|---|---|---|---|
| **Antigravity** | best — `task.md` checkboxes carry real state | no | model runs server-side, no local token ledger |
| **Claude Code** | `CLAUDE.md`, freeform | yes | reads `~/.claude/projects/*.jsonl` |
| **Codex** | `AGENTS.md`, freeform | yes | reads `~/.codex/sessions/**/rollout-*.jsonl`, filtered by `session_meta.cwd` |
| **Cursor / other** | any `PLAN.md`, `TODO.md` | no | git tier always works |
| **No agent** | commits only | no | still gives timeline, health, and map |

Mixing agents in one repo is fine — adapters merge into the same state file.
If you plan in Antigravity and execute in Codex, this is the only place the
whole picture exists.

## Commands

```bash
npx agent-lens-report                  # scan this folder, write the report
npx agent-lens-report -C ../other-app  # scan somewhere else
npx agent-lens-report ls               # every project you've scanned, with % done
npx agent-lens-report render           # re-render without rescanning
npx agent-lens-report author --prompt  # get better names and descriptions
```

## Making it readable: the authoring pass

A scan alone gives you `src-core-http2-client`, not "Connection handling". Real
names need a model — so agent-lens uses the one already sitting next to you.

Inside Claude Code, Codex, Cursor, or Antigravity:

```
agent-lens author --prompt
```

Paste the output to your agent. It writes `agent-lens.authored.json`, then:

```
agent-lens author --apply agent-lens.authored.json
```

No API key, no code leaving the machine, no cost to you. **The agent can only
rename and describe.** It cannot invent modules, change a status, or touch a
file count — anything outside the allowed shape is dropped and reported. Every
number in the report stays measured.

Authored names survive rescans. Re-run `author` when the shape changes a lot.

### Where the plan comes from

There is no fixed filename. Every markdown file in the repo root, `docs/`,
`notes/`, `.agent/`, `.claude/` and `.github/` is read and scored on what is
actually in it — checkbox density, plan-shaped headings, action bullets, how
often git touches it — with penalties for things that merely look like plans.
Changelogs are the classic false positive and are scored down hard, including
ones not named CHANGELOG.

The report always names the file it chose, why, and what else it considered,
so a wrong pick is visible rather than silent.

To decide it yourself, in order of precedence:

```bash
agent-lens --plan docs/sprint-7.md        # one run
echo '{"plan":"docs/sprint-7.md"}' > .agent-lens.json   # every run
```

Or put this anywhere in the file you use, and it wins regardless of its name:

```markdown
<!-- agent-lens:plan -->
```

### Other docs become context, not steps

README, ARCHITECTURE, specs and notes are never mined for plan steps — there
is no reliable structure in them. They are passed to `author --prompt` as
context instead, so your agent's names and descriptions match how the project
already talks about itself. Files that look like they contain credentials are
skipped rather than pasted into a prompt.

### If your plan file has no checkboxes

A freeform `CLAUDE.md` or `AGENTS.md` usually has no checklist to read. Two
things happen:

1. The scan looks for a section headed something like *Roadmap*, *Plan*, or
   *TODO* and reads its bullets. `~~struck through~~`, "done", "in progress",
   and "blocked" are recognised. Statuses from this path are guesses, and the
   report says so.
2. If that finds nothing, `author --prompt` asks your agent to reconstruct the
   plan from the repo and its git history. Those steps are labelled
   *reconstructed by your agent* in the report, so nobody mistakes them for a
   ticked box.

The agent is told to prefer "active" over "done" when it can't tell. A wrong
"done" is the worst error this tool can make.

## How it decides things

Everything on the page is measured or read from a file you control:

- **Modules** are folders. Big folders split one level deeper until the map has
  enough detail to be worth looking at.
- **Edges** are real resolved imports, including the TypeScript convention of
  writing `./x.js` for `x.ts`.
- **Tested** means a test file actually imports that module — not a filename
  guess.
- **Rewrite hotspots** are relative to this repo (85th percentile of commit
  counts), so a mature codebase doesn't light up entirely amber.
- **Plan status** comes from your plan file. If an agent hasn't ticked a box,
  it stays "not started" here even if the code exists. The report says which
  file it read.
- **Cost attribution is a heuristic.** Tokens are spent per message, not per
  file. The split is by which files a session touched. No pricing is applied,
  because rates vary by model and plan.

## Privacy

Your code never leaves your machine. No telemetry, no network calls, no
account. The report is a single HTML file with no external requests.

`.agent-lens/state.json` is worth committing — a teammate can then open the
report without running anything. `report.html` is regenerated, so gitignore it.

## Known limits

- **~90 modules is the readable ceiling.** Labels hide below 0.62 zoom; past
  that you want district collapsing, which isn't built yet.
- **Import parsing is regex-based**, so dynamic imports and aliased paths
  (`@/lib/...`) are missed. Tree-sitter would fix this.
- **Codex's on-disk layout has been changing across versions.** The adapter
  degrades loudly rather than reporting a wrong number, but check it against
  your install.
- **Flows only exist after an authoring pass.** Static analysis gives you the
  graph, not the journeys.

## Requirements

Node 18+. Git, for anything beyond a file listing. Zero npm dependencies.
