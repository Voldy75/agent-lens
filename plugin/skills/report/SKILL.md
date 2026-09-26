---
name: report
description: Show where this project actually stands, measured rather than remembered. Use when the user asks how far along the project is, what is done or left, what is blocked, what changed recently, whether the agent is going in circles, or asks for a progress or status report. Runs agent-lens-report locally and answers from its measurements.
---

# Where the project stands

The user wants to know where their project stands. They may not read code.
Answer from **measurements**, not from memory of this conversation: your memory
is exactly what they cannot check.

## 1. Scan

Run this from the project folder:

```bash
npx -y agent-lens-report@latest --no-open
```

It reads git history, the plan file and local agent session logs, writes
`.agent-lens/state.json` and `.agent-lens/report.html`, and uploads nothing.

## 2. Name things in plain English (only if needed)

If the scan output says "Folder names are placeholders", do the authoring pass
yourself instead of asking the user to:

1. Run `npx -y agent-lens-report@latest author --prompt` and follow its
   instructions exactly. You may only rename and describe; never invent
   modules or change statuses, file counts or lines.
2. Write the JSON it asks for to `.agent-lens/agent-lens.authored.json`
   (inside `.agent-lens/`, so no new file appears in the user's project).
3. Run `npx -y agent-lens-report@latest author --apply .agent-lens/agent-lens.authored.json`.

Skip this if the scan does not mention placeholders. Names are kept between
scans.

## 3. Answer

Read `.agent-lens/state.json` and tell the user, in plain language:

- **Progress**: `summary.headline` without the `[[` `]]` and `((` `))` markers,
  and which file the plan was read from (`meta.planFile`). If the scan said
  statuses are guesses, say so.
- **Blocked**: each item in `blockers`, with its detail.
- **Going in circles**: each item in `circles` — its `title`, one sentence of
  its `detail`, and its `ask` as something the user can say to you. Take these
  seriously: if one applies to work you are doing, say so.
- **Recently**: the first few entries of `activity`.
- **Cost**, only if asked: the `cost.stats` values.

Then give the report's path, `.agent-lens/report.html`, and offer to open it
(`open` on macOS, `start` on Windows, `xdg-open` on Linux).

Keep it short. Do not pad the answer with numbers the user did not ask for,
and never state a step is done unless `plan` marks it done.

## If the plan is guessed or missing

When `meta.planTip` is set, the scan could not measure progress properly: the
plan has no checklist, there is no plan, or progress is being counted from a
setup guide. Explain that in one sentence and offer to set up a real checklist
with the `keep-plan` skill. Do not edit `CLAUDE.md` or `AGENTS.md` for this.
