// Drive the app in headless Chrome over the DevTools protocol and take screenshots.
// Usage: node test/browser.mjs [outdir]
// Fails (exit 1) on any console error or uncaught exception.
import { spawn } from 'node:child_process';
import { writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.argv[2] || path.join(ROOT, 'test', 'out');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
await mkdir(OUT, { recursive: true });

const port = 9300 + Math.floor(Math.random() * 500);
const profile = await mkdtemp(path.join(tmpdir(), 'lh-chrome-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));

let targets;
for (let i = 0; i < 50; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.length) break; } catch { /* starting */ }
  await sleep(200);
}
const page = targets.find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
let id = 0;
const pending = new Map();
const errors = [];
ws.addEventListener('message', ev => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push(msg.params.args.map(a => a.value ?? a.description).join(' '));
  if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error' && !/fonts\.(googleapis|gstatic)/.test(msg.params.entry.url || '')) errors.push(msg.params.entry.text);
});
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async expr => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result.exceptionDetails) throw new Error(`${expr}\n→ ${r.result.exceptionDetails.exception?.description}`);
  return r.result.result.value;
};
const shot = async (name, full = false) => {
  const params = { format: 'png' };
  if (full) {
    const m = await send('Page.getLayoutMetrics');
    params.clip = { x: 0, y: 0, width: m.result.cssContentSize.width, height: Math.min(m.result.cssContentSize.height, 6000), scale: 1 };
    params.captureBeyondViewport = true;
  }
  const r = await send('Page.captureScreenshot', params);
  await writeFile(path.join(OUT, name + '.png'), Buffer.from(r.result.data, 'base64'));
};
const viewport = (width, height, mobile = false) => send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
const waitIdle = () => evaluate(`new Promise(res => { const t = setInterval(() => { const b = document.querySelector('#runBtn'); if (!b.disabled || !document.querySelector('#modal').hidden) { clearInterval(t); res(true); } }, 50); setTimeout(() => { clearInterval(t); res(false); }, 30000); })`);

await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
await viewport(1440, 1000);
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
await send('Page.navigate', { url: pathToFileURL(path.join(ROOT, 'index.html')).href });
await sleep(1200);
await evaluate(`localStorage.clear(); true`);
await shot('01-map');
await shot('01-map-full', true);

// Level 1: founding animation, then four months on Quick
await evaluate(`document.querySelector('[data-level="0"]').click(); true`);
await sleep(300);
await shot('02-intro');
await evaluate(`document.querySelector('[data-speed="quick"]').click(); document.querySelector('[data-act="open"]').click(); true`);
await sleep(700);
await shot('03-founding-mid');
await waitIdle();
await evaluate(`document.querySelector('#price').value = 80; document.querySelector('#price').dispatchEvent(new Event('input')); document.querySelector('[data-pick]').click(); document.querySelector('#runBtn').click(); true`);
await sleep(900);
await shot('04-month-mid');
await waitIdle();
await shot('05-month1-done');
await shot('05-month1-full', true);
for (let i = 0; i < 3; i++) { await evaluate(`document.querySelector('[data-pick]')?.click(); document.querySelector('#runBtn').click(); true`); await waitIdle(); }
await sleep(1500);
await shot('06-level1-debrief');

// Level 2 at 60-day terms: should die
await evaluate(`document.querySelector('[data-act="next"]').click(); true`);
await sleep(200);
await evaluate(`document.querySelector('[data-speed="skip"]').click(); document.querySelector('[data-act="open"]').click(); true`);
await waitIdle();
await evaluate(`document.querySelector('[data-terms="2"]').click(); true`);
for (let i = 0; i < 6; i++) {
  const over = await evaluate(`!document.querySelector('#modal').hidden`);
  if (over) break;
  await evaluate(`document.querySelector('[data-pick]')?.click(); document.querySelector('#runBtn').click(); true`); await waitIdle();
}
await sleep(1500);
await shot('07-level2-dead');
await evaluate(`document.querySelector('[data-act="look"]').click(); true`);
await sleep(300);
await evaluate(`document.querySelector('[data-trace="is:revenue"]').click(); true`);
await sleep(300);
await shot('08-trace-revenue', true);

// Level 5 with a few months, loan and bench used
await evaluate(`document.querySelector('[data-nav="map"]').click(); document.querySelector('[data-level="4"]').click(); true`);
await sleep(200);
await evaluate(`document.querySelector('[data-act="open"]').click(); true`);
await waitIdle();
for (let i = 0; i < 7; i++) {
  const over = await evaluate(`!document.querySelector('#modal').hidden`);
  if (over) break;
  await evaluate(`{const l=document.querySelector('#loan'); l.value=8000; l.dispatchEvent(new Event('input')); if (${i}===1){const b=document.querySelector('#bench'); b.value=1;} document.querySelector('#order').value=150; document.querySelector('#runBtn').click();} true`);
  await waitIdle();
}
await shot('09-level5');

// Leave a level mid-animation and start another: the old month must stop cleanly
await evaluate(`document.querySelector('#modal').hidden = true; document.querySelector('[data-nav="map"]').click(); document.querySelector('[data-level="1"]').click(); true`);
await sleep(200);
await evaluate(`document.querySelector('[data-speed="watch"]').click(); document.querySelector('[data-act="open"]').click(); true`);
await sleep(600);
await evaluate(`document.querySelector('[data-nav="map"]').click(); document.querySelector('[data-level="0"]').click(); true`);
await sleep(200);
await evaluate(`document.querySelector('[data-speed="skip"]').click(); document.querySelector('[data-act="open"]').click(); true`);
await waitIdle();
await evaluate(`document.querySelector('#runBtn').click(); true`);
await waitIdle();
await sleep(3000);
const midSwitchOk = await evaluate(`document.querySelector('#lvlTitle').textContent === 'The Cash Counter' && document.querySelector('#periodSel').value === '1'`);
if (!midSwitchOk) errors.push('mid-run level switch left the wrong state');

// Lab presets
await evaluate(`document.querySelector('#modal').hidden = true; document.querySelector('[data-nav="lab"]').click(); true`);
await sleep(400);
await shot('10-lab-thermostat');
await evaluate(`document.querySelector('[data-preset="bullwhip"]').click(); true`);
await sleep(300);
await shot('11-lab-bullwhip');
await evaluate(`document.querySelector('[data-preset="profitblind"]').click(); true`);
await sleep(300);
await shot('12-lab-profitblind', true);

// Guide
await evaluate(`document.querySelector('[data-nav="guide"]').click(); true`);
await sleep(300);
await evaluate(`document.querySelector('[data-demo="one"]').click(); true`);
await sleep(300);
await shot('13-guide');
await evaluate(`document.querySelector('#guideClose').click(); true`);

// Phone width + dark
await viewport(390, 844, true);
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
await evaluate(`document.querySelector('[data-nav="map"]').click(); document.querySelector('[data-level="2"]').click(); true`);
await sleep(200);
await evaluate(`document.querySelector('[data-act="open"]').click(); true`);
await waitIdle();
await evaluate(`document.querySelector('#runBtn').click(); true`);
await waitIdle();
await shot('14-phone-dark', true);
const overflow = await evaluate(`document.documentElement.scrollWidth > window.innerWidth`);
await viewport(1440, 1000);
await evaluate(`document.querySelector('[data-nav="lab"]').click(); true`);
await sleep(300);
await shot('15-lab-dark');

console.log(JSON.stringify({ errors, phoneOverflow: overflow }, null, 1));
ws.close(); chrome.kill();
process.exit(errors.length || overflow ? 1 : 0);
