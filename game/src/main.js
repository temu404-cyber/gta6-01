// Boot and the one loop for Solmar Bay: input is read every frame, the world
// advances in fixed 1/60 s steps, and the renderer paints what is there.
//
// ?seed=N fixes the city and the traffic. ?shot=start|drive|chase|mission|night
// (with &seed=N) stages that scene instead of running the loop, plays it
// forward a few seconds with a scripted driver, paints it twice and sets
// window.__shotReady for a screenshot.
import { createGame, attachInput, resizeCanvas, update, render, hasSave, startNewGame, stageScenario } from './game.js';
import { createPoliceCar } from './entities.js';
import { PLACES } from './world.js';

const STEP = 1 / 60;
const MAX_FRAME = 0.25;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : Math.floor(Math.random() * 4294967296);

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const game = createGame(canvas, seed);
attachInput(game);
resizeCanvas(game);
// Exposed for debugging and automated play-testing only.
window.__game = game;
window.addEventListener('resize', () => resizeCanvas(game));

function announce(message) {
  status.textContent = message;
}

/** Step the world N fixed steps with a set of held keys. */
function simulate(seconds, keys) {
  game.keys = new Set(keys);
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i += 1) update(game, STEP);
  game.keys = new Set();
}

/** Set `game` to the named screenshot scene and paint it. */
function runShot(name) {
  game.shotMode = true;
  if (name === 'start') {
    // Title screen over the live city: let the cinematic pan run a while.
    game.screen = 'title';
    simulate(9, []);
  } else if (name === 'drive') {
    // Dana in a sport coupe on the downtown grid, traffic all around.
    startNewGame(game);
    game.dialog = [];
    stageScenario(game, {
      mission: 1, step: 1, hour: 15,
      x: 1100, y: 1500, angle: 0, inCar: true, carType: 'sport',
    });
    game.dialog = [];
    simulate(2.2, ['KeyW']);
  } else if (name === 'chase') {
    // Wanted 3, police cars closing in on a downtown avenue.
    startNewGame(game);
    game.dialog = [];
    stageScenario(game, {
      mission: 5, step: 0, hour: 17.5, wanted: 3,
      x: 1100, y: 1500, angle: 0, inCar: true, carType: 'sedan',
    });
    game.dialog = [];
    // Two patrol cars already in frame: one on the player's tail, one
    // cutting in from the cross street ahead.
    game.cars.push(createPoliceCar(880, 1522, 0, game.rng));
    game.cars.push(createPoliceCar(1900, 1240, Math.PI / 2, game.rng));
    simulate(3, ['KeyW']);
  } else if (name === 'mission') {
    // Dockside shootout: mission 5, armed crew at the harbor, HUD live.
    startNewGame(game);
    game.dialog = [];
    stageScenario(game, {
      mission: 4, step: 1, hour: 15.5,
      x: PLACES.port.x - 220, y: PLACES.port.y - 140,
    });
    game.dialog = [];
    // Face the docks and let the enemies take their positions.
    game.mouse.moved = true;
    game.mouse.x = game.canvas.width / 2 + 220;
    game.mouse.y = game.canvas.height / 2 + 60;
    simulate(2.5, []);
  } else if (name === 'night') {
    // Night in the plaza: lamps on, streets quiet, Dana on foot.
    startNewGame(game);
    game.dialog = [];
    stageScenario(game, {
      mission: 0, step: 0, hour: 22.5,
      x: PLACES.plaza.x, y: PLACES.plaza.y + 120,
    });
    game.dialog = [];
    simulate(2, ['KeyW']);
  } else {
    game.screen = 'title';
    simulate(9, []);
  }
  let painted = 0;
  function paint() {
    render(game);
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

function runGame() {
  let accumulator = 0;
  let last = performance.now();

  function frame(now) {
    requestAnimationFrame(frame);
    accumulator += Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    while (accumulator >= STEP) {
      update(game, STEP);
      accumulator -= STEP;
    }
    render(game);
  }

  announce('Solmar Bay. Press Enter or click New Game to start.');
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
