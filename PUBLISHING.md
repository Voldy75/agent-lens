# Releasing

Releases publish themselves: pushing a version tag runs
`.github/workflows/publish.yml`, which checks the versions match, runs the
selftest, publishes to npm and creates a GitHub release from `CHANGELOG.md`.

## One-time setup: npm trusted publishing

npm needs to know it can trust that workflow. No token is stored anywhere.

1. Sign in at npmjs.com and open the `agent-lens-report` package.
2. **Settings → Trusted publishing → GitHub Actions**.
3. Repository `Voldy75/agent-lens-report`, workflow file `publish.yml`.
   Leave the environment empty.
4. Save.

Optionally, under **Settings → Publishing access**, choose "Require two-factor
authentication and disallow tokens" once a release has gone through, so the
workflow is the only way to publish.

## Each release

1. Add a section to the top of `CHANGELOG.md`:

   ```markdown
   ## 0.3.1 — 2026-10-02

   - What changed, in words a user understands.
   ```

   The selftest fails if the version has no entry, and the section becomes the
   GitHub release notes.

2. Commit the changelog, then bump the version and push with its tag:

   ```bash
   npm version patch     # or minor / major
   git push --follow-tags
   ```

   `npm version` also updates the Claude Code plugin's version
   (`scripts/sync-version.js`), so the tag, the npm package and the plugin
   always match. The workflow refuses to publish if they don't.

3. Watch the **publish** workflow on GitHub. npm can take a few minutes to show
   the new version after it succeeds.

If the README screenshots or the live demo should change too, regenerate them
before step 2:

```bash
node scripts/screenshots/regenerate.js
```

## Publishing by hand

If the workflow can't be used, publish from your machine as before:

```bash
npm login
npm publish
```

`prepublishOnly` runs the selftest first, so a broken build can't ship. If your
account asks for a one-time code, add `--otp=123456`.

## Worth knowing

- Versions are permanent. Unpublishing is only possible within 72 hours and
  blocks that version number forever, so treat every publish as final.
- `agentlens` (no hyphen) is an unrelated package. npm blocks names that differ
  only by punctuation, which is why this package is `agent-lens-report`.
- The Claude Code plugin is served from this repository, not from npm. Users
  get plugin updates from the `master` branch; the plugin itself runs the
  latest npm release.
