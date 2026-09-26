# README screenshots and the live demo

`docs/screenshots/*.png` (the README images) and `docs/demo/index.html` (the
clickable demo on GitHub Pages) come from a fictional project, "Pantry Pal",
so no real project's commits or file names are published.

Regenerate both after a change to the report:

```bash
node scripts/screenshots/regenerate.js             # needs Google Chrome
node scripts/screenshots/regenerate.js --no-shots  # demo page only
```

The demo gets its own fake home folder, so its sample session logs are read
instead of yours and it never appears in your `ls` list.

- `build-demo.js` — the demo project: git history, a plan, sample agent logs
- `authored.json` — its plain-English names and user journeys
- `shoot.js` — screenshots each tab with headless Chrome
