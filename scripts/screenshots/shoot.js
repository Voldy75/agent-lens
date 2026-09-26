// Screenshots each report tab with headless Chrome over the DevTools protocol.
// Needs Node 22+ (built-in WebSocket) and Google Chrome.
//
//   node scripts/screenshots/shoot.js <report.html> <out-dir>
const { spawn } = require('child_process'), fs = require('fs'), path = require('path');
const [report, outDir] = process.argv.slice(2);
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9333', '--no-first-run', '--hide-scrollbars',
  `--user-data-dir=${fs.mkdtempSync(path.join(require('os').tmpdir(), 'agent-lens-chrome-'))}`, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  let target;
  for (let i = 0; i < 50 && !target; i++) { try { target = (await (await fetch('http://127.0.0.1:9333/json')).json()).find((t) => t.type === 'page'); } catch { await sleep(200); } }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let n = 0; const pending = {};
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (pending[m.id]) { pending[m.id](m); delete pending[m.id]; } });
  const send = (method, params = {}) => new Promise((r) => { const id = ++n; pending[id] = r; ws.send(JSON.stringify({ id, method, params })); });
  const js = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.result.value;
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 2, mobile: false });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await send('Page.enable');
  await send('Page.navigate', { url: 'file://' + path.resolve(report) });
  await sleep(1500);
  const shots = [
    ['now', 'now', null, 1180],
    ['plan', 'plan', null, 900],
    ['map', 'map', `document.querySelector('[data-flow]').click()`, 820],
    ['health', 'health', null, 760],
    ['cost', 'cost', null, 820]
  ];
  for (const [name, tab, extra, h] of shots) {
    await js(`document.querySelector('.tab[data-p="${tab}"]').click(); window.scrollTo(0,0)`);
    if (extra) { await sleep(300); await js(extra); }
    await sleep(700);
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: 1280, height: h, scale: 1 } });
    fs.writeFileSync(path.join(outDir, `report-${name}.png`), Buffer.from(shot.result.data, 'base64'));
    console.log('saved', name);
  }
  ws.close(); chrome.kill();
})().catch((e) => { console.error(e); chrome.kill(); process.exit(1); });
