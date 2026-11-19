// Canvas painting for Solmar Bay: the city, its people and cars, particles,
// and the day/night light. Everything is drawn from flat shapes — no images,
// so the game loads nothing over the network.
import { ROADS, ROAD_W, HALF_ROAD, WORLD_W, WORLD_H, SEA_X, BEACH_X, districtAt, isOnRoad } from './world.js';
import { clamp, lerp } from './util.js';

/** How dark the world is at a given game hour (0 = noon, ~0.5 = deep night). */
export function darknessAt(hour) {
  // Day 7:00-18:00, dusk 18-20, night 20-5:30, dawn 5:30-7.
  if (hour >= 7 && hour < 18) return 0;
  if (hour >= 18 && hour < 20) return (hour - 18) / 2 * 0.42;
  if (hour >= 5.5 && hour < 7) return (7 - hour) / 1.5 * 0.42;
  return 0.48;
}

export function isNight(hour) {
  return darknessAt(hour) > 0.2;
}

function drawGround(ctx, view, hour) {
  // Base grass.
  ctx.fillStyle = '#69a854';
  ctx.fillRect(view.x, view.y, view.w, view.h);
  // Block interiors: downtown reads as concrete, suburb as lawn, so the
  // city never looks like one big empty field.
  for (let bi = 0; bi < ROADS.length - 1; bi += 1) {
    for (let bj = 0; bj < ROADS.length - 1; bj += 1) {
      const x0 = ROADS[bi] + HALF_ROAD;
      const y0 = ROADS[bj] + HALF_ROAD;
      const x1 = ROADS[bi + 1] - HALF_ROAD;
      const y1 = ROADS[bj + 1] - HALF_ROAD;
      if (x1 < view.x || x0 > view.x + view.w || y1 < view.y || y0 > view.y + view.h) continue;
      const district = districtAt((x0 + x1) / 2, (y0 + y1) / 2);
      if (district === 'beach') continue;
      if (bi === 3 && bj === 3) continue; // the park is painted below
      ctx.fillStyle = district === 'downtown' ? '#9aa1a8' : district === 'port' ? '#a89a86' : '#7fae62';
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    }
  }
  // The park.
  ctx.fillStyle = '#4f8f46';
  ctx.fillRect(1548, 1548, 304, 304);
  ctx.fillStyle = '#7fb069';
  ctx.beginPath();
  ctx.arc(1700, 1700, 90, 0, Math.PI * 2);
  ctx.fill();
  // Sand and sea on the west edge.
  ctx.fillStyle = '#e9d6a4';
  ctx.fillRect(0, view.y, BEACH_X, view.h);
  ctx.fillStyle = '#2f8fb5';
  ctx.fillRect(0, view.y, SEA_X, view.h);
  // Animated wave lines where sea meets sand.
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 2;
  const t = performance.now() / 900;
  for (let y = 0; y < WORLD_H; y += 90) {
    const wobble = Math.sin(y / 160 + t) * 6;
    ctx.beginPath();
    ctx.moveTo(SEA_X - 26 + wobble, y);
    ctx.quadraticCurveTo(SEA_X - 8 + wobble, y + 22, SEA_X - 26 + wobble, y + 44);
    ctx.stroke();
  }
  // Port quay on the south-east.
  ctx.fillStyle = '#9a8f80';
  ctx.fillRect(2380, 3220, 1080, 180);
  ctx.fillStyle = '#2f8fb5';
  ctx.fillRect(2380, 3400, 1080, 200);
}

function drawRoads(ctx, view) {
  // Sidewalk aprons first, then asphalt, then markings.
  for (const r of ROADS) {
    ctx.fillStyle = '#b7b0a0';
    ctx.fillRect(r - HALF_ROAD - 10, 0, ROAD_W + 20, WORLD_H);
    ctx.fillRect(0, r - HALF_ROAD - 10, WORLD_W, ROAD_W + 20);
  }
  for (const r of ROADS) {
    ctx.fillStyle = '#3a3f47';
    ctx.fillRect(r - HALF_ROAD, 0, ROAD_W, WORLD_H);
    ctx.fillRect(0, r - HALF_ROAD, WORLD_W, ROAD_W);
  }
  // Centre dashes.
  ctx.fillStyle = '#e8c33c';
  for (const r of ROADS) {
    for (let d = 40; d < WORLD_H; d += 80) {
      ctx.fillRect(r - 2, d, 4, 34);
      ctx.fillRect(d, r - 2, 34, 4);
    }
  }
  // Intersection squares hide the dashes.
  ctx.fillStyle = '#3a3f47';
  for (const rx of ROADS) {
    for (const ry of ROADS) {
      ctx.fillRect(rx - HALF_ROAD, ry - HALF_ROAD, ROAD_W, ROAD_W);
    }
  }
  // Crosswalks at every intersection.
  ctx.fillStyle = 'rgba(240,240,230,0.85)';
  for (const rx of ROADS) {
    for (const ry of ROADS) {
      for (let i = -3; i <= 3; i += 1) {
        ctx.fillRect(rx + i * 12 - 4, ry - HALF_ROAD + 4, 8, 14);
        ctx.fillRect(rx + i * 12 - 4, ry + HALF_ROAD - 18, 8, 14);
      }
    }
  }
}

function drawBuildings(ctx, view, city) {
  for (const b of city.buildings) {
    if (b.x > view.x + view.w || b.x + b.w < view.x || b.y > view.y + view.h || b.y + b.h < view.y) continue;
    // Drop shadow to the south-east sells the height.
    const shade = Math.min(10, b.tall * 1.6);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(b.x + shade, b.y + shade, b.w, b.h);
    ctx.fillStyle = b.color;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    // Roof inset.
    ctx.fillStyle = b.roof;
    ctx.fillRect(b.x + 6, b.y + 6, b.w - 12, b.h - 12);
    // Windows along the edges for tall downtown blocks.
    if (b.tall >= 3) {
      ctx.fillStyle = 'rgba(180,220,255,0.85)';
      const cols = Math.floor(b.w / 22);
      const rows = Math.floor(b.h / 22);
      for (let i = 0; i < cols; i += 1) {
        for (let j = 0; j < rows; j += 1) {
          if ((i + j) % 2 === 0) ctx.fillRect(b.x + 10 + i * 22, b.y + 10 + j * 22, 10, 12);
        }
      }
    }
  }
}

function drawTrees(ctx, view, city) {
  for (const t of city.trees) {
    if (t.x < view.x - 30 || t.x > view.x + view.w + 30 || t.y < view.y - 30 || t.y > view.y + view.h + 30) continue;
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath();
    ctx.ellipse(t.x + 4, t.y + 5, t.r, t.r * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();
    if (t.palm) {
      ctx.strokeStyle = '#7a5a38';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(t.x, t.y + 6);
      ctx.lineTo(t.x, t.y - 8);
      ctx.stroke();
      ctx.fillStyle = '#2f9e4f';
      for (let i = 0; i < 5; i += 1) {
        const a = (i / 5) * Math.PI * 2;
        ctx.beginPath();
        ctx.ellipse(t.x + Math.cos(a) * t.r * 0.7, t.y - 8 + Math.sin(a) * t.r * 0.5, t.r * 0.75, 5, a, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      ctx.fillStyle = '#3e8e41';
      ctx.beginPath();
      ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#57ab5a';
      ctx.beginPath();
      ctx.arc(t.x - 4, t.y - 4, t.r * 0.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawLamps(ctx, view, city, hour) {
  const night = isNight(hour);
  for (const lamp of city.lamps) {
    if (lamp.x < view.x - 60 || lamp.x > view.x + view.w + 60 || lamp.y < view.y - 60 || lamp.y > view.y + view.h + 60) continue;
    ctx.fillStyle = '#4a4a48';
    ctx.fillRect(lamp.x - 2, lamp.y - 2, 4, 4);
    if (night) {
      const glow = ctx.createRadialGradient(lamp.x, lamp.y, 2, lamp.x, lamp.y, 46);
      glow.addColorStop(0, 'rgba(255,220,130,0.5)');
      glow.addColorStop(1, 'rgba(255,220,130,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(lamp.x, lamp.y, 46, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffe9a8';
      ctx.beginPath();
      ctx.arc(lamp.x, lamp.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawCoins(ctx, view, city, time) {
  for (const coin of city.coins) {
    if (coin.taken) continue;
    if (coin.x < view.x - 30 || coin.x > view.x + view.w + 30 || coin.y < view.y - 30 || coin.y > view.y + view.h + 30) continue;
    const bob = Math.sin(time * 3 + coin.id) * 2;
    ctx.fillStyle = '#f7c948';
    ctx.beginPath();
    ctx.arc(coin.x, coin.y + bob, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#a87b00';
    ctx.beginPath();
    ctx.arc(coin.x, coin.y + bob, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f7c948';
    ctx.font = 'bold 8px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('S', coin.x, coin.y + bob + 0.5);
  }
}

function drawMarker(ctx, target, time) {
  if (!target) return;
  const pulse = 1 + Math.sin(time * 4) * 0.12;
  const r = 16 * pulse;
  ctx.strokeStyle = '#ffd23f';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(target.x, target.y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#ffd23f';
  ctx.beginPath();
  ctx.moveTo(target.x, target.y - 34);
  ctx.lineTo(target.x - 9, target.y - 18);
  ctx.lineTo(target.x + 9, target.y - 18);
  ctx.closePath();
  ctx.fill();
  // Ground ring so the marker reads from far away.
  ctx.strokeStyle = 'rgba(255,210,63,0.5)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(target.x, target.y, r + 14, 0, Math.PI * 2);
  ctx.stroke();
}

function drawCar(ctx, car, time) {
  ctx.save();
  ctx.translate(car.x, car.y);
  ctx.rotate(car.angle);
  // Shadow.
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fillRect(-car.w / 2 + 3, -car.h / 2 + 4, car.w, car.h);
  // Body.
  ctx.fillStyle = car.color;
  roundRect(ctx, -car.w / 2, -car.h / 2, car.w, car.h, 7);
  ctx.fill();
  // Cabin and windshield.
  ctx.fillStyle = 'rgba(20,30,44,0.85)';
  roundRect(ctx, -car.w / 6, -car.h / 2 + 3, car.w / 3, car.h - 6, 4);
  ctx.fill();
  ctx.fillStyle = 'rgba(140,200,235,0.7)';
  ctx.fillRect(car.w / 6, -car.h / 2 + 4, 5, car.h - 8);
  // Wheels.
  ctx.fillStyle = '#16181c';
  ctx.fillRect(-car.w / 2 + 4, -car.h / 2 - 3, 10, 5);
  ctx.fillRect(-car.w / 2 + 4, car.h / 2 - 2, 10, 5);
  ctx.fillRect(car.w / 2 - 14, -car.h / 2 - 3, 10, 5);
  ctx.fillRect(car.w / 2 - 14, car.h / 2 - 2, 10, 5);
  // Headlights and brake lights.
  ctx.fillStyle = '#fff6c0';
  ctx.fillRect(car.w / 2 - 2, -car.h / 2 + 3, 2, 5);
  ctx.fillRect(car.w / 2 - 2, car.h / 2 - 8, 2, 5);
  if (car.brakeLight) {
    ctx.fillStyle = '#ff2d2d';
    ctx.fillRect(-car.w / 2, -car.h / 2 + 3, 2, 5);
    ctx.fillRect(-car.w / 2, car.h / 2 - 8, 2, 5);
  }
  if (car.type === 'taxi') {
    ctx.fillStyle = '#111';
    ctx.font = 'bold 8px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('TAXI', 0, 0);
    ctx.fillStyle = '#f7c948';
    ctx.fillRect(-10, -car.h / 2 - 6, 20, 5);
  }
  if (car.type === 'police') {
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 8px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('POLICE', 0, 0);
    // Flashing light bar.
    const flash = Math.floor(time * 4) % 2 === 0;
    ctx.fillStyle = flash ? '#ff2d2d' : '#2d6bff';
    ctx.fillRect(-8, -car.h / 2 - 5, 7, 5);
    ctx.fillStyle = flash ? '#2d6bff' : '#ff2d2d';
    ctx.fillRect(1, -car.h / 2 - 5, 7, 5);
  }
  ctx.restore();
}

function drawPerson(ctx, p, time, isPlayer) {
  const bob = Math.sin(p.walkPhase || 0) * 2;
  ctx.save();
  ctx.translate(p.x, p.y);
  // Shadow.
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.ellipse(2, 3, 11, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.rotate(p.angle);
  // Body: shoulders and head, facing the aim direction.
  ctx.fillStyle = p.shirt;
  ctx.beginPath();
  ctx.arc(0, 0, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = p.skin;
  ctx.beginPath();
  ctx.arc(3, 0, 6, 0, Math.PI * 2);
  ctx.fill();
  // Facing tick.
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(8, 0);
  ctx.lineTo(13, 0);
  ctx.stroke();
  if (isPlayer) {
    // Dana's teal jacket ring so the player is always findable.
    ctx.strokeStyle = '#19c2b8';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(0, 0, 13, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
  void bob;
}

function drawParticles(ctx, particles) {
  for (const p of particles) {
    const alpha = clamp(p.life / p.maxLife, 0, 1);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * Paint the whole world view. `game` carries city, entities, camera, clock
 * and mission state; `screen` is 'title' | 'play' | 'paused' | 'over' |
 * 'howto' (the world still paints behind menus).
 */
export function drawWorld(ctx, game, screen, time) {
  const { canvas, camera, city, hour } = game;
  const w = canvas.width;
  const h = canvas.height;
  const zoom = camera.zoom;
  const view = {
    x: camera.x - w / 2 / zoom,
    y: camera.y - h / 2 / zoom,
    w: w / zoom,
    h: h / zoom,
  };
  ctx.save();
  ctx.clearRect(0, 0, w, h);
  ctx.translate(w / 2, h / 2);
  ctx.scale(zoom, zoom);
  ctx.translate(-camera.x, -camera.y);

  drawGround(ctx, view, hour);
  drawRoads(ctx, view);
  drawBuildings(ctx, view, city);
  drawTrees(ctx, view, city);
  drawCoins(ctx, view, city, time);
  drawLamps(ctx, view, city, hour);

  // Mission marker under the entities so it never hides the player.
  if (screen === 'play') drawMarker(ctx, game.missionTarget, time);
  // Taxi fare marker.
  if (game.taxi && game.taxi.active) drawMarker(ctx, game.taxi.target, time);

  // Headlight cones at night, drawn before the entities.
  if (isNight(hour)) {
    for (const car of game.cars) {
      if (Math.abs(car.speed) < 20) continue;
      const grad = ctx.createRadialGradient(car.x, car.y, 10, car.x, car.y, 150);
      grad.addColorStop(0, 'rgba(255,240,180,0.20)');
      grad.addColorStop(1, 'rgba(255,240,180,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(car.x + Math.cos(car.angle) * 70, car.y + Math.sin(car.angle) * 70, 110, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Cars sorted so nearer ones overlap correctly (painter's order by y).
  const cars = [...game.cars].sort((a, b) => a.y - b.y);
  for (const car of cars) drawCar(ctx, car, time);
  for (const ped of game.peds) drawPerson(ctx, ped, time, false);
  for (const enemy of game.enemies) {
    if (!enemy.dead) drawPerson(ctx, enemy, time, false);
  }
  for (const cop of game.cops) drawPerson(ctx, cop, time, false);
  if (screen !== 'title') drawPerson(ctx, game.player, time, true);

  drawParticles(ctx, game.particles);

  // Night falls over everything.
  const dark = darknessAt(hour);
  if (dark > 0) {
    ctx.fillStyle = `rgba(8,14,44,${dark})`;
    ctx.fillRect(view.x, view.y, view.w, view.h);
  }
  ctx.restore();
}
