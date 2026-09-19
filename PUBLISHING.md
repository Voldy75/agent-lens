# Publishing this to npm

Right now the tarball installs locally. To make it globally installable —
`npx <name>` from anywhere, for anyone — it has to be published to the public
npm registry.

## The name

`agent-lens` was free on npm when this was packaged. Names go daily, so check
once more immediately before you publish:

```bash
npm view agent-lens version     # a 404 means it's still yours to take
```

If it has gone, scope it instead — a scoped name is yours the moment you have
an account:

```bash
npm run rename -- @<your-npm-username>/agent-lens
```

Note that `agentlens` (no hyphen) is taken by an unrelated package at 1.0.0.
That is worth knowing for two reasons: people will typo it, and it rules out
grabbing the unhyphenated form later.

## Then: publish

```bash
npm adduser                  # or: npm login
npm whoami                   # confirm you're logged in
npm publish --access public  # --access public only needed for scoped names
```

`prepublishOnly` runs the selftest first, so a broken build can't ship.

If your account has 2FA on (it should), npm will prompt for a one-time code, or
pass `--otp=123456`.

## Things worth knowing before you hit publish

**Versions are immutable.** You cannot republish `0.1.0` with different
contents. Every change needs `npm version patch|minor|major`.

**Unpublishing is limited.** You have 72 hours to remove a version freely.
After that, npm only allows it if nothing depends on your package. Assume what
you publish is permanent.

**Everything in `files` becomes public.** Check the list before publishing:

```bash
npm pack --dry-run
```

Confirm there's no `.agent-lens/` from your own testing, no state file with
your paths in it, no `.env`.

**Publish a scoped name once as a test.** Publish `0.1.0`, install it on a
different machine, run `agent-lens-selftest`, and only then tell anyone about
it.

## A GitHub repo first

Before publishing, put the source on GitHub and add the URLs to
`package.json` — npm shows them on the package page and people will not
install a CLI that reads their session logs without being able to read the
source:

```json
"repository": { "type": "git", "url": "git+https://github.com/<you>/agent-lens.git" },
"homepage": "https://github.com/<you>/agent-lens#readme",
"bugs": { "url": "https://github.com/<you>/agent-lens/issues" }
```

You can also publish straight from CI with npm provenance, which attaches a
verifiable link between the tarball and the commit it was built from. Worth
doing for a tool that asks for this much trust, but not on day one.

## Before you publish at all

This reads people's local agent session logs. That is a lot of trust to ask
for from a version `0.1.0` published by an unknown account. Two things to do
first:

1. Run it on five or six real repos of your own, in different languages, and
   check the clustering is not embarrassing.
2. Make the privacy claim verifiable — the README says no network calls, and
   the code should be easy enough to read that someone can confirm it in two
   minutes. It currently is. Keep it that way.

A tool like this gets exactly one first impression.
