// Solmar Bay: the city itself. A fixed road grid over a 3600x3600 world,
// four districts (beach, downtown, port, suburb), a central park, and the
// named places the story uses. Generation is seeded, so every seed builds
// the same city; buildings double as collision rectangles.
import { Rng, clamp, pushCircleOutOfRect } from './util.js';

export const WORLD_W = 3600;
export const WORLD_H = 3600;
export const ROAD_W = 96;
export const HALF_ROAD = ROAD_W / 2;
/** Road centre lines, both axes: 8 vertical and 8 horizontal streets. */
export const ROADS = [300, 700, 1100, 1500, 1900, 2300, 2700, 3100];
/** The sea starts west of this x; the sand strip runs to the first road. */
export const SEA_X = 150;
export const BEACH_X = 300;

/** Named places the missions and the HUD point at. */
export const PLACES = {
  rosaOffice: { x: 1180, y: 1240, label: "Rosa's Office" },
  safehouse: { x: 640, y: 640, label: 'Safehouse' },
  chopShop: { x: 2860, y: 2840, label: 'Chop Shop' },
  port: { x: 2920, y: 3320, label: 'Harbor Docks' },
  bank: { x: 2140, y: 1680, label: 'Bay Trust Bank' },
  hospital: { x: 640, y: 2460, label: 'St. Marina Hospital' },
  marina: { x: 420, y: 2900, label: 'Marina' },
  market: { x: 1680, y: 2500, label: 'Night Market' },
  plaza: { x: 1700, y: 1700, label: 'Solmar Plaza' },
};

const DOWNTOWN_COLORS = ['#7d8aa0', '#5f748f', '#8a97a8', '#6b7d94', '#94a3b5', '#54687f'];
const SUBURB_COLORS = ['#d9a06b', '#c98f7a', '#b7c4a8', '#d3b48a', '#a8b8c4', '#c4a29a'];
const PORT_COLORS = ['#8a7f74', '#7a6f66', '#96887c', '#6f7a72'];
const ROOF_COLORS = ['#3d4a5c', '#54423a', '#5c6650', '#6e3f3f', '#41566b'];

/** Which district a point belongs to: beach, downtown, port or suburb. */
export function districtAt(x, y) {
  if (x < BEACH_X) return 'beach';
  if (y > 3100 && x > 2300) return 'port';
  if (x >= 1100 && x <= 2300 && y >= 1100 && y <= 2300) return 'downtown';
  return 'suburb';
}

/** True when the point is on a road (asphalt), including intersections. */
export function isOnRoad(x, y) {
  for (const r of ROADS) {
    if (Math.abs(x - r) < HALF_ROAD || Math.abs(y - r) < HALF_ROAD) return true;
  }
  return false;
}

/** True when the point is in the sea (west strip). */
export function isInSea(x, y) {
  return x < SEA_X;
}

/** Nearest point on a road centre line, for snapping traffic and spawns. */
export function nearestRoadPoint(x, y) {
  let best = null;
  let bestD = Infinity;
  for (const r of ROADS) {
    const d1 = Math.abs(x - r);
    if (d1 < bestD) {
      bestD = d1;
      best = { x: r, y: clamp(y, 0, WORLD_H), axis: 'v' };
    }
    const d2 = Math.abs(y - r);
    if (d2 < bestD) {
      bestD = d2;
      best = { x: clamp(x, 0, WORLD_W), y: r, axis: 'h' };
    }
  }
  return best;
}

/**
 * Build the city for a seed: buildings (with collision rects), palm trees,
 * street lamps, park features and the 24 collectible coins.
 */
export function createCity(seed) {
  const rng = new Rng(seed);
  const buildings = [];
  const trees = [];
  const lamps = [];
  const coins = [];

  // One building per block cell, sometimes two; the central block is a park.
  for (let bi = 0; bi < ROADS.length - 1; bi += 1) {
    for (let bj = 0; bj < ROADS.length - 1; bj += 1) {
      const x0 = ROADS[bi] + HALF_ROAD + 14;
      const x1 = ROADS[bi + 1] - HALF_ROAD - 14;
      const y0 = ROADS[bj] + HALF_ROAD + 14;
      const y1 = ROADS[bj + 1] - HALF_ROAD - 14;
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;
      // Central plaza block: a park with paths and trees, no buildings.
      if (bi === 3 && bj === 3) {
        for (let t = 0; t < 26; t += 1) {
          trees.push({
            x: rng.range(x0 + 20, x1 - 20),
            y: rng.range(y0 + 20, y1 - 20),
            r: rng.range(10, 18),
            palm: rng.chance(0.5),
          });
        }
        continue;
      }
      const district = districtAt(cx, cy);
      if (district === 'beach') continue;
      // One building per cell of a 2x2 split, so blocks read dense but the
      // buildings never overlap each other.
      const palette = district === 'downtown' ? DOWNTOWN_COLORS : district === 'port' ? PORT_COLORS : SUBURB_COLORS;
      const want = district === 'downtown' ? 4 : district === 'port' ? 2 : 3;
      const cells = [0, 1, 2, 3];
      for (let c = cells.length - 1; c > 0; c -= 1) {
        const j = Math.floor(rng.f() * (c + 1));
        [cells[c], cells[j]] = [cells[j], cells[c]];
      }
      for (let k = 0; k < want; k += 1) {
        const cell = cells[k];
        const col = cell % 2;
        const row = Math.floor(cell / 2);
        const cw = (x1 - x0) / 2;
        const ch = (y1 - y0) / 2;
        const bw = district === 'downtown' ? rng.range(70, cw - 18) : rng.range(60, cw - 18);
        const bh = district === 'downtown' ? rng.range(70, ch - 18) : rng.range(55, ch - 18);
        const bx = x0 + col * cw + rng.range(6, Math.max(7, cw - bw - 6));
        const by = y0 + row * ch + rng.range(6, Math.max(7, ch - bh - 6));
        const tall = district === 'downtown' ? rng.int(3, 9) : district === 'port' ? 1 : rng.int(1, 2);
        buildings.push({
          x: bx, y: by, w: bw, h: bh,
          color: rng.pick(palette),
          roof: rng.pick(ROOF_COLORS),
          tall, district,
        });
      }
      // A few trees on the block's edge.
      const treeCount = rng.int(0, 3);
      for (let t = 0; t < treeCount; t += 1) {
        trees.push({
          x: rng.range(x0, x1),
          y: rng.range(y0, y1),
          r: rng.range(9, 15),
          palm: district === 'beach' || rng.chance(0.35),
        });
      }
    }
  }

  // Palm-lined boardwalk along the beach.
  for (let y = 200; y < WORLD_H - 100; y += 130) {
    trees.push({ x: 215 + rng.range(-8, 8), y, r: 13, palm: true });
  }
  // Street lamps at every intersection corner.
  for (const rx of ROADS) {
    for (const ry of ROADS) {
      lamps.push({ x: rx + HALF_ROAD + 8, y: ry + HALF_ROAD + 8 });
    }
  }

  // 24 coins: scattered along sidewalks, the park, the beach and the port.
  const coinSpots = [];
  for (let i = 0; i < 24; i += 1) {
    let x;
    let y;
    if (i < 6) {
      // Beach coins.
      x = rng.range(170, 280);
      y = rng.range(300, 3300);
    } else if (i < 10) {
      // Park coins.
      x = rng.range(1560, 1840);
      y = rng.range(1560, 1840);
    } else if (i < 14) {
      // Port coins.
      x = rng.range(2400, 3350);
      y = rng.range(3150, 3450);
    } else {
      // Sidewalk coins on random roads.
      const road = rng.pick(ROADS);
      if (rng.chance(0.5)) {
        x = road + HALF_ROAD + 14;
        y = rng.range(200, 3400);
      } else {
        x = rng.range(200, 3400);
        y = road + HALF_ROAD + 14;
      }
    }
    coinSpots.push({ x, y });
  }
  for (let i = 0; i < coinSpots.length; i += 1) {
    coins.push({ id: i, x: coinSpots[i].x, y: coinSpots[i].y, taken: false });
  }

  return { buildings, trees, lamps, coins, seed };
}

/** Resolve a circle body against every building; returns true on any hit. */
export function collideBuildings(body, r, city) {
  let hit = false;
  for (const b of city.buildings) {
    // Cheap broad-phase reject before the precise test.
    if (body.x < b.x - r || body.x > b.x + b.w + r || body.y < b.y - r || body.y > b.y + b.h + r) continue;
    if (pushCircleOutOfRect(body, r, b)) hit = true;
  }
  return hit;
}
