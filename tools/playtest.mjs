// Interactive play-test for Solmar Bay over CDP (no npm packages): opens
// the game, clicks New Game, walks the first mission, steals a car, drives,
// checks the save, pauses, and screenshots the result. Prints PASS/FAIL
// lines and exits non-zero on any failure.
// Usage: node tools/playtest.mjs [port]
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const PORT = Number(process.argv[2] ?? 8908);
const CHROME = `${process.env.HOME}/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome`;
const CDP_PORT = 9334;

const server = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', `${ROOT}game`], {
  cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
});
await new Promise((r) => setTimeout(r, 1200));
const chrome = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  `--remote-debugging-port=${CDP_PORT}`, '--hide-scrollbars',
  '--window-size=1280,720', 'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

async function getWsUrl() {
  for (let i = 0; i < 50; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
      return (await res.json()).webSocketDebuggerUrl;
    } catch { await new Promise((r) => setTimeout(r, 200)); }
  }
  throw new Error('chrome devtools did not come up');
}

let idCounter = 1;
const pending = new Map();
let ws;
const errors = [];
function send(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = idCounter++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  ws = new WebSocket(await getWsUrl());
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    } else if (msg.method === 'Runtime.exceptionThrown') {
      errors.push(msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text);
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      errors.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    }
  };
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Runtime.enable', {}, sessionId);
  await send('Page.enable', {}, sessionId);
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false }, sessionId);

  const evalJs = async (expression) => {
    const { result } = await send('Runtime.evaluate', { expression, returnByValue: true }, sessionId);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || 'evaluate failed');
    return result.value;
  };
  const key = async (code, keyName, type) => {
    await send('Input.dispatchKeyEvent', { type, code, key: keyName, windowsVirtualKeyCode: 0 }, sessionId);
  };
  const tapKey = async (code, keyName) => {
    await key(code, keyName, 'keyDown');
    await sleep(60);
    await key(code, keyName, 'keyUp');
  };
  const mouseClick = async (x, y) => {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }, sessionId);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }, sessionId);
  };

  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/?seed=7` }, sessionId);
  await sleep(1500);
  check('page loads without errors', errors.length === 0, errors.join(' | '));
  check('title screen shows', (await evalJs('window.__game.screen')) === 'title');

  // Click NEW GAME (first menu item, centred at y = 360 + 40).
  await mouseClick(640, 400);
  await sleep(800);
  check('new game starts', (await evalJs('window.__game.screen')) === 'play');
  check('mission 1 intro dialog plays', (await evalJs('window.__game.dialog.length')) >= 1);

  // Advance the dialog with E.
  for (let i = 0; i < 5; i += 1) { await tapKey('KeyE', 'e'); await sleep(120); }
  check('dialog advances to empty', (await evalJs('window.__game.dialog.length')) === 0);

  // Walk to Rosa's office: teleport next to it, the goto step completes.
  await evalJs('window.__game.player.x = 1180; window.__game.player.y = 1240;');
  await sleep(400);
  check('mission 1 goto step completes', (await evalJs('window.__game.mission.step')) === 1);
  await tapKey('KeyE', 'e');
  await sleep(400);
  check('mission 1 talk step completes, mission 2 starts', (await evalJs('window.__game.mission.index')) === 1);
  check('mission 2 reward pending, money still 150', (await evalJs('window.__game.money')) === 150);

  // Mission 2's intro dialog (3 lines) plays after mission 1's outro;
  // dismiss it before trying to drive.
  for (let i = 0; i < 4; i += 1) { await tapKey('KeyE', 'e'); await sleep(120); }
  check('mission 2 dialog dismissed', (await evalJs('window.__game.dialog.length')) === 0);
  check('mission 2 started', (await evalJs('window.__game.mission.started')) === true);

  // Steal a parked car: teleport to one and press E.
  await evalJs(`(() => { const g = window.__game; const c = g.cars.find(c => c.driver === null); g.player.x = c.x + 10; g.player.y = c.y; return c.type; })()`);
  await tapKey('KeyE', 'e');
  await sleep(400);
  check('player enters the car', (await evalJs('window.__game.player.onFoot')) === false);
  check('steal step completes', (await evalJs('window.__game.mission.step')) === 1);

  // Drive forward for 2 seconds.
  const pos0 = await evalJs('({ x: window.__game.player.x, y: window.__game.player.y })');
  await key('KeyW', 'w', 'keyDown');
  await sleep(2000);
  await key('KeyW', 'w', 'keyUp');
  const pos1 = await evalJs('({ x: window.__game.player.x, y: window.__game.player.y })');
  const moved = Math.hypot(pos1.x - pos0.x, pos1.y - pos0.y);
  check('car drives forward', moved > 200, `moved ${Math.round(moved)}px`);

  // Wanted: force a crime and check police respond.
  await evalJs('window.__game.wanted = 3;');
  await sleep(2500);
  const policeCount = await evalJs(`window.__game.cars.filter(c => c.driver === 'police').length + window.__game.cops.length`);
  check('police spawn at wanted 3', policeCount >= 2, `${policeCount} police units`);
  check('wanted stars show 3', Math.round(await evalJs('window.__game.wanted')) === 3);

  // Shooting: aim at an enemy and fire.
  await evalJs(`(() => { const g = window.__game; const e = g.enemies[0] || null; return !!e; })()`);
  const shotOk = await evalJs(`(() => {
    const g = window.__game;
    const en = { kind: 'enemy', x: g.player.x + 200, y: g.player.y, angle: 0, speed: 0, radius: 12, health: 100, fireCooldown: 99, shirt: '#5d3a3a', skin: '#e0ac69', walkPhase: 0, dead: false, strafeDir: 1 };
    g.enemies.push(en);
    g.mouse.x = 640 + 200; g.mouse.y = 360; g.mouse.moved = true;
    g.aimAngle = 0;
    g.player.fireCooldown = 0;
    return true;
  })()`);
  await mouseClick(840, 360);
  await sleep(300);
  const enemyHp = await evalJs('window.__game.enemies.length ? window.__game.enemies[0].health : -1');
  check('shooting damages the enemy', shotOk && enemyHp < 100, `enemy hp ${enemyHp}`);

  // Pause and resume.
  await tapKey('Escape', 'Escape');
  await sleep(300);
  check('Esc pauses', (await evalJs('window.__game.screen')) === 'paused');
  await tapKey('Enter', 'Enter');
  await sleep(300);
  check('Enter resumes', (await evalJs('window.__game.screen')) === 'play');

  // Save exists in localStorage.
  check('autosave wrote localStorage', (await evalJs(`!!localStorage.getItem('${'solmarbay-save-v1'}')`)) === true);

  // Final gameplay screenshot.
  const { data } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 86 }, sessionId);
  writeFileSync(`${ROOT}/tools/playtest.jpg`, Buffer.from(data, 'base64'));
  console.log('saved tools/playtest.jpg');
  check('no page errors during play', errors.length === 0, errors.join(' | '));
} finally {
  try { ws?.close(); } catch { /* ignore */ }
  chrome.kill();
  server.kill();
}
console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
