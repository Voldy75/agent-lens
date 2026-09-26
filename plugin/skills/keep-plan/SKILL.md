---
name: keep-plan
description: Keep the project's plan checklist honest as work happens, so progress can be measured instead of guessed. Use after finishing, partly finishing, or getting stuck on a piece of planned work; when the user asks to update, tidy or check off the plan; or when agent-lens reports that plan statuses are guessed or that there is no plan.
---

# Keep the plan checklist honest

agent-lens measures progress from a checklist in the project's plan file. It
can only be as accurate as that checklist, so keep it current as you work.

## Find the plan file

1. If `.agent-lens/state.json` exists and `meta.planFile` names a file in the
   project, use it. (A name starting with "Antigravity task list" lives outside
   the repo; use `PLAN.md` instead.)
2. Otherwise use `PLAN.md` at the project root if it exists.
3. If there is no plan file, **ask the user before creating one.** If they
   agree, write `PLAN.md` from what is already built (ticked) and what is
   clearly left (unticked), based on the code, git history and what they have
   told you. Mark anything you are unsure of as not done.

## Update it

Use this checklist format and nothing fancier:

- `- [ ]` not started
- `- [~]` in progress
- `- [x]` done

Rules:

- **Tick a step only when it works end to end**, not when the code is merely
  written. Unsure means not done. A wrong "done" is the worst mistake here:
  the user relies on it.
- If a step is stuck, leave it unticked and add `blocked on <reason>` to its
  line, in words the user understands.
- Add a step when the scope grows. Never delete finished steps.
- Change only the lines whose status actually changed, and keep the rest of the
  file as it is.

## Tell the user

After updating, say in one line what you changed (for example "Ticked
'Checkout', marked 'Payments' blocked on provider approval"). If you created
or restructured the plan, show it to them.

Do not edit `CLAUDE.md`, `AGENTS.md` or other instruction files as part of
this skill.
