# Getting this onto GitHub and npm

The repository is already initialised with one commit, a `.gitignore`, and a CI
workflow. What's left needs your accounts, so it has to happen on your machine.

## 1. Create the repo

With the GitHub CLI:

```bash
cd agent-lens
node scripts/set-repo.js <your-github-username>/agent-lens
gh repo create agent-lens --public --source=. --remote=origin --push
```

Without it — create an empty repo at github.com/new (no README, no .gitignore,
no license; this repo already has them), then:

```bash
cd agent-lens
node scripts/set-repo.js <your-github-username>/agent-lens
git add -A && git commit -m "point package.json at the repo"
git remote add origin git@github.com:<your-github-username>/agent-lens.git
git branch -M main
git push -u origin main
```

CI runs `node test/selftest.js` on Linux, macOS and Windows across Node 18, 20
and 22. Let it go green before publishing — the Windows leg is the one most
likely to fail, since no part of this has ever run there.

## 2. Publish to npm

```bash
npm view agent-lens-report version    # a 404 means the name is still free
npm login
npm publish
```

`prepublishOnly` runs the selftest, so a broken build cannot ship.

If the name has gone in the meantime:

```bash
npm run rename -- @<your-npm-username>/agent-lens
npm publish --access public
```

## 3. Check it from the outside

```bash
cd /tmp && npx agent-lens-report@latest --version
```

Install it somewhere you have not been developing. This catches the classic
mistake of a package that only works because of files sitting in your working
directory.

## Releasing later

```bash
npm version patch     # or minor / major — commits and tags
git push --follow-tags
npm publish
```

Versions are immutable and unpublishing is only free within 72 hours. Treat
each publish as permanent.

## Worth doing before you tell anyone

Run it against five or six of your own repos in different languages and check
the module clustering is not embarrassing. The plan scorer is tuned against a
handful of constructed test repos; real ones will find its edges.

This tool reads people's local agent session logs. That is a lot of trust for
an unknown `0.1.x` package, and the README's privacy claim only holds because
the source is short enough to verify in a couple of minutes. Keep it that way.
