// Moving things in Solmar Bay: the player, drivable cars, traffic AI that
// follows the road grid, pedestrians, police (foot and patrol cars), armed
// enemies, and the particle puffs that sell the motion.
import { Rng, clamp, dist, dist2, angleDiff, circleHitsRect } from './util.js';
import { ROADS, HALF_ROAD, WORLD_W, WORLD_H, collideBuildings, isInSea, isOnRoad } from './world.js';

export const CAR_COLORS = ['#c0392b', '#2980b9', '#f1c40f', '#ecf0f1', '#2c3e50', '#8e44ad', '#e67e22', '#16a085', '#bdc3c7', '#7f8c8d'];
export const TAXI_COLOR = '#f7c948';
export const POLICE_COLOR = '#1f3a5f';

const CAR_TYPES = {
  sedan: { w: 46, h: 22, accel: 420, top: 430, grip: 3.4 },
  sport: { w: 48, h: 21, accel: 560, top: 560, grip: 3.0 },
  taxi: { w: 46, h: 22, accel: 420, top: 430, grip: 3.4 },
  truck: { w: 62, h: 26, accel: 300, top: 340, grip: 3.8 },
  van: { w: 54, h: 24, accel: 340, top: 370, grip: 3.6 },
  police: { w: 48, h: 22, accel: 520, top: 520, grip: 3.2 },
};

export function createPlayer(x, y) {
  return {
    x, y, angle: -Math.PI / 2, speed: 0,
    radius: 13, health: 100, maxHealth: 100,
    onFoot: true, car: null,
    fireCooldown: 0, punchCooldown: 0, hurtCooldown: 0,
    hasPistol: true, ammo: 12, reloadTimer: 0,
    walkPhase: 0, moving: false,
  };
}

export function createCar(type, x, y, angle, rng) {
  const spec = CAR_TYPES[type] || CAR_TYPES.sedan;
  return {
    kind: 'car', type, x, y, angle, speed: 0,
    w: spec.w, h: spec.h, accel: spec.accel, top: spec.top, grip: spec.grip,
    color: type === 'taxi' ? TAXI_COLOR : type === 'police' ? POLICE_COLOR : rng ? rng.pick(CAR_COLORS) : '#888888',
    driver: null, // 'player' | 'traffic' | 'police' | null (parked)
    ai: null, // traffic state when driver === 'traffic'
    brakeLight: false, siren: type === 'police',
    crashed: 0, // brief stun after a hard hit
  };
}

/** Spawn a parked car in a roadside lane (on asphalt, clear of buildings). */
export function spawnParkedCar(city, rng) {
  const road = rng.pick(ROADS);
  const along = rng.range(200, WORLD_H - 200);
  const horizontal = rng.chance(0.5);
  const side = rng.chance(0.5) ? 1 : -1;
  const type = rng.pick(['sedan', 'sedan', 'sport', 'taxi', 'van', 'truck']);
  const lane = side * 32; // kerbside lane: inside the road, off the sidewalk
  const x = horizontal ? along : road + lane;
  const y = horizontal ? road + lane : along;
  const angle = horizontal ? (side > 0 ? 0 : Math.PI) : side > 0 ? Math.PI / 2 : -Math.PI / 2;
  const car = createCar(type, x, y, angle, rng);
  car.driver = null;
  return car;
}

/** Spawn a traffic car driving on a road. */
export function spawnTrafficCar(city, rng) {
  const horizontal = rng.chance(0.5);
  const road = rng.pick(ROADS);
  const along = rng.range(150, WORLD_W - 150);
  const dir = rng.chance(0.5) ? 1 : -1;
  const lane = dir > 0 ? -22 : 22; // right-hand traffic
  const type = rng.pick(['sedan', 'sedan', 'sport', 'taxi', 'van', 'truck', 'sedan']);
  const x = horizontal ? along : road + lane;
  const y = horizontal ? road + lane : along;
  const angle = horizontal ? (dir > 0 ? 0 : Math.PI) : dir > 0 ? Math.PI / 2 : -Math.PI / 2;
  const car = createCar(type, x, y, angle, rng);
  car.driver = 'traffic';
  car.ai = {
    horizontal, road, dir, lane,
    speed: rng.range(110, 190),
    targetSpeed: rng.range(110, 190),
    stopped: 0,
  };
  return car;
}

export function createPed(x, y, rng) {
  const horizontal = rng.chance(0.5);
  const road = rng.pick(ROADS);
  const along = rng.range(150, WORLD_W - 150);
  const side = rng.chance(0.5) ? 1 : -1;
  const px = horizontal ? along : road + side * (HALF_ROAD + 14);
  const py = horizontal ? road + side * (HALF_ROAD + 14) : along;
  return {
    kind: 'ped',
    x: px, y: py,
    angle: rng.range(0, Math.PI * 2),
    speed: rng.range(28, 52),
    radius: 10,
    shirt: rng.pick(['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#ecf0f1', '#e67e22', '#1abc9c']),
    skin: rng.pick(['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac']),
    dir: rng.chance(0.5) ? 1 : -1,
    horizontal,
    road,
    side,
    flee: 0,
    walkPhase: rng.range(0, 6),
  };
}

export function createFootCop(x, y) {
  return {
    kind: 'cop', x, y, angle: 0, speed: 150,
    radius: 12, health: 60, fireCooldown: 0,
    shirt: '#1f3a5f', skin: '#e0ac69', walkPhase: 0,
  };
}

export function createPoliceCar(x, y, angle, rng) {
  const car = createCar('police', x, y, angle, rng);
  car.driver = 'police';
  car.ai = { chase: 0 };
  return car;
}

export function createEnemy(x, y, rng) {
  return {
    kind: 'enemy', x, y, angle: rng.range(0, Math.PI * 2),
    speed: 95, radius: 12, health: 100,
    fireCooldown: rng.range(0.5, 1.5),
    shirt: '#5d3a3a', skin: rng.pick(['#f1c27d', '#e0ac69', '#c68642']),
    walkPhase: 0, dead: false, strafeDir: rng.chance(0.5) ? 1 : -1,
  };
}

export function createParticles() {
  return [];
}

export function spawnParticles(list, x, y, count, color, speed, life, size) {
  for (let i = 0; i < count; i += 1) {
    const a = Math.random() * Math.PI * 2;
    const s = speed * (0.4 + Math.random() * 0.8);
    list.push({
      x, y,
      vx: Math.cos(a) * s, vy: Math.sin(a) * s,
      life: life * (0.6 + Math.random() * 0.7), maxLife: life,
      color, size: size * (0.6 + Math.random() * 0.8),
    });
  }
}

export function updateParticles(list, dt) {
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const p = list[i];
    p.life -= dt;
    if (p.life <= 0) {
      list.splice(i, 1);
      continue;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 0.94;
    p.vy *= 0.94;
  }
}

/** Arcade car physics: accelerate, steer, slide off buildings, stay in town. */
export function driveCar(car, steer, throttle, dt, city, cars) {
  if (car.crashed > 0) car.crashed -= dt;
  const maxReverse = car.top * 0.45;
  if (throttle > 0) car.speed += car.accel * throttle * dt;
  else if (throttle < 0) car.speed += car.accel * 0.7 * throttle * dt;
  else {
    // Rolling drag.
    car.speed -= car.speed * 0.9 * dt;
    if (Math.abs(car.speed) < 4) car.speed = 0;
  }
  car.speed = clamp(car.speed, -maxReverse, car.top);
  const steerAmount = steer * car.grip * clamp(Math.abs(car.speed) / 120, 0, 1) * (car.speed >= 0 ? 1 : -1);
  car.angle += steerAmount * dt * (Math.abs(car.speed) > 1 ? 1 : 0);
  const nx = car.x + Math.cos(car.angle) * car.speed * dt;
  const ny = car.y + Math.sin(car.angle) * car.speed * dt;
  const oldX = car.x;
  const oldY = car.y;
  car.x = clamp(nx, 30, WORLD_W - 30);
  car.y = clamp(ny, 30, WORLD_H - 30);
  if (isInSea(car.x, car.y)) {
    car.x = oldX;
    car.y = oldY;
    car.speed *= -0.3;
  }
  // Buildings: slide along them instead of stopping dead.
  const probe = { x: car.x, y: car.y };
  let hitBuilding = false;
  for (const b of city.buildings) {
    if (probe.x < b.x - 14 || probe.x > b.x + b.w + 14 || probe.y < b.y - 14 || probe.y > b.y + b.h + 14) continue;
    if (circleHitsRect(probe.x, probe.y, 15, b)) {
      hitBuilding = true;
      break;
    }
  }
  if (hitBuilding) {
    // Try moving on x only, then y only; keep whichever axis is free.
    const tryX = { x: nx, y: oldY };
    let xFree = true;
    for (const b of city.buildings) {
      if (circleHitsRect(tryX.x, tryX.y, 15, b)) { xFree = false; break; }
    }
    const tryY = { x: oldX, y: ny };
    let yFree = true;
    for (const b of city.buildings) {
      if (circleHitsRect(tryY.x, tryY.y, 15, b)) { yFree = false; break; }
    }
    car.x = xFree ? nx : oldX;
    car.y = yFree ? ny : oldY;
    if (!xFree && !yFree) car.speed *= 0.4;
    else car.speed *= 0.92;
    if (Math.abs(car.speed) > 260 && car.crashed <= 0) {
      car.crashed = 0.4;
      return 'crash';
    }
  }
  // Soft car-car separation.
  for (const other of cars) {
    if (other === car) continue;
    const d2 = dist2(car.x, car.y, other.x, other.y);
    const minD = 52;
    if (d2 < minD * minD && d2 > 0.01) {
      const d = Math.sqrt(d2);
      const push = (minD - d) / 2;
      const ux = (car.x - other.x) / d;
      const uy = (car.y - other.y) / d;
      car.x += ux * push;
      car.y += uy * push;
      other.x -= ux * push;
      other.y -= uy * push;
      if (Math.abs(car.speed) > 200) car.speed *= 0.8;
    }
  }
  return null;
}

/** Traffic AI: follow the road, stop for the car ahead, turn at junctions. */
export function updateTrafficCar(car, dt, cars, rng) {
  const ai = car.ai;
  if (!ai) return;
  // Car ahead on the same lane?
  let ahead = Infinity;
  for (const other of cars) {
    if (other === car || !other.ai || other.ai.horizontal !== ai.horizontal || other.ai.road !== ai.road) continue;
    const along = ai.horizontal ? other.x - car.x : other.y - car.y;
    const forward = along * ai.dir;
    if (forward > 0 && forward < ahead) ahead = forward;
  }
  const want = ahead < 70 ? 0 : ai.targetSpeed;
  ai.speed += clamp(want - ai.speed, -260 * dt, 200 * dt);
  if (ai.horizontal) car.x += ai.dir * ai.speed * dt;
  else car.y += ai.dir * ai.speed * dt;
  car.angle = ai.horizontal ? (ai.dir > 0 ? 0 : Math.PI) : ai.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
  // Wrap around the map edge so traffic never runs out.
  if (car.x < 60) car.x = WORLD_W - 70;
  if (car.x > WORLD_W - 60) car.x = 70;
  if (car.y < 60) car.y = WORLD_H - 70;
  if (car.y > WORLD_H - 60) car.y = 70;
  // At an intersection, sometimes turn onto the crossing road.
  const onCross = ROADS.find((r) => Math.abs((ai.horizontal ? car.x : car.y) - r) < 14);
  if (onCross !== undefined && rng.chance(0.006)) {
    const cross = onCross;
    const turnHorizontal = !ai.horizontal;
    const newDir = rng.chance(0.5) ? 1 : -1;
    const lane = newDir > 0 ? -22 : 22;
    ai.horizontal = turnHorizontal;
    ai.road = cross;
    ai.dir = newDir;
    ai.lane = lane;
    if (turnHorizontal) {
      car.y = cross + lane;
    } else {
      car.x = cross + lane;
    }
  }
}

/** Pedestrian AI: stroll along the sidewalk, flee from gunfire. */
export function updatePed(ped, dt, dangerX, dangerY, dangerActive) {
  ped.walkPhase += dt * 6;
  if (dangerActive && dist(ped.x, ped.y, dangerX, dangerY) < 320) ped.flee = 1.2;
  if (ped.flee > 0) {
    ped.flee -= dt;
    const a = Math.atan2(ped.y - dangerY, ped.x - dangerX);
    ped.x += Math.cos(a) * 130 * dt;
    ped.y += Math.sin(a) * 130 * dt;
    ped.angle = a;
  } else {
    const step = ped.speed * ped.dir * dt;
    if (ped.horizontal) ped.x += step;
    else ped.y += step;
    ped.angle = ped.horizontal ? (ped.dir > 0 ? 0 : Math.PI) : ped.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    if (ped.x < 120) { ped.x = 120; ped.dir = 1; }
    if (ped.x > WORLD_W - 120) { ped.x = WORLD_W - 120; ped.dir = -1; }
    if (ped.y < 120) { ped.y = 120; ped.dir = 1; }
    if (ped.y > WORLD_H - 120) { ped.y = WORLD_H - 120; ped.dir = -1; }
  }
  ped.x = clamp(ped.x, 100, WORLD_W - 100);
  ped.y = clamp(ped.y, 100, WORLD_H - 100);
  if (isInSea(ped.x, ped.y)) ped.x = 160;
}

/** Foot cop: run at the player, swing when close, shoot at wanted 3+. */
export function updateFootCop(cop, player, dt, wanted, onShoot) {
  const d = dist(cop.x, cop.y, player.x, player.y);
  const a = Math.atan2(player.y - cop.y, player.x - cop.x);
  cop.angle = a;
  cop.walkPhase += dt * 8;
  if (d > 34) {
    cop.x += Math.cos(a) * cop.speed * dt;
    cop.y += Math.sin(a) * cop.speed * dt;
  }
  cop.fireCooldown -= dt;
  if (wanted >= 3 && d < 380 && d > 60 && cop.fireCooldown <= 0) {
    cop.fireCooldown = 1.1;
    onShoot(cop, player);
  }
}

/** Police car: steer toward the player and ram; brakes to a stop when close. */
export function updatePoliceCar(car, player, dt, city, cars) {
  const d = dist(car.x, car.y, player.x, player.y);
  const wantAngle = Math.atan2(player.y - car.y, player.x - car.x);
  const diff = angleDiff(car.angle, wantAngle);
  const steer = clamp(diff * 2.2, -1, 1);
  const throttle = d > 90 ? 1 : 0.4;
  driveCar(car, steer, throttle, dt, city, cars);
}

/** Armed enemy: strafe and shoot at the player when in range. */
export function updateEnemy(enemy, player, dt, onShoot) {
  if (enemy.dead) return;
  const d = dist(enemy.x, enemy.y, player.x, player.y);
  const a = Math.atan2(player.y - enemy.y, player.x - enemy.x);
  enemy.angle = a;
  enemy.walkPhase += dt * 6;
  enemy.fireCooldown -= dt;
  if (d < 420 && d > 120) {
    // Strafe sideways while closing in slowly.
    const strafe = a + (Math.PI / 2) * enemy.strafeDir;
    enemy.x += Math.cos(strafe) * 40 * dt + Math.cos(a) * 25 * dt;
    enemy.y += Math.sin(strafe) * 40 * dt + Math.sin(a) * 25 * dt;
    if (Math.random() < 0.01) enemy.strafeDir *= -1;
  }
  if (d < 420 && enemy.fireCooldown <= 0) {
    enemy.fireCooldown = 1.4;
    onShoot(enemy, player);
  }
}
