// Heads-up display, minimap and menus for Solmar Bay. The HUD is drawn on
// the same canvas as the world, in screen space: health and money top-left,
// wanted stars and the clock top-right, the mission objective below them,
// speed bottom-right, and a live minimap bottom-left.
import { formatClock, formatMoney, clamp } from './util.js';
import { WORLD_W, WORLD_H, ROADS, SEA_X, BEACH_X, PLACES } from './world.js';
import { darknessAt } from './render.js';

const PANEL = 'rgba(12,16,24,0.72)';

function panel(ctx, x, y, w, h, r = 10) {
  ctx.fillStyle = PANEL;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawStars(ctx, x, y, wanted) {
  ctx.font = '22px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < 5; i += 1) {
    ctx.fillStyle = i < wanted ? '#ffd23f' : 'rgba(255,255,255,0.25)';
    ctx.fillText('★', x + i * 26, y);
  }
}

/** The full in-play HUD. */
export function drawHud(ctx, game) {
  const w = game.canvas.width;
  const h = game.canvas.height;
  const p = game.player;

  // Top-left: health bar + money + coins.
  panel(ctx, 14, 14, 250, 74);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 13px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('DANA MORENO', 26, 34);
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.fillRect(26, 42, 180, 12);
  ctx.fillStyle = p.health > 30 ? '#2ecc71' : '#e74c3c';
  ctx.fillRect(26, 42, 180 * clamp(p.health / p.maxHealth, 0, 1), 12);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 15px sans-serif';
  ctx.fillText(formatMoney(game.money), 26, 76);
  ctx.fillStyle = '#f7c948';
  ctx.font = 'bold 13px sans-serif';
  ctx.fillText(`◉ ${game.coinsTaken}/24`, 150, 76);

  // Top-right: wanted stars + clock + day/night.
  panel(ctx, w - 264, 14, 250, 74);
  drawStars(ctx, w - 250, 38, Math.round(game.wanted));
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 16px sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(formatClock(game.hour), w - 26, 68);
  const night = darknessAt(game.hour) > 0.2;
  ctx.font = '15px sans-serif';
  ctx.fillText(night ? '☾ Night' : '☀ Day', w - 96, 68);
  ctx.textAlign = 'left';

  // Objective strip under the top-left panel.
  const objective = game.objectiveLabel;
  ctx.font = 'bold 14px sans-serif';
  const objW = Math.min(w - 560, ctx.measureText(objective).width + 44);
  panel(ctx, 14, 98, objW, 34);
  ctx.fillStyle = '#ffd23f';
  ctx.fillText('◆', 26, 120);
  ctx.fillStyle = '#fff';
  ctx.fillText(objective, 46, 120);

  // Mission timer, when a timed step is running.
  if (game.missionTimer > 0) {
    ctx.font = 'bold 22px sans-serif';
    ctx.textAlign = 'center';
    const urgent = game.missionTimer < 15;
    ctx.fillStyle = urgent ? '#ff5b4d' : '#fff';
    ctx.fillText(`⏱ ${Math.ceil(game.missionTimer)}s`, w / 2, 46);
    ctx.textAlign = 'left';
  }

  // Bottom-right: speed when driving, hint when on foot.
  if (!p.onFoot && p.car) {
    const kmh = Math.round(Math.abs(p.car.speed) * 0.36);
    panel(ctx, w - 164, h - 64, 150, 50);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 26px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`${kmh}`, w - 66, h - 30);
    ctx.font = 'bold 12px sans-serif';
    ctx.fillStyle = '#aaa';
    ctx.fillText('km/h', w - 26, h - 30);
    ctx.textAlign = 'left';
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('WASD move · E enter car · F punch · Click shoot', w - 16, h - 16);
    ctx.textAlign = 'left';
  }

  // Context prompt (steal car, talk, pickup).
  if (game.prompt) {
    ctx.font = 'bold 15px sans-serif';
    const pw = ctx.measureText(game.prompt).width + 30;
    panel(ctx, w / 2 - pw / 2, h - 110, pw, 36);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.fillText(game.prompt, w / 2, h - 86);
    ctx.textAlign = 'left';
  }

  // Banner toast (mission started / completed).
  if (game.bannerTimer > 0 && game.banner) {
    const alpha = clamp(game.bannerTimer, 0, 1);
    ctx.globalAlpha = alpha;
    ctx.font = 'bold 24px sans-serif';
    const bw = ctx.measureText(game.banner).width + 50;
    panel(ctx, w / 2 - bw / 2, 130, bw, 46);
    ctx.fillStyle = '#ffd23f';
    ctx.textAlign = 'center';
    ctx.fillText(game.banner, w / 2, 160);
    ctx.textAlign = 'left';
    ctx.globalAlpha = 1;
  }

  drawMinimap(ctx, game);
}

/** Live minimap: roads, sea, player, police, mission marker. */
export function drawMinimap(ctx, game) {
  const size = 178;
  const x0 = 14;
  const y0 = game.canvas.height - size - 14;
  const scale = size / WORLD_W;
  panel(ctx, x0 - 6, y0 - 6, size + 12, size + 12, 12);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, y0, size, size);
  ctx.clip();
  // Land, sea, beach.
  ctx.fillStyle = '#5d7a52';
  ctx.fillRect(x0, y0, size, size);
  ctx.fillStyle = '#2f8fb5';
  ctx.fillRect(x0, y0, SEA_X * scale, size);
  ctx.fillStyle = '#e9d6a4';
  ctx.fillRect(x0 + SEA_X * scale, y0, (BEACH_X - SEA_X) * scale, size);
  // Roads.
  ctx.strokeStyle = '#d8d8d0';
  ctx.lineWidth = 2;
  for (const r of ROADS) {
    ctx.beginPath();
    ctx.moveTo(x0 + r * scale, y0);
    ctx.lineTo(x0 + r * scale, y0 + size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x0, y0 + r * scale);
    ctx.lineTo(x0 + size, y0 + r * scale);
    ctx.stroke();
  }
  // Named places.
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  for (const key of Object.keys(PLACES)) {
    const pl = PLACES[key];
    ctx.fillRect(x0 + pl.x * scale - 1.5, y0 + pl.y * scale - 1.5, 3, 3);
  }
  // Mission / taxi target.
  const target = game.missionTarget || (game.taxi && game.taxi.active ? game.taxi.target : null);
  if (target) {
    const pulse = 3 + Math.sin(performance.now() / 250) * 1.5;
    ctx.fillStyle = '#ffd23f';
    ctx.beginPath();
    ctx.arc(x0 + target.x * scale, y0 + target.y * scale, pulse + 2, 0, Math.PI * 2);
    ctx.fill();
  }
  // Police (red) and player (white ring).
  for (const car of game.cars) {
    if (car.type !== 'police') continue;
    ctx.fillStyle = '#ff4d4d';
    ctx.beginPath();
    ctx.arc(x0 + car.x * scale, y0 + car.y * scale, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const cop of game.cops) {
    ctx.fillStyle = '#ff4d4d';
    ctx.fillRect(x0 + cop.x * scale - 2, y0 + cop.y * scale - 2, 4, 4);
  }
  const px = x0 + game.player.x * scale;
  const py = y0 + game.player.y * scale;
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(px, py, 4.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#19c2b8';
  ctx.lineWidth = 2;
  ctx.stroke();
  // View rectangle.
  const vw = game.canvas.width / game.camera.zoom * scale;
  const vh = game.canvas.height / game.camera.zoom * scale;
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 1;
  ctx.strokeRect(px - vw / 2, py - vh / 2, vw, vh);
  ctx.restore();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 11px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('SOLMAR BAY', x0 + 2, y0 + size + 2);
}

/** Title screen over the live city. */
export function drawTitle(ctx, game, hasSave) {
  const w = game.canvas.width;
  const h = game.canvas.height;
  ctx.fillStyle = 'rgba(8,12,22,0.45)';
  ctx.fillRect(0, 0, w, h);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffd23f';
  ctx.font = 'bold 15px sans-serif';
  ctx.fillText('A N   O P E N - W O R L D   C R I M E   G A M E', w / 2, h / 2 - 148);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 92px sans-serif';
  ctx.fillText('SOLMAR BAY', w / 2, h / 2 - 62);
  ctx.fillStyle = '#19c2b8';
  ctx.font = 'bold 22px sans-serif';
  ctx.fillText('Dana Moreno comes home. The city is waiting.', w / 2, h / 2 - 26);
  const items = hasSave
    ? ['▶  NEW GAME', '▶  CONTINUE', '▶  HOW TO PLAY']
    : ['▶  NEW GAME', '▶  HOW TO PLAY'];
  ctx.font = 'bold 24px sans-serif';
  items.forEach((item, i) => {
    const y = h / 2 + 40 + i * 46;
    const selected = game.menuIndex === i;
    if (selected) {
      ctx.fillStyle = 'rgba(255,210,63,0.18)';
      const iw = ctx.measureText(item).width + 40;
      ctx.fillRect(w / 2 - iw / 2, y - 28, iw, 38);
    }
    ctx.fillStyle = selected ? '#ffd23f' : '#e8e8e8';
    ctx.fillText(item, w / 2, y);
  });
  ctx.fillStyle = 'rgba(255,255,255,0.65)';
  ctx.font = '14px sans-serif';
  ctx.fillText('WASD move · Mouse aim · Click shoot · E enter / steal car · Esc pause', w / 2, h - 34);
  ctx.fillText('8 story missions · taxi fares · 24 coins · wanted levels 0–5', w / 2, h - 14);
  ctx.textAlign = 'left';
}

/** Controls screen. */
export function drawHowTo(ctx, game) {
  const w = game.canvas.width;
  const h = game.canvas.height;
  ctx.fillStyle = 'rgba(8,12,22,0.78)';
  ctx.fillRect(0, 0, w, h);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffd23f';
  ctx.font = 'bold 40px sans-serif';
  ctx.fillText('HOW TO PLAY', w / 2, 110);
  const lines = [
    ['W A S D / Arrow keys', 'Move on foot · drive when in a car'],
    ['Mouse', 'Aim · Click to shoot your pistol'],
    ['E', 'Enter / steal a car · talk · pick things up'],
    ['F', 'Punch when someone gets close'],
    ['T', 'Start a taxi fare while driving a yellow taxi'],
    ['R', 'Reload your pistol'],
    ['M', 'Mute sound and music'],
    ['Esc', 'Pause the game'],
    ['', ''],
    ['Stealing a car in front of a cop or a witness raises your wanted level.'],
    ['Lose the police by breaking line of sight and staying quiet.'],
    ['Follow the yellow marker: it is always your next objective.'],
    ['Collect all 24 gold coins hidden around Solmar Bay.'],
  ];
  ctx.font = '16px sans-serif';
  lines.forEach(([key, val], i) => {
    const y = 170 + i * 32;
    ctx.fillStyle = '#ffd23f';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(key, w / 2 - 20, y);
    ctx.fillStyle = '#fff';
    ctx.font = '16px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(val, w / 2 + 20, y);
  });
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = '15px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Press Esc or Enter to go back', w / 2, h - 40);
  ctx.textAlign = 'left';
}

/** Pause menu. */
export function drawPaused(ctx, game) {
  const w = game.canvas.width;
  const h = game.canvas.height;
  ctx.fillStyle = 'rgba(8,12,22,0.6)';
  ctx.fillRect(0, 0, w, h);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 48px sans-serif';
  ctx.fillText('PAUSED', w / 2, h / 2 - 90);
  const items = ['▶  RESUME', '▶  SAVE GAME', '▶  HOW TO PLAY', '▶  QUIT TO TITLE'];
  ctx.font = 'bold 22px sans-serif';
  items.forEach((item, i) => {
    const y = h / 2 - 20 + i * 44;
    const selected = game.menuIndex === i;
    if (selected) {
      ctx.fillStyle = 'rgba(255,210,63,0.18)';
      const iw = ctx.measureText(item).width + 40;
      ctx.fillRect(w / 2 - iw / 2, y - 26, iw, 36);
    }
    ctx.fillStyle = selected ? '#ffd23f' : '#e8e8e8';
    ctx.fillText(item, w / 2, y);
  });
  ctx.textAlign = 'left';
}

/** Game-over screen after Dana is taken down. */
export function drawGameOver(ctx, game) {
  const w = game.canvas.width;
  const h = game.canvas.height;
  ctx.fillStyle = 'rgba(20,4,6,0.72)';
  ctx.fillRect(0, 0, w, h);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ff5b4d';
  ctx.font = 'bold 64px sans-serif';
  ctx.fillText('DANA IS DOWN', w / 2, h / 2 - 60);
  ctx.fillStyle = '#fff';
  ctx.font = '20px sans-serif';
  ctx.fillText('The paramedics patched you up at St. Marina Hospital.', w / 2, h / 2 - 16);
  ctx.fillText('You lost $100 in hospital bills. The city is still waiting.', w / 2, h / 2 + 14);
  ctx.fillStyle = '#ffd23f';
  ctx.font = 'bold 22px sans-serif';
  ctx.fillText('Press Enter to get back on your feet', w / 2, h / 2 + 70);
  ctx.textAlign = 'left';
}

/** Story-complete screen after mission 8. */
export function drawStoryComplete(ctx, game) {
  const w = game.canvas.width;
  const h = game.canvas.height;
  ctx.fillStyle = 'rgba(8,16,12,0.7)';
  ctx.fillRect(0, 0, w, h);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffd23f';
  ctx.font = 'bold 56px sans-serif';
  ctx.fillText('SOLMAR BAY IS YOURS', w / 2, h / 2 - 50);
  ctx.fillStyle = '#fff';
  ctx.font = '20px sans-serif';
  ctx.fillText('All 8 missions complete. The debt is paid, the crew is yours,', w / 2, h / 2 - 6);
  ctx.fillText('and the city keeps turning. Free roam — it is all yours now.', w / 2, h / 2 + 24);
  ctx.fillStyle = '#19c2b8';
  ctx.font = 'bold 22px sans-serif';
  ctx.fillText('Press Enter to keep playing', w / 2, h / 2 + 80);
  ctx.textAlign = 'left';
}

/** Bottom dialog box for story lines. */
export function drawDialog(ctx, game) {
  if (!game.dialog || game.dialog.length === 0) return;
  const line = game.dialog[0];
  const w = game.canvas.width;
  const h = game.canvas.height;
  const bw = Math.min(760, w - 80);
  const bx = (w - bw) / 2;
  const by = h - 190;
  panel(ctx, bx, by, bw, 110, 12);
  ctx.fillStyle = '#ffd23f';
  ctx.font = 'bold 16px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(line.who.toUpperCase(), bx + 24, by + 30);
  ctx.fillStyle = '#fff';
  ctx.font = '17px sans-serif';
  wrapText(ctx, line.text, bx + 24, by + 58, bw - 48, 24);
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.font = '13px sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('E / Click to continue', bx + bw - 18, by + 96);
  ctx.textAlign = 'left';
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split(' ');
  let line = '';
  let cy = y;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, cy);
      line = word;
      cy += lineHeight;
    } else {
      line = test;
    }
  }
  ctx.fillText(line, x, cy);
}
