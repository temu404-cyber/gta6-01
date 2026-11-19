// Solmar Bay: the game itself. Owns the loop, the input, the wanted level,
// the mission step engine, combat, the taxi side job, coins, saving, and the
// camera. Rendering lives in render.js, the HUD and menus in hud.js.
import { Rng, clamp, lerp, dist, dist2, angleDiff } from './util.js';
import {
  WORLD_W, WORLD_H, ROADS, SEA_X, PLACES, createCity, collideBuildings, isInSea, nearestRoadPoint,
} from './world.js';
import {
  createPlayer, createCar, createPed, createFootCop, createPoliceCar, createEnemy,
  spawnParkedCar, spawnTrafficCar, createParticles, spawnParticles, updateParticles,
  driveCar, updateTrafficCar, updatePed, updateFootCop, updatePoliceCar, updateEnemy,
} from './entities.js';
import {
  MISSIONS, MISSION_COUNT, createMissionState, currentMission, currentStep,
  missionObjectiveLabel, missionTarget,
} from './missions.js';
import { drawWorld } from './render.js';
import {
  drawHud, drawTitle, drawHowTo, drawPaused, drawGameOver, drawStoryComplete, drawDialog,
} from './hud.js';
import { SoundEngine } from './audio.js';

export const SAVE_KEY = 'solmarbay-save-v1';
const STEP = 1 / 60;

function randomRoadPoint(rng, minDistFrom, minDist) {
  for (let tries = 0; tries < 40; tries += 1) {
    const road = rng.pick(ROADS);
    const along = rng.range(200, WORLD_W - 200);
    const horizontal = rng.chance(0.5);
    const p = horizontal ? { x: along, y: road } : { x: road, y: along };
    if (!minDistFrom || dist(p.x, p.y, minDistFrom.x, minDistFrom.y) >= minDist) return p;
  }
  return { x: 1500, y: 1500 };
}

export function createGame(canvas, seed) {
  const rng = new Rng(seed);
  const city = createCity(seed);
  const sound = new SoundEngine();
  const game = {
    canvas, ctx: canvas.getContext('2d'),
    seed, rng, city, sound,
    screen: 'title', prevScreen: 'title',
    menuIndex: 0,
    player: createPlayer(PLACES.rosaOffice.x - 120, PLACES.rosaOffice.y + 80),
    cars: [], peds: [], cops: [], enemies: [],
    particles: createParticles(),
    money: 50,
    wanted: 0,
    hour: 10,
    time: 0,
    mission: createMissionState(),
    dialog: [],
    banner: '', bannerTimer: 0,
    prompt: '',
    objectiveLabel: '',
    missionTarget: null,
    missionTimer: 0,
    taxi: { active: false, stage: 'pickup', target: null, fare: 0 },
    coinsTaken: 0,
    camera: { x: 1180, y: 1240, zoom: 1 },
    keys: new Set(),
    pressed: new Set(),
    mouse: { x: 0, y: 0, down: false, moved: false },
    aimAngle: -Math.PI / 2,
    crimeTimer: 0, // seconds since the last crime (blocks wanted decay)
    autosaveTimer: 0,
    shotMode: false,
  };

  // Traffic, parked cars and pedestrians fill the city.
  for (let i = 0; i < 26; i += 1) game.cars.push(spawnTrafficCar(city, rng));
  for (let i = 0; i < 14; i += 1) game.cars.push(spawnParkedCar(city, rng));
  for (let i = 0; i < 36; i += 1) game.peds.push(createPed(0, 0, rng));
  // One patrol car cruises even when nobody is wanted.
  const patrol = createPoliceCar(1500, 1500, 0, rng);
  patrol.driver = 'patrol';
  game.cars.push(patrol);

  game.objectiveLabel = missionObjectiveLabel(game.mission);
  game.missionTarget = missionTarget(game.mission);
  return game;
}

// ---------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------

export function hasSave() {
  try {
    return !!window.localStorage.getItem(SAVE_KEY);
  } catch {
    return false;
  }
}

export function saveGame(game) {
  try {
    const taken = game.city.coins.filter((c) => c.taken).map((c) => c.id);
    window.localStorage.setItem(SAVE_KEY, JSON.stringify({
      money: game.money,
      health: game.player.health,
      missionIndex: game.mission.index,
      missionStep: game.mission.step,
      taxiDone: game.mission.taxiDone,
      coins: taken,
      x: game.player.x, y: game.player.y,
      hour: game.hour,
      coinsTaken: game.coinsTaken,
    }));
  } catch {
    // Storage can be off: the game still plays, it just does not persist.
  }
}

export function loadSave(game) {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const s = JSON.parse(raw);
    game.money = s.money ?? 50;
    game.player.health = s.health ?? 100;
    game.player.x = s.x ?? game.player.x;
    game.player.y = s.y ?? game.player.y;
    game.hour = s.hour ?? 10;
    game.coinsTaken = s.coinsTaken ?? 0;
    game.mission.index = s.missionIndex ?? 0;
    game.mission.step = s.missionStep ?? 0;
    game.mission.taxiDone = s.taxiDone ?? 0;
    game.mission.started = false;
    for (const id of s.coins ?? []) {
      const coin = game.city.coins.find((c) => c.id === id);
      if (coin) coin.taken = true;
    }
    return true;
  } catch {
    return false;
  }
}

function clearSave() {
  try {
    window.localStorage.removeItem(SAVE_KEY);
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function showBanner(game, text, seconds = 3) {
  game.banner = text;
  game.bannerTimer = seconds;
}

function startDialog(game, lines) {
  game.dialog = lines.map((l) => ({ ...l }));
}

function addWanted(game, amount) {
  if (amount <= 0) return;
  game.wanted = clamp(game.wanted + amount, 0, 5);
  game.crimeTimer = 0;
}

function nearestCar(game, x, y, maxDist) {
  let best = null;
  let bestD = maxDist;
  for (const car of game.cars) {
    const d = dist(x, y, car.x, car.y);
    if (d < bestD) {
      bestD = d;
      best = car;
    }
  }
  return best;
}

function witnessNearby(game, x, y) {
  for (const cop of game.cops) if (dist(x, y, cop.x, cop.y) < 380) return true;
  for (const car of game.cars) {
    if (car.type === 'police' && dist(x, y, car.x, car.y) < 420) return true;
  }
  for (const ped of game.peds) if (dist(x, y, ped.x, ped.y) < 220) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Missions
// ---------------------------------------------------------------------------

function startMission(game) {
  const mission = currentMission(game.mission);
  if (!mission) return;
  game.mission.started = true;
  game.mission.step = 0;
  game.mission.chaseTime = 0;
  game.mission.taxiDone = 0;
  game.mission.targetCar = null;
  game.mission.enemies = [];
  game.enemies = [];
  showBanner(game, `Mission ${mission.id}: ${mission.title}`, 3.5);
  startDialog(game, mission.intro);
  setupStep(game);
}

function setupStep(game) {
  const step = currentStep(game.mission);
  if (!step) return;
  game.missionTimer = step.time || 0;
  if (step.type === 'fight') {
    const spots = [
      { x: PLACES.port.x - 120, y: PLACES.port.y - 60 },
      { x: PLACES.port.x + 40, y: PLACES.port.y - 100 },
      { x: PLACES.port.x + 120, y: PLACES.port.y + 40 },
      { x: PLACES.port.x - 40, y: PLACES.port.y + 110 },
    ];
    game.enemies = spots.map((s) => createEnemy(s.x, s.y, game.rng));
    game.mission.enemies = game.enemies;
  }
  if (step.type === 'chase') {
    const car = createCar('sport', PLACES.plaza.x + 60, PLACES.plaza.y, 0, game.rng);
    car.color = '#c0392b';
    car.driver = 'chase';
    car.ai = { horizontal: true, road: PLACES.plaza.y, dir: 1, lane: -22, speed: 300, targetSpeed: 300, stopped: 0 };
    game.cars.push(car);
    game.mission.targetCar = car;
    showBanner(game, 'The red coupe is running — chase it!', 3);
  }
  if (step.type === 'escape' && !step.safehouse) {
    addWanted(game, 3);
    showBanner(game, 'The police are onto you — lose them!', 3);
  }
  if (step.type === 'escape' && step.safehouse) {
    addWanted(game, 4);
    showBanner(game, 'Grabbed the bag! Get to the Safehouse!', 3);
  }
  game.missionTarget = missionTarget(game.mission);
  game.objectiveLabel = missionObjectiveLabel(game.mission);
}

function advanceStep(game) {
  const mission = currentMission(game.mission);
  if (!mission) return;
  game.mission.step += 1;
  game.mission.chaseTime = 0;
  game.missionTimer = 0;
  if (game.mission.step >= mission.steps.length) {
    // Mission complete.
    game.money += mission.reward;
    game.sound.cash();
    showBanner(game, `Mission complete! +${mission.reward}`, 4);
    if (mission.outro) startDialog(game, mission.outro);
    game.mission.index += 1;
    game.mission.step = 0;
    game.mission.started = false;
    if (game.mission.index >= MISSION_COUNT) {
      game.mission.done = true;
      game.screen = 'complete';
      saveGame(game);
      return;
    }
    game.objectiveLabel = missionObjectiveLabel(game.mission);
    saveGame(game);
    return;
  }
  showBanner(game, 'Objective updated', 2);
  setupStep(game);
}

function updateMission(game, dt) {
  const mission = currentMission(game.mission);
  if (!mission) return;
  if (!game.mission.started) {
    startMission(game);
    return;
  }
  const step = currentStep(game.mission);
  if (!step) return;
  const p = game.player;

  if (step.type === 'goto' || step.type === 'drive') {
    if (step.type === 'drive' && p.onFoot) return;
    if (dist(p.x, p.y, step.x, step.y) < 70) advanceStep(game);
  } else if (step.type === 'talk' || step.type === 'pickup') {
    if (dist(p.x, p.y, step.x, step.y) < 200) {
      game.prompt = `${step.type === 'talk' ? 'Talk to Rosa' : 'Pick up'} — press E`;
    }
    if (dist(p.x, p.y, step.x, step.y) < 70 && game.pressed.has('KeyE')) {
      game.pressed.delete('KeyE');
      if (step.type === 'pickup') game.sound.pickup();
      advanceStep(game);
    }
  } else if (step.type === 'steal') {
    // Complete when the player gets into a car (see enterCar), or at once
    // when they are already driving as the step becomes active.
    if (!p.onFoot) advanceStep(game);
  } else if (step.type === 'deliver') {
    game.missionTimer -= dt;
    if (dist(p.x, p.y, step.x, step.y) < 70) {
      advanceStep(game);
    } else if (game.missionTimer <= 0) {
      showBanner(game, 'Too slow! The package run resets.', 3);
      game.missionTimer = step.time;
    }
  } else if (step.type === 'chase') {
    const target = game.mission.targetCar;
    if (target) {
      const d = dist(p.x, p.y, target.x, target.y);
      if (d < 140) game.mission.chaseTime += dt;
      else game.mission.chaseTime = Math.max(0, game.mission.chaseTime - dt * 0.5);
      if (game.mission.chaseTime >= 3) {
        // The coupe gives up; remove it from the chase.
        game.cars = game.cars.filter((c) => c !== target);
        game.mission.targetCar = null;
        advanceStep(game);
      }
    }
  } else if (step.type === 'fight') {
    if (game.enemies.length === 0) advanceStep(game);
  } else if (step.type === 'escape') {
    if (game.wanted <= 0.05 && (!step.safehouse || dist(p.x, p.y, PLACES.safehouse.x, PLACES.safehouse.y) < 130)) {
      advanceStep(game);
    }
  } else if (step.type === 'taxi') {
    if (game.mission.taxiDone >= step.count) advanceStep(game);
  }
  game.missionTarget = missionTarget(game.mission);
}

// ---------------------------------------------------------------------------
// Combat
// ---------------------------------------------------------------------------

function shoot(game) {
  const p = game.player;
  if (p.fireCooldown > 0 || p.reloadTimer > 0) return;
  if (p.ammo <= 0) {
    p.reloadTimer = 0.9;
    game.sound.denied();
    return;
  }
  p.fireCooldown = 0.18;
  p.ammo -= 1;
  game.sound.shoot();
  const ox = p.onFoot ? p.x : p.car.x;
  const oy = p.onFoot ? p.y : p.car.y;
  const a = game.aimAngle;
  // Muzzle flash.
  spawnParticles(game.particles, ox + Math.cos(a) * 22, oy + Math.sin(a) * 22, 3, '#ffd76a', 120, 0.12, 4);
  // Hitscan: nearest person within a narrow cone and 520px range.
  const range = 520;
  let best = null;
  let bestAlong = range;
  const targets = [...game.enemies, ...game.cops, ...game.peds];
  for (const t of targets) {
    if (t.dead) continue;
    const dx = t.x - ox;
    const dy = t.y - oy;
    const along = dx * Math.cos(a) + dy * Math.sin(a);
    if (along < 10 || along > range) continue;
    const perp = Math.abs(-dx * Math.sin(a) + dy * Math.cos(a));
    if (perp > (t.radius || 12) + 8) continue;
    if (along < bestAlong) {
      bestAlong = along;
      best = t;
    }
  }
  if (best) {
    spawnParticles(game.particles, best.x, best.y, 8, '#c0392b', 160, 0.4, 4);
    if (best.kind === 'enemy') {
      best.health -= 34;
      if (best.health <= 0) {
        best.dead = true;
        game.enemies = game.enemies.filter((e) => e !== best);
        game.money += 20;
        spawnParticles(game.particles, best.x, best.y, 14, '#c0392b', 220, 0.6, 5);
      }
    } else if (best.kind === 'cop') {
      best.health -= 34;
      if (best.health <= 0) {
        game.cops = game.cops.filter((c) => c !== best);
        addWanted(game, 1);
        showBanner(game, 'You took down a cop! Wanted up!', 2.5);
      }
    } else {
      // A pedestrian was hit: witnesses remember.
      game.peds = game.peds.filter((pd) => pd !== best);
      addWanted(game, 0.5);
      spawnParticles(game.particles, best.x, best.y, 10, '#c0392b', 200, 0.5, 4);
    }
  } else {
    // Miss: dust where the shot lands.
    spawnParticles(game.particles, ox + Math.cos(a) * range * 0.7, oy + Math.sin(a) * range * 0.7, 4, '#b9b3a4', 90, 0.3, 3);
  }
  // Peds nearby flee from the gunshot.
  for (const ped of game.peds) {
    if (dist(ped.x, ped.y, ox, oy) < 320) ped.flee = 1.2;
  }
}

function punch(game) {
  const p = game.player;
  if (p.punchCooldown > 0 || !p.onFoot) return;
  p.punchCooldown = 0.45;
  game.sound.punch();
  for (const t of [...game.enemies, ...game.cops, ...game.peds]) {
    if (t.dead) continue;
    if (dist(p.x, p.y, t.x, t.y) < 52) {
      const a = Math.atan2(t.y - p.y, t.x - p.x);
      t.x += Math.cos(a) * 26;
      t.y += Math.sin(a) * 26;
      if (t.kind === 'enemy') {
        t.health -= 25;
        if (t.health <= 0) {
          t.dead = true;
          game.enemies = game.enemies.filter((e) => e !== t);
          game.money += 20;
        }
      } else if (t.kind === 'cop') {
        t.health -= 25;
        if (t.health <= 0) {
          game.cops = game.cops.filter((c) => c !== t);
          addWanted(game, 1);
        }
      } else {
        game.peds = game.peds.filter((pd) => pd !== t);
        addWanted(game, 0.5);
      }
      spawnParticles(game.particles, t.x, t.y, 6, '#e8e0c8', 140, 0.3, 4);
      break;
    }
  }
}

function damagePlayer(game, amount, fromX, fromY) {
  const p = game.player;
  if (p.hurtCooldown > 0) return;
  p.hurtCooldown = 0.6;
  p.health -= amount;
  spawnParticles(game.particles, p.x, p.y, 8, '#c0392b', 180, 0.4, 4);
  if (p.health <= 0) {
    p.health = 0;
    game.screen = 'over';
    game.sound.setSiren(false);
    game.sound.setEngine(0, false);
  }
}

// ---------------------------------------------------------------------------
// Cars: entering, stealing, taxi
// ---------------------------------------------------------------------------

function enterCar(game, car) {
  const p = game.player;
  const wasParked = car.driver === null;
  if (wasParked && witnessNearby(game, car.x, car.y)) {
    addWanted(game, 1.5);
    showBanner(game, 'Witnessed! The police are coming!', 3);
  } else if (wasParked) {
    showBanner(game, 'Car taken — keep it quiet', 2);
  }
  p.onFoot = false;
  p.car = car;
  car.driver = 'player';
  car.ai = null;
  game.sound.setEngine(0.1, true);
  const step = currentStep(game.mission);
  // Only count the steal once the mission's intro has played; if the player
  // is already driving when the step becomes active, the step engine below
  // completes it instead.
  if (step && step.type === 'steal' && game.mission.started) advanceStep(game);
}

function exitCar(game) {
  const p = game.player;
  const car = p.car;
  if (!car) return;
  car.driver = null;
  car.speed = 0;
  p.onFoot = true;
  p.car = null;
  // Step out to the side of the car.
  p.x = car.x - Math.sin(car.angle) * 34;
  p.y = car.y + Math.cos(car.angle) * 34;
  p.angle = car.angle;
  game.sound.setEngine(0, false);
}

function updateTaxi(game, dt) {
  const p = game.player;
  const taxi = game.taxi;
  if (!taxi.active) {
    if (!p.onFoot && p.car && p.car.type === 'taxi') {
      game.prompt = 'Press T to start a taxi fare';
      if (game.pressed.has('KeyT')) {
        game.pressed.delete('KeyT');
        taxi.active = true;
        taxi.stage = 'pickup';
        const spot = randomRoadPoint(game.rng, p, 500);
        taxi.target = { x: spot.x, y: spot.y };
        taxi.fare = 0;
        showBanner(game, 'Fare started — pick up the passenger', 2.5);
      }
    }
    return;
  }
  if (p.onFoot || !p.car || p.car.type !== 'taxi') {
    // Left the cab mid-fare: the fare is lost.
    taxi.active = false;
    taxi.target = null;
    showBanner(game, 'Fare cancelled — you left the cab', 2.5);
    return;
  }
  if (!taxi.target) return;
  if (dist(p.x, p.y, taxi.target.x, taxi.target.y) < 70) {
    if (taxi.stage === 'pickup') {
      taxi.stage = 'dropoff';
      const drop = randomRoadPoint(game.rng, p, 600);
      taxi.target = { x: drop.x, y: drop.y };
      taxi.fare = Math.round(dist(p.x, p.y, drop.x, drop.y) / 40) + 40;
      game.sound.pickup();
      showBanner(game, 'Passenger aboard — drive to the drop-off', 2.5);
    } else {
      game.money += taxi.fare;
      game.sound.cash();
      showBanner(game, `Fare complete! +$${taxi.fare}`, 3);
      game.mission.taxiDone += 1;
      taxi.active = false;
      taxi.target = null;
    }
  }
}

// ---------------------------------------------------------------------------
// Police / wanted
// ---------------------------------------------------------------------------

function ensurePolice(game, dt) {
  const stars = Math.floor(game.wanted);
  const wantCars = game.wanted >= 1 ? Math.min(1 + stars, 4) : 0;
  const policeCars = game.cars.filter((c) => c.driver === 'police');
  if (policeCars.length < wantCars) {
    const p = game.player;
    const spot = randomRoadPoint(game.rng, p, 550);
    const car = createPoliceCar(spot.x, spot.y, 0, game.rng);
    game.cars.push(car);
  } else if (policeCars.length > wantCars && game.wanted < 1) {
    // Wanted cleared: the chase cars peel off once far away.
    for (const car of policeCars) {
      if (dist(car.x, car.y, game.player.x, game.player.y) > 900) {
        game.cars = game.cars.filter((c) => c !== car);
        break;
      }
    }
  }
  const wantCops = Math.min(stars, 3);
  if (game.cops.length < wantCops) {
    const p = game.player;
    const spot = randomRoadPoint(game.rng, p, 420);
    game.cops.push(createFootCop(spot.x, spot.y));
  } else if (game.cops.length > wantCops && game.wanted < 1) {
    game.cops.pop();
  }
}

function updateWanted(game, dt) {
  game.crimeTimer += dt;
  const p = game.player;
  let copNear = false;
  for (const car of game.cars) {
    if (car.type === 'police' && dist(car.x, car.y, p.x, p.y) < 520) { copNear = true; break; }
  }
  if (!copNear) for (const cop of game.cops) if (dist(cop.x, cop.y, p.x, p.y) < 520) { copNear = true; break; }
  const hiding = dist(p.x, p.y, PLACES.safehouse.x, PLACES.safehouse.y) < 130;
  if (game.wanted > 0 && game.crimeTimer > 6 && !copNear) {
    game.wanted = Math.max(0, game.wanted - dt * (hiding ? 0.5 : 0.12));
  }
  game.sound.setSiren(game.wanted >= 1 && copNear);
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

function updatePlaying(game, dt) {
  const p = game.player;
  game.time += dt;
  game.hour += dt * (24 / 720); // a full day takes 12 minutes
  if (game.hour >= 24) game.hour -= 24;
  game.crimeTimer += dt;
  p.fireCooldown = Math.max(0, p.fireCooldown - dt);
  p.punchCooldown = Math.max(0, p.punchCooldown - dt);
  p.hurtCooldown = Math.max(0, p.hurtCooldown - dt);
  if (p.reloadTimer > 0) {
    p.reloadTimer -= dt;
    if (p.reloadTimer <= 0) {
      p.ammo = 12;
      game.sound.click();
    }
  }
  if (game.bannerTimer > 0) game.bannerTimer -= dt;

  // Aim follows the mouse.
  const mouseWorld = screenToWorld(game, game.mouse.x, game.mouse.y);
  if (game.mouse.moved) game.aimAngle = Math.atan2(mouseWorld.y - p.y, mouseWorld.x - p.x);

  // --- Player movement ---
  let mx = 0;
  let my = 0;
  if (game.keys.has('KeyW') || game.keys.has('ArrowUp')) my -= 1;
  if (game.keys.has('KeyS') || game.keys.has('ArrowDown')) my += 1;
  if (game.keys.has('KeyA') || game.keys.has('ArrowLeft')) mx -= 1;
  if (game.keys.has('KeyD') || game.keys.has('ArrowRight')) mx += 1;
  const moving = mx !== 0 || my !== 0;

  if (p.onFoot) {
    const sprint = game.keys.has('ShiftLeft') || game.keys.has('ShiftRight');
    const speed = sprint ? 265 : 190;
    if (moving) {
      const len = Math.hypot(mx, my);
      p.x += (mx / len) * speed * dt;
      p.y += (my / len) * speed * dt;
      p.walkPhase += dt * 10;
      p.moving = true;
      if (Math.random() < dt * 6) spawnParticles(game.particles, p.x, p.y + 8, 1, '#cbb98f', 20, 0.4, 3);
    } else {
      p.moving = false;
    }
    p.x = clamp(p.x, SEA_X + 12, WORLD_W - 20);
    p.y = clamp(p.y, 20, WORLD_H - 20);
    collideBuildings(p, p.radius, game.city);
    if (!game.mouse.moved && moving) p.angle = Math.atan2(my, mx);
    else if (game.mouse.moved) p.angle = game.aimAngle;
  } else if (p.car) {
    const car = p.car;
    const steer = (game.keys.has('KeyA') || game.keys.has('ArrowLeft') ? -1 : 0)
      + (game.keys.has('KeyD') || game.keys.has('ArrowRight') ? 1 : 0);
    const throttle = (game.keys.has('KeyW') || game.keys.has('ArrowUp') ? 1 : 0)
      + (game.keys.has('KeyS') || game.keys.has('ArrowDown') ? -1 : 0);
    car.brakeLight = throttle < 0 || (throttle === 0 && Math.abs(car.speed) > 60);
    const result = driveCar(car, steer, throttle, dt, game.city, game.cars);
    if (result === 'crash') {
      game.sound.crash();
      spawnParticles(game.particles, car.x, car.y, 12, '#888', 160, 0.5, 5);
      spawnParticles(game.particles, car.x, car.y, 6, '#ffb347', 200, 0.3, 4);
    }
    p.x = car.x;
    p.y = car.y;
    p.angle = car.angle;
    if (Math.abs(car.speed) > 60 && Math.random() < dt * 8) {
      spawnParticles(game.particles, car.x - Math.cos(car.angle) * 20, car.y - Math.sin(car.angle) * 20, 1, '#b9b3a4', 30, 0.5, 4);
    }
    game.sound.setEngine(Math.abs(car.speed) / car.top, true);
  }

  // --- Interact (E) ---
  if (game.pressed.has('KeyE')) {
    if (!p.onFoot) {
      game.pressed.delete('KeyE');
      exitCar(game);
    } else {
      const car = nearestCar(game, p.x, p.y, 62);
      if (car && car.driver === null) {
        game.pressed.delete('KeyE');
        enterCar(game, car);
      }
      // Otherwise leave KeyE in `pressed`: a mission talk/pickup step
      // later in this same frame may still consume it.
    }
  }
  // Prompts are rebuilt every frame below (mission, taxi, car sections),
  // so clear last frame's prompt first.
  game.prompt = '';
  // Prompt text when a parked car is near.
  if (p.onFoot) {
    const car = nearestCar(game, p.x, p.y, 62);
    if (car && car.driver === null) game.prompt = 'Press E to get in the car';
  } else {
    game.prompt = 'Press E to get out';
  }

  // --- Combat input ---
  if (game.pressed.has('KeyF')) {
    game.pressed.delete('KeyF');
    punch(game);
  }
  if (game.pressed.has('KeyR')) {
    game.pressed.delete('KeyR');
    if (p.ammo < 12 && p.reloadTimer <= 0) p.reloadTimer = 0.9;
  }
  if (game.mouse.down) shoot(game);

  // --- Traffic, pedestrians, police, enemies ---
  for (const car of [...game.cars]) {
    if (car.driver === 'traffic') updateTrafficCar(car, dt, game.cars, game.rng);
    else if (car.driver === 'chase') updateTrafficCar(car, dt, game.cars, game.rng);
    else if (car.driver === 'police') updatePoliceCar(car, p, dt, game.city, game.cars);
    else if (car.driver === 'patrol') updateTrafficCar(car, dt, game.cars, game.rng);
  }
  // Keep traffic topped up.
  const trafficCount = game.cars.filter((c) => c.driver === 'traffic').length;
  if (trafficCount < 20) game.cars.push(spawnTrafficCar(game.city, game.rng));
  if (game.peds.length < 32) game.peds.push(createPed(0, 0, game.rng));

  const shooting = p.fireCooldown > 0.15;
  for (const ped of game.peds) updatePed(ped, dt, p.x, p.y, shooting);
  ensurePolice(game, dt);
  for (const cop of [...game.cops]) {
    updateFootCop(cop, p, dt, game.wanted, (shooter) => {
      game.sound.shoot();
      spawnParticles(game.particles, shooter.x, shooter.y, 2, '#ffd76a', 100, 0.1, 3);
      if (dist(shooter.x, shooter.y, p.x, p.y) < 380) damagePlayer(game, 6, shooter.x, shooter.y);
    });
    // Foot cop grabs the player at close range.
    if (dist(cop.x, cop.y, p.x, p.y) < 30) damagePlayer(game, 8, cop.x, cop.y);
  }
  for (const car of game.cars) {
    if (car.driver === 'police' && dist(car.x, car.y, p.x, p.y) < 60 && Math.abs(car.speed) > 120) {
      damagePlayer(game, 10, car.x, car.y);
      game.sound.crash();
    }
  }
  for (const enemy of [...game.enemies]) {
    updateEnemy(enemy, p, dt, (shooter) => {
      game.sound.shoot();
      spawnParticles(game.particles, shooter.x, shooter.y, 2, '#ffd76a', 100, 0.1, 3);
      if (dist(shooter.x, shooter.y, p.x, p.y) < 420) damagePlayer(game, 5, shooter.x, shooter.y);
    });
  }

  // --- Coins ---
  for (const coin of game.city.coins) {
    if (!coin.taken && dist(p.x, p.y, coin.x, coin.y) < 28) {
      coin.taken = true;
      game.coinsTaken += 1;
      game.money += 25;
      game.sound.coin();
      spawnParticles(game.particles, coin.x, coin.y, 10, '#f7c948', 150, 0.5, 4);
      showBanner(game, `Coin ${game.coinsTaken}/24  +$25`, 1.5);
    }
  }

  // --- Health regen when calm ---
  if (game.wanted < 0.05 && p.hurtCooldown <= 0 && p.health > 0 && p.health < p.maxHealth) {
    p.health = Math.min(p.maxHealth, p.health + dt * 3);
  }

  updateWanted(game, dt);
  updateTaxi(game, dt);
  updateMission(game, dt);
  updateParticles(game.particles, dt);

  // Prompt housekeeping: the mission, taxi and car sections above each set
  // `game.prompt` when their action is available; clear it when none is.
  if (!game.prompt) {
    if (p.onFoot) {
      const car = nearestCar(game, p.x, p.y, 62);
      if (car && car.driver === null) game.prompt = 'Press E to get in the car';
    } else {
      game.prompt = 'Press E to get out';
    }
  }

  // --- Camera ---
  const targetZoom = p.onFoot ? 1.05 : 0.9;
  game.camera.zoom = lerp(game.camera.zoom, targetZoom, dt * 2);
  game.camera.x = lerp(game.camera.x, p.x, 1 - Math.pow(0.001, dt));
  game.camera.y = lerp(game.camera.y, p.y, 1 - Math.pow(0.001, dt));

  // --- Autosave ---
  game.autosaveTimer += dt;
  if (game.autosaveTimer > 20) {
    game.autosaveTimer = 0;
    saveGame(game);
  }
  game.pressed.clear();
}

function screenToWorld(game, sx, sy) {
  const zoom = game.camera.zoom;
  return {
    x: game.camera.x + (sx - game.canvas.width / 2) / zoom,
    y: game.camera.y + (sy - game.canvas.height / 2) / zoom,
  };
}

function worldToScreen(game, wx, wy) {
  const zoom = game.camera.zoom;
  return {
    x: (wx - game.camera.x) * zoom + game.canvas.width / 2,
    y: (wy - game.camera.y) * zoom + game.canvas.height / 2,
  };
}

// ---------------------------------------------------------------------------
// Menus
// ---------------------------------------------------------------------------

function titleItems(game) {
  return hasSave() ? ['new', 'continue', 'howto'] : ['new', 'howto'];
}

function menuClick(game, mx, my) {
  const w = game.canvas.width;
  const h = game.canvas.height;
  if (game.screen === 'title') {
    const items = titleItems(game);
    items.forEach((item, i) => {
      const y = h / 2 + 40 + i * 46;
      if (Math.abs(my - y) < 20 && Math.abs(mx - w / 2) < 200) {
        game.menuIndex = i;
        chooseTitle(game, item);
      }
    });
  } else if (game.screen === 'paused') {
    const items = ['resume', 'save', 'howto', 'quit'];
    items.forEach((item, i) => {
      const y = h / 2 - 20 + i * 44;
      if (Math.abs(my - y) < 20 && Math.abs(mx - w / 2) < 200) {
        game.menuIndex = i;
        choosePaused(game, item);
      }
    });
  }
}

function chooseTitle(game, item) {
  game.sound.ensure();
  game.sound.click();
  if (item === 'new') {
    clearSave();
    startNewGame(game);
  } else if (item === 'continue') {
    loadSave(game);
    game.screen = 'play';
    game.sound.startMusic();
  } else if (item === 'howto') {
    game.prevScreen = 'title';
    game.screen = 'howto';
  }
}

function choosePaused(game, item) {
  game.sound.click();
  if (item === 'resume') game.screen = 'play';
  else if (item === 'save') {
    saveGame(game);
    showBanner(game, 'Game saved', 2);
  } else if (item === 'howto') {
    game.prevScreen = 'paused';
    game.screen = 'howto';
  } else if (item === 'quit') {
    saveGame(game);
    game.screen = 'title';
    game.menuIndex = 0;
  }
}

/**
 * Stage a deterministic scenario for a screenshot (?shot=): put the player
 * at a place, in or out of a car, with a mission step, wanted level and
 * time of day already set, and no dialog in the way.
 */
export function stageScenario(game, scenario) {
  game.screen = 'play';
  game.dialog = [];
  game.banner = '';
  game.bannerTimer = 0;
  game.mission = createMissionState();
  game.mission.index = scenario.mission ?? 0;
  game.mission.step = scenario.step ?? 0;
  game.mission.started = true;
  game.hour = scenario.hour ?? 10;
  game.crimeTimer = 99;
  game.player.x = scenario.x;
  game.player.y = scenario.y;
  game.player.health = 100;
  game.player.onFoot = true;
  game.player.car = null;
  game.camera.x = scenario.x;
  game.camera.y = scenario.y;
  game.camera.zoom = scenario.inCar ? 0.9 : 1.05;
  if (scenario.inCar) {
    const car = createCar(scenario.carType || 'sedan', scenario.x, scenario.y, scenario.angle ?? 0, game.rng);
    car.driver = 'player';
    game.cars.push(car);
    game.player.onFoot = false;
    game.player.car = car;
    game.player.angle = car.angle;
  }
  game.enemies = [];
  game.cops = [];
  setupStep(game);
  // Wanted is set after setupStep: an escape step raises it on its own.
  game.wanted = scenario.wanted ?? game.wanted;
  game.objectiveLabel = missionObjectiveLabel(game.mission);
  game.missionTarget = missionTarget(game.mission);
}

export function startNewGame(game) {
  game.money = 50;
  game.wanted = 0;
  game.hour = 10;
  game.coinsTaken = 0;
  for (const coin of game.city.coins) coin.taken = false;
  game.player = createPlayer(PLACES.rosaOffice.x - 120, PLACES.rosaOffice.y + 80);
  game.cops = [];
  game.enemies = [];
  game.mission = createMissionState();
  game.dialog = [];
  game.taxi = { active: false, stage: 'pickup', target: null, fare: 0 };
  game.camera.x = game.player.x;
  game.camera.y = game.player.y;
  game.screen = 'play';
  game.objectiveLabel = missionObjectiveLabel(game.mission);
  game.missionTarget = missionTarget(game.mission);
  game.sound.startMusic();
  saveGame(game);
}

function handleMenuKeys(game) {
  const items = game.screen === 'title' ? titleItems(game) : ['resume', 'save', 'howto', 'quit'];
  if (game.pressed.has('ArrowUp') || game.pressed.has('KeyW')) {
    game.pressed.delete('ArrowUp');
    game.pressed.delete('KeyW');
    game.menuIndex = (game.menuIndex - 1 + items.length) % items.length;
    game.sound.click();
  }
  if (game.pressed.has('ArrowDown') || game.pressed.has('KeyS')) {
    game.pressed.delete('ArrowDown');
    game.pressed.delete('KeyS');
    game.menuIndex = (game.menuIndex + 1) % items.length;
    game.sound.click();
  }
  if (game.pressed.has('Enter') || game.pressed.has('Space')) {
    game.pressed.delete('Enter');
    game.pressed.delete('Space');
    if (game.screen === 'title') chooseTitle(game, items[game.menuIndex]);
    else choosePaused(game, items[game.menuIndex]);
  }
  game.pressed.clear();
}

// ---------------------------------------------------------------------------
// Input wiring
// ---------------------------------------------------------------------------

export function attachInput(game) {
  const canvas = game.canvas;
  const handled = new Set([
    'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE', 'KeyF', 'KeyT', 'KeyR', 'KeyM',
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Enter', 'Escape',
    'ShiftLeft', 'ShiftRight',
  ]);
  window.addEventListener('keydown', (e) => {
    if (!handled.has(e.code)) return;
    e.preventDefault();
    game.sound.ensure();
    if (!e.repeat) game.pressed.add(e.code);
    game.keys.add(e.code);
    if (e.code === 'KeyM') {
      game.sound.setMuted(!game.sound.muted);
      showBanner(game, game.sound.muted ? 'Sound muted' : 'Sound on', 1.5);
    }
    if (e.code === 'Escape') {
      if (game.screen === 'play') {
        game.screen = 'paused';
        game.menuIndex = 0;
      } else if (game.screen === 'paused') {
        game.screen = 'play';
      } else if (game.screen === 'howto') {
        game.screen = game.prevScreen;
      }
    }
    if (e.code === 'Enter' && game.screen === 'over') {
      // Respawn at the hospital, poorer and clean.
      game.money = Math.max(0, game.money - 100);
      game.player.health = 100;
      game.player.x = PLACES.hospital.x;
      game.player.y = PLACES.hospital.y + 60;
      game.player.onFoot = true;
      if (game.player.car) {
        game.player.car.driver = null;
        game.player.car = null;
      }
      game.wanted = 0;
      game.cops = [];
      game.screen = 'play';
      saveGame(game);
    }
    if (e.code === 'Enter' && game.screen === 'complete') {
      game.screen = 'play';
    }
  });
  window.addEventListener('keyup', (e) => {
    game.keys.delete(e.code);
  });
  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    game.mouse.x = e.clientX - rect.left;
    game.mouse.y = e.clientY - rect.top;
    game.mouse.moved = true;
  });
  canvas.addEventListener('mousedown', (e) => {
    game.sound.ensure();
    if (e.button !== 0) return;
    const rect = canvas.getBoundingClientRect();
    game.mouse.x = e.clientX - rect.left;
    game.mouse.y = e.clientY - rect.top;
    if (game.screen === 'play') {
      if (game.dialog.length > 0) {
        game.dialog.shift();
      } else {
        game.mouse.down = true;
        shoot(game);
      }
    } else if (game.screen === 'title' || game.screen === 'paused') {
      menuClick(game, game.mouse.x, game.mouse.y);
    }
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) game.mouse.down = false;
  });
  // Advance dialog with E as well.
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyE' && game.screen === 'play' && game.dialog.length > 0) {
      game.dialog.shift();
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && game.screen === 'play' && !game.shotMode) {
      game.screen = 'paused';
      game.menuIndex = 0;
    }
  });
}

export function resizeCanvas(game) {
  // 1:1 with the window (devicePixelRatio 1): crisp enough for a top-down
  // canvas game, and it keeps the screenshot size exactly 1280x720.
  const w = Math.floor(window.innerWidth);
  const h = Math.floor(window.innerHeight);
  if (game.canvas.width !== w || game.canvas.height !== h) {
    game.canvas.width = w;
    game.canvas.height = h;
  }
}

// ---------------------------------------------------------------------------
// Frame
// ---------------------------------------------------------------------------

export function update(game, dt) {
  if (game.screen === 'play') {
    if (game.dialog.length > 0) {
      // Dialog pauses the world; E / click advances it (handled in input).
      updateParticles(game.particles, dt);
      game.pressed.clear();
      return;
    }
    updatePlaying(game, dt);
  } else if (game.screen === 'title') {
    // Slow cinematic pan over the city behind the title.
    game.time += dt;
    game.camera.x = 1700 + Math.cos(game.time * 0.05) * 500;
    game.camera.y = 1700 + Math.sin(game.time * 0.04) * 400;
    game.camera.zoom = 0.62;
    for (const car of game.cars) {
      if (car.driver === 'traffic' || car.driver === 'patrol') updateTrafficCar(car, dt, game.cars, game.rng);
    }
    for (const ped of game.peds) updatePed(ped, dt, 0, 0, false);
    updateParticles(game.particles, dt);
    handleMenuKeys(game);
  } else if (game.screen === 'paused') {
    handleMenuKeys(game);
  } else if (game.screen === 'howto') {
    if (game.pressed.has('Escape') || game.pressed.has('Enter')) {
      game.pressed.delete('Escape');
      game.pressed.delete('Enter');
      game.screen = game.prevScreen;
    }
    game.pressed.clear();
  }
  // 'over' and 'complete' wait for Enter (handled in the keydown listener).
}

export function render(game) {
  const ctx = game.ctx;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  drawWorld(ctx, game, game.screen, game.time);
  if (game.screen === 'play') {
    drawHud(ctx, game);
    drawDialog(ctx, game);
  } else if (game.screen === 'title') {
    drawTitle(ctx, game, hasSave());
  } else if (game.screen === 'howto') {
    drawHowTo(ctx, game);
  } else if (game.screen === 'paused') {
    drawHud(ctx, game);
    drawPaused(ctx, game);
  } else if (game.screen === 'over') {
    drawGameOver(ctx, game);
  } else if (game.screen === 'complete') {
    drawHud(ctx, game);
    drawStoryComplete(ctx, game);
  }
}

export { MISSION_COUNT };
