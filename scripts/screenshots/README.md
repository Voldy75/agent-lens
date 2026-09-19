# README screenshots

The images in `docs/screenshots/` come from a fictional project, so no real
project's commits or file names end up in the README. To regenerate them after
a change to the report:

```bash
OUT=$(mktemp -d)
node scripts/screenshots/build-demo.js "$OUT"
cd "$OUT/pantry-pal" && HOME="$OUT/home" node "$OLDPWD/bin/agent-lens.js" --no-open
HOME="$OUT/home" node "$OLDPWD/bin/agent-lens.js" author --apply "$OLDPWD/scripts/screenshots/authored.json"
cd "$OLDPWD" && node scripts/screenshots/shoot.js "$OUT/pantry-pal/.agent-lens/report.html" docs/screenshots
```

`HOME` points at the demo's fake home folder so the sample session log is
used instead of your own.
