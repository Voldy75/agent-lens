# Contributing

## Running it

```bash
node bin/agent-lens.js -C /path/to/some/repo
node test/selftest.js
```

No dependencies, no build step. Node 18+.

## Before opening a PR

`node test/selftest.js` must pass. If you change plan discovery or module
clustering, run it against several real repos of different shapes — a
TypeScript app, a Python library, a repo with a CHANGELOG and a roadmap side by
side. Those are where this breaks.

## The line that matters

Deterministic code measures; the model describes. Anything the scanner outputs
must be checkable against the repo. If a change would make the report state
something it cannot verify, it belongs in the authoring pass instead, labelled
as agent-written.
