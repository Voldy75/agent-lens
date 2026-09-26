# Changelog

What changed in each version of `agent-lens-report`, newest first.

## 0.3.0 — 2026-09-26

### New

- **Is your agent going in circles?** The Now tab and the scan warn when the
  same file keeps being reworked, the same command failure keeps coming back
  across agent sessions, or the plan has not moved for a week while work
  continues. Each warning says what to ask your agent. Your agent's own tooling
  hiccups (a declined tool call, a browser timeout) are not counted.
- **Claude Code plugin.** `/plugin marketplace add Voldy75/agent-lens-report`,
  then install `agent-lens`. Ask "where does my project stand?" and your agent
  scans, writes plain-English names itself, and answers from measurements. It
  also keeps the plan checklist honest as it works, and asks before creating a
  plan file.
- **Plan tip.** When plan statuses are guessed, there is no plan, or progress is
  counted from a setup guide, agent-lens suggests lines for `CLAUDE.md` or
  `AGENTS.md` so your agent keeps a real checklist
  (`npx agent-lens-report plan-tip`, or the Copy button on the Now tab).
  agent-lens never edits those files.
- **The report opens in your browser** after a scan when you run it yourself.
  `--no-open` turns this off; it never happens in CI or when another program
  runs agent-lens.
- A clickable [live demo](https://voldy75.github.io/agent-lens-report/demo/).

### Better

- **The map works for Next.js, Vite and monorepos.** Imports through `@/...`
  shortcuts and `baseUrl` (from the nearest `tsconfig.json` or `jsconfig.json`)
  and workspace packages imported by name are followed. On one real Next.js
  project, connections between modules went from 3 to 20.
- **Docs that mention "tokens" or "API keys" are no longer skipped** as context
  for the authoring pass. Actual secret values (keys, passwords, tokens in
  URLs) are replaced with `[redacted]` instead.
- **The report says when the plan file changed** since the last scan, so a jump
  in progress is explained, and how to pin the file you want.
- **Projects without tests** show "Automated tests: none" instead of
  "100% untested".
- Setup guides are still used as background for the authoring pass.

## 0.2.5 — 2026-09-19

- README screenshots, from a fictional demo project.
- Health: files committed once are no longer listed as "reworked several
  times"; "1 test file", not "1 test files".
- Cost: "Where it went" uses plain-English names after authoring, and works on
  Windows (backslash paths were never matched).

## 0.2.4 — 2026-09-19

Fixes found by running 0.2.3 on real projects.

- Claude Code history is found for folders with spaces in their names.
- Token totals are no longer inflated: each Claude Code reply is counted once,
  and Codex uses the session's final running total.
- Antigravity task lists are read from `~/.gemini/antigravity/brain`.
- READMEs are never used as the plan; setup guides only when nothing else fits.
- Clicking a building on the map selects it.
- Authoring is re-applied on every scan without freezing the plan or headline;
  the agent's summary is shown separately from the measured headline.
- The selftest no longer reads your agent logs or adds to your `ls` list.

## 0.2.3 — 2026-09-19

- Package links point at the renamed repository, `Voldy75/agent-lens-report`.

## 0.2.2 — 2026-09-19

- Version bump only; no changes.

## 0.2.1 — 2026-09-19

- Renamed to `agent-lens-report` (previously `@voldy333/agent-lens`, now
  deprecated). The command is still `agent-lens`.
- `npx agent-lens-report` works.

## 0.2.0 — 2026-09-19

- First release, as `@voldy333/agent-lens`.
