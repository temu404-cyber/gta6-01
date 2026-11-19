// Shared math and deterministic random helpers for Solmar Bay.
// Every random choice in the game flows through mulberry32, so a seed
// always rebuilds the same city, traffic and screenshot scenes.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Small stateful RNG with the helpers the world and entity code need. */
export class Rng {
  constructor(seed) {
    this.next = mulberry32(seed);
  }
  /** Float in [0, 1). */
  f() {
    return this.next();
  }
  /** Float in [min, max). */
  range(min, max) {
    return min + this.next() * (max - min);
  }
  /** Integer in [min, max] inclusive. */
  int(min, max) {
    return min + Math.floor(this.next() * (max - min + 1));
  }
  /** One element of a non-empty array. */
  pick(list) {
    return list[Math.floor(this.next() * list.length)];
  }
  /** True with probability p. */
  chance(p) {
    return this.next() < p;
  }
}

export function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Shortest signed difference between two angles, in (-PI, PI]. */
export function angleDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

export function dist(x1, y1, x2, y2) {
  return Math.hypot(x2 - x1, y2 - y1);
}

export function dist2(x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return dx * dx + dy * dy;
}

/** True when circle (cx, cy, r) overlaps axis-aligned rect {x, y, w, h}. */
export function circleHitsRect(cx, cy, r, rect) {
  const nx = clamp(cx, rect.x, rect.x + rect.w);
  const ny = clamp(cy, rect.y, rect.y + rect.h);
  const dx = cx - nx;
  const dy = cy - ny;
  return dx * dx + dy * dy < r * r;
}

/** Push a circle out of a rect; returns true when a collision happened. */
export function pushCircleOutOfRect(body, r, rect) {
  const nx = clamp(body.x, rect.x, rect.x + rect.w);
  const ny = clamp(body.y, rect.y, rect.y + rect.h);
  let dx = body.x - nx;
  let dy = body.y - ny;
  let d2 = dx * dx + dy * dy;
  if (d2 >= r * r) return false;
  if (d2 < 0.0001) {
    // Centre inside the rect: push out along the smallest penetration axis.
    const left = body.x - rect.x;
    const right = rect.x + rect.w - body.x;
    const top = body.y - rect.y;
    const bottom = rect.y + rect.h - body.y;
    const m = Math.min(left, right, top, bottom);
    if (m === left) body.x = rect.x - r;
    else if (m === right) body.x = rect.x + rect.w + r;
    else if (m === top) body.y = rect.y - r;
    else body.y = rect.y + rect.h + r;
    return true;
  }
  const d = Math.sqrt(d2);
  dx /= d;
  dy /= d;
  body.x = nx + dx * r;
  body.y = ny + dy * r;
  return true;
}

/** Format a game clock hour (0..24) as "14:05". */
export function formatClock(hours) {
  const h = Math.floor(hours) % 24;
  const m = Math.floor((hours % 1) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Format dollars with a thousands separator, e.g. 1234 -> "$1,234". */
export function formatMoney(n) {
  return `$${Math.floor(n).toLocaleString('en-US')}`;
}
