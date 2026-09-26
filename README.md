# agent-lens-report

See where an agent-built project actually stands — without reading the code.

Point it at a folder. It reads git history, your plan files, and (if present)
your coding agent's local session logs, and writes one self-contained HTML
report: what's done, what's in progress, what's blocked, what the agent kept
rewriting, what it cost, and a map of the codebase you can click through.

![The Now tab: 5 of 10 steps done, one blocked step, and a warning that the agent keeps reworking the meal planner](https://raw.githubusercontent.com/Voldy75/agent-lens-report/master/docs/screenshots/report-now.png)

<sub>Sample report for a made-up recipe app, "Pantry Pal". Your report shows your own project. **[Try the live demo →](https://voldy75.github.io/agent-lens-report/demo/)** (every tab works)</sub>

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
| **Now** | Where am I, what changed, what's stuck, and whether your agent is going in circles |
| **Plan** | Each step's status, linked to the modules it touched |
| **Health** | What got rewritten most, what has no tests |
| **Map** | Isometric map of the codebase, real imports between modules |
| **Cost** | Tokens and sessions per week, and where they went |

Tabs you have no data for don't appear, and the report says so on the Now tab
rather than pretending the scan was complete.

### Is your agent going in circles?

The Now tab warns you, in plain words, when:

- **the same file keeps being reworked** — changed in 5+ commits, or edited by
  your agent in 4+ separate sessions, over the last two weeks
- **the same error keeps coming back** — a failing command (a build, a type
  check, a test run) with the same error 3+ times across 2+ agent sessions
- **work continues but the plan has not moved** — nothing in the plan checklist
  changed for a week, while commits and agent sessions carried on

Each warning comes with something to ask your agent, such as *"Before changing
week.tsx again, explain what keeps breaking and what a lasting fix would be."*
Your agent's own tooling hiccups (a declined tool call, a browser timeout) are
not counted as errors, and the thresholds are cautious on purpose: a warning
that cries wolf teaches you to ignore it.

| Plan | Map |
|---|---|
| ![Plan tab: every step from the plan file with its status](https://raw.githubusercontent.com/Voldy75/agent-lens-report/master/docs/screenshots/report-plan.png) | ![Map tab: the codebase as buildings, with a user journey highlighted](https://raw.githubusercontent.com/Voldy75/agent-lens-report/master/docs/screenshots/report-map.png) |
| **Health** | **Cost** |
| ![Health tab: files the agent kept rewriting and modules with no tests](https://raw.githubusercontent.com/Voldy75/agent-lens-report/master/docs/screenshots/report-health.png) | ![Cost tab: sessions, tokens per week and where the work went](https://raw.githubusercontent.com/Voldy75/agent-lens-report/master/docs/screenshots/report-cost.png) |

## Works with

| Agent | Plan status | Cost | Notes |
|---|---|---|---|
| **Antigravity** | best — `task.md` checkboxes carry real state | no | reads `~/.gemini/antigravity/brain/*/task.md` from conversations that link into this folder; no local token ledger |
| **Claude Code** | `CLAUDE.md`, freeform | yes | reads `~/.claude/projects/*.jsonl` |
| **Codex** | `AGENTS.md`, freeform | yes | reads `~/.codex/sessions/**/rollout-*.jsonl`, filtered by `session_meta.cwd` |
| **Cursor / other** | any `PLAN.md`, `TODO.md` | no | git tier always works |
| **No agent** | commits only | no | still gives timeline, health, and map |

Mixing agents in one repo is fine — adapters merge into the same state file.
If you plan in Antigravity and execute in Codex, this is the only place the
whole picture exists.

## Inside Claude Code

Install the plugin once, then just ask your agent:

```
/plugin marketplace add Voldy75/agent-lens-report
/plugin install agent-lens@agent-lens
```

- **"Where does my project stand?"** — or run `/agent-lens:report`. Your agent
  scans, writes the plain-English names itself (no copy-pasting a prompt), and
  answers from the measurements rather than from memory.
- **It keeps the plan honest.** As it finishes or gets stuck on planned work,
  your agent ticks the checklist, marks blocked steps, and never marks a step
  done until it works end to end. It asks before creating a plan file.

Installing the plugin is your go-ahead for your agent to update the plan file.
It still never edits `CLAUDE.md` or `AGENTS.md`.

## Commands

```bash
npx agent-lens-report                  # scan this folder, write the report
npx agent-lens-report -C ../other-app  # scan somewhere else
npx agent-lens-report ls               # every project you've scanned, with % done
npx agent-lens-report render           # re-render without rescanning
npx agent-lens-report author --prompt  # get better names and descriptions
npx agent-lens-report plan-tip         # lines that make your agent keep the plan up to date
```

The report opens in your browser after a scan. Add `--no-open` to skip that.

## Making it readable: the authoring pass

A scan alone gives you `src-core-http2-client`, not "Connection handling". Real
names need a model — so agent-lens uses the one already sitting next to you.

Inside Claude Code, Codex, Cursor, or Antigravity:

```
npx agent-lens-report author --prompt
```

Paste the output to your agent. It writes `agent-lens.authored.json`, then:

```
npx agent-lens-report author --apply agent-lens.authored.json
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
ones not named CHANGELOG. Setup, install and deploy guides are scored down too:
they are checklists for configuring something, not a plan for what is being
built. READMEs are never used as the plan.

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

### Getting real progress: let your agent keep the checklist

Guessed statuses are the weakest part of any report. The fix is for your agent
to keep a real checklist as it works. When statuses are guessed, when there is
no plan, or when progress is being counted from a setup guide, the report and
the scan suggest a few lines to add to your agent's instruction file
(`CLAUDE.md` for Claude Code, `AGENTS.md` for Codex, Cursor and others):

```bash
npx agent-lens-report plan-tip    # prints the lines; changes nothing
```

The Now tab shows the same lines with a Copy button. **agent-lens never edits
those files for you.** They are yours, often shared with a team, and changing
how someone's agent behaves is their call. Once the lines are in, the
suggestion stops appearing.

## How it decides things

Everything on the page is measured or read from a file you control:

- **Modules** are folders. Big folders split one level deeper until the map has
  enough detail to be worth looking at.
- **Edges** are real resolved imports: relative paths (including the TypeScript
  convention of writing `./x.js` for `x.ts`), `@/...` shortcuts and `baseUrl`
  from the nearest `tsconfig.json` or `jsconfig.json`, and workspace packages
  imported by name in a monorepo.
- **Tested** means a test file actually imports that module — not a filename
  guess.
- **Rewrite hotspots** are relative to this repo (85th percentile of commit
  counts), so a mature codebase doesn't light up entirely amber.
- **Plan status** comes from your plan file. If an agent hasn't ticked a box,
  it stays "not started" here even if the code exists. The report says which
  file it read, and tells you when that file changed since your last scan.
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
- **Import parsing is regex-based**, so dynamic imports (`import()` with a
  computed path) are missed. Webpack or Vite aliases that are not also in
  `tsconfig.json`/`jsconfig.json` are missed too.
- **Codex's on-disk layout has been changing across versions.** The adapter
  degrades loudly rather than reporting a wrong number, but check it against
  your install.
- **Flows only exist after an authoring pass.** Static analysis gives you the
  graph, not the journeys.
- **"Going in circles" reads Claude Code logs for edits and errors.** For Codex
  and Antigravity it can only use git history and the plan.

## Requirements

Node 18+. Git, for anything beyond a file listing. Zero npm dependencies.
