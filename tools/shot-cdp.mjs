// Screenshot driver over the Chrome DevTools Protocol, using only Node's
// built-in fetch and WebSocket (no npm packages). Launches headless
// Chromium, serves game/ with python http.server, opens each ?shot= scene,
// waits for window.__shotReady, and saves a JPEG screenshot.
// Usage: node tools/shot-cdp.mjs [port]
import { spawn, execSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const PORT = Number(process.argv[2] ?? 8904);
const shots = JSON.parse(readFileSync(process.argv[3] || `${ROOT}shots.json`, 'utf8'));
const CHROME = `${process.env.HOME}/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome`;
const CDP_PORT = 9333;

const server = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', `${ROOT}game`], {
  cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
});
await new Promise((resolve) => setTimeout(resolve, 1200));

const chrome = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  `--remote-debugging-port=${CDP_PORT}`, '--hide-scrollbars',
  '--window-size=1280,720', 'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });

async function getWsUrl() {
  for (let i = 0; i < 50; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
      const data = await res.json();
      return data.webSocketDebuggerUrl;
    } catch { await new Promise((r) => setTimeout(r, 200)); }
  }
  throw new Error('chrome devtools did not come up');
}

let idCounter = 1;
const pending = new Map();
let ws;
const events = [];
const consoleErrors = [];

function send(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = idCounter++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
}

try {
  const browserWs = await getWsUrl();
  ws = new WebSocket(browserWs);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    } else if (msg.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(`pageerror: ${msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text}`);
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      consoleErrors.push(`console: ${msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`);
    } else if (msg.method === 'Network.loadingFailed') {
      consoleErrors.push(`request failed: ${msg.params.errorText}`);
    }
  };

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Runtime.enable', {}, sessionId);
  await send('Page.enable', {}, sessionId);
  await send('Network.enable', {}, sessionId);
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false }, sessionId);

  for (const shot of shots) {
    consoleErrors.length = 0;
    await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/${shot.query}` }, sessionId);
    // Wait for __shotReady, polling every 200 ms up to 20 s.
    let ready = false;
    for (let i = 0; i < 100; i += 1) {
      await new Promise((r) => setTimeout(r, 200));
      const { result } = await send('Runtime.evaluate', { expression: 'window.__shotReady === true', returnByValue: true }, sessionId);
      if (result?.value) { ready = true; break; }
    }
    if (!ready) console.log(`${shot.name}: !! __shotReady never became true`);
    await new Promise((r) => setTimeout(r, 200));
    const { data } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 86 }, sessionId);
    const { writeFileSync } = await import('node:fs');
    const file = `${ROOT}screenshots/${shot.name}`;
    writeFileSync(file, Buffer.from(data, 'base64'));
    const bytes = statSync(file).size;
    console.log(`${shot.name}: ${bytes} bytes${consoleErrors.length ? ` — WARNINGS: ${consoleErrors.join(' | ')}` : ''}`);
    if (bytes > 262144) console.log('  !! over the 256 KiB gate cap');
  }
} finally {
  try { ws?.close(); } catch { /* ignore */ }
  chrome.kill();
  server.kill();
}
console.log('done');
