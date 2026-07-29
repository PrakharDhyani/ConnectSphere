/**
 * Smash Karts — map definitions (server side).
 *
 * Each map is static design data: arena size, spawn points, obstacle colliders,
 * and pickup pads. The physics core (kartArena.js) reads `g.w/g.h`,
 * `g.obstacles` and `g.spawns` for collision + respawns; the client mirrors
 * these layouts in frontend/src/games/kartMaps.js purely to RENDER them (keep
 * the two in sync — including the track-generator code below, which must be
 * byte-identical on both sides so generated barrier capsules match exactly).
 *
 * Obstacle colliders come in two shapes:
 *   - circle:  { kind, x, y, r }                      (tyre stacks, rocks)
 *   - capsule: { kind, x1, y1, x2, y2, r }            (logs, barriers)
 *
 * Curvy arenas are just MORE capsules: a closed Catmull-Rom spline is sampled
 * into a polyline and every segment becomes a "barrier" capsule. The physics
 * core needs zero new concepts — a curvy track wall collides exactly like a
 * fallen log.
 *
 * Scale note: every map is ~10x the area of the original 1600×900 rectangle.
 * Layouts keep a hard rule learned the hard way: every spawn point has ≥300
 * units of clear space, and nothing sits directly in a spawn's facing line.
 *
 * Pickup types: health | rapid | speed | shield | bomb.
 */

// ── Curvy-track generation (mirrored verbatim on the client) ──

// Sample a closed Catmull-Rom spline through the control points.
function sampleClosedSpline(ctrl, per) {
  const out = [];
  const n = ctrl.length;
  for (let i = 0; i < n; i++) {
    const p0 = ctrl[(i + n - 1) % n], p1 = ctrl[i], p2 = ctrl[(i + 1) % n], p3 = ctrl[(i + 2) % n];
    for (let s = 0; s < per; s++) {
      const t = s / per, t2 = t * t, t3 = t2 * t;
      out.push({
        x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  return out;
}

// Offset every sample along its outward normal (dist < 0 → inward).
function offsetLoop(loop, dist, cx, cy) {
  const n = loop.length;
  return loop.map((p, i) => {
    const a = loop[(i + n - 1) % n], b = loop[(i + 1) % n];
    let tx = b.x - a.x, ty = b.y - a.y;
    const L = Math.hypot(tx, ty) || 1;
    let nx = -ty / L, ny = tx / L;
    if ((p.x - cx) * nx + (p.y - cy) * ny < 0) { nx = -nx; ny = -ny; }
    return { x: p.x + nx * dist, y: p.y + ny * dist };
  });
}

// Turn a closed loop into a chain of barrier capsules.
function loopCapsules(loop, r) {
  return loop.map((p, i) => {
    const q = loop[(i + 1) % loop.length];
    return { kind: "barrier", x1: p.x, y1: p.y, x2: q.x, y2: q.y, r };
  });
}

// Control points around a center: one radius per evenly-spaced angle.
function ringPoints(cx, cy, radii, yScale) {
  return radii.map((r, i) => {
    const a = (i / radii.length) * Math.PI * 2;
    return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r * yScale };
  });
}

// Six spawns for a rectangular w×h arena: corners + top/bottom midpoints.
//
// FACING MATTERS as much as position. The mid spawns used to point straight at
// the middle of the arena — directly into the horizontal barrier logs a few
// hundred units away, so those two players drove into a wall on every respawn.
// They now face ALONG the long axis, which is open. `kart.maps.test.js` drives
// every spawn for 3s to keep this honest.
function rectSpawns(w, h) {
  return [
    { x: 480, y: 450, angle: 0.4 },
    { x: w - 480, y: 450, angle: Math.PI - 0.4 },
    { x: 480, y: h - 450, angle: -0.4 },
    { x: w - 480, y: h - 450, angle: Math.PI + 0.4 },
    { x: w / 2, y: 320, angle: 0 },
    { x: w / 2, y: h - 320, angle: Math.PI },
  ];
}

// Grand Circuit — a closed curvy racing ring (7600×4800 world). The varied
// radii give it sweepers, pinches and S-ish transitions; the track is the
// ±230 offset band around the centerline (twice the original width), with a
// tyre-slalom alternating sides along the lap.
const CIRCUIT = (() => {
  const cx = 3800, cy = 2400;
  const center = sampleClosedSpline(
    ringPoints(cx, cy, [1650, 1950, 1430, 2050, 1790, 1500, 2080, 1660, 1370, 1920], 0.78),
    8
  );
  const HALF = 230;
  const outer = offsetLoop(center, HALF, cx, cy);
  const inner = offsetLoop(center, -HALF, cx, cy);
  const N = center.length;
  // Outward normal at sample i (same convention as offsetLoop).
  const nrm = (i) => {
    const a = center[(i + N - 1) % N], b = center[(i + 1) % N];
    let tx = b.x - a.x, ty = b.y - a.y;
    const L = Math.hypot(tx, ty) || 1;
    let nx = -ty / L, ny = tx / L;
    if ((center[i].x - cx) * nx + (center[i].y - cy) * ny < 0) { nx = -nx; ny = -ny; }
    return { nx, ny };
  };
  const spawns = [0, 13, 27, 40, 53, 67].map((i) => {
    const p = center[i], q = center[(i + 1) % N];
    return { x: p.x, y: p.y, angle: Math.atan2(q.y - p.y, q.x - p.x) };
  });
  // Tyre-stack slalom: alternating sides of the track, clear of spawns/pads.
  const obstacles = [4, 10, 17, 24, 30, 37, 44, 50, 57, 64, 70, 77].map((i, k) => {
    const { nx, ny } = nrm(i);
    const side = k % 2 === 0 ? 0.5 : -0.5;
    return { kind: "tyre", x: center[i].x + nx * HALF * side, y: center[i].y + ny * HALF * side, r: 38 };
  });
  const types = [
    "speed", "shotgun", "health", "triple", "shield", "mine",
    "laser", "bomb", "speed", "freeze", "health", "homing",
    "spikes", "oil", "health", "ghost",
  ];
  const pickups = [5, 11, 17, 22, 28, 33, 39, 44, 50, 55, 61, 66, 71, 75, 79, 2].map((i, k) => ({
    id: k, x: center[i].x, y: center[i].y, type: types[k],
  }));
  return { center, outer, inner, spawns, obstacles, pickups };
})();

// Canyon — a big open curvy blob (6400×4200 world): one winding boundary,
// mesas/rocks and ridges inside, pickups in two rings.
const CANYON = (() => {
  const cx = 3200, cy = 2100;
  const boundary = sampleClosedSpline(
    ringPoints(cx, cy, [1790, 2020, 1540, 2240, 2050, 1660, 2210, 1790, 1500], 0.75),
    8
  );
  const spawns = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.26;
    spawns.push({ x: cx + Math.cos(a) * 960, y: cy + Math.sin(a) * 960 * 0.75, angle: a + Math.PI / 2 });
  }
  const outerTypes = ["speed", "health", "shotgun", "shield", "health", "bomb", "laser", "spikes"];
  const innerTypes = ["triple", "homing", "mine", "freeze", "oil", "health", "ghost", "rapid"];
  const pickups = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    pickups.push({ id: i, x: cx + Math.cos(a) * 1400, y: cy + Math.sin(a) * 1400 * 0.75, type: outerTypes[i] });
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.4;
    pickups.push({ id: 8 + i, x: cx + Math.cos(a) * 700, y: cy + Math.sin(a) * 700 * 0.75, type: innerTypes[i] });
  }
  return { boundary, spawns, pickups };
})();

export const MAPS = {
  speedway: {
    id: "speedway",
    name: "Speedway",
    theme: "speedway",
    w: 5200,
    h: 2900,
    spawns: rectSpawns(5200, 2900),
    obstacles: [
      // Central chicane block.
      { kind: "tyre", x: 2600, y: 1450, r: 55 },
      { kind: "tyre", x: 2100, y: 950, r: 48 },
      { kind: "tyre", x: 3100, y: 950, r: 48 },
      { kind: "tyre", x: 2100, y: 1950, r: 48 },
      { kind: "tyre", x: 3100, y: 1950, r: 48 },
      { kind: "log", x1: 2250, y1: 800, x2: 2950, y2: 800, r: 24 },
      { kind: "log", x1: 2250, y1: 2100, x2: 2950, y2: 2100, r: 24 },
      { kind: "log", x1: 1300, y1: 1200, x2: 1300, y2: 1700, r: 24 },
      { kind: "log", x1: 3900, y1: 1200, x2: 3900, y2: 1700, r: 24 },
      // Side zones.
      { kind: "tyre", x: 900, y: 700, r: 40 },
      { kind: "tyre", x: 900, y: 2200, r: 40 },
      { kind: "log", x1: 700, y1: 1450, x2: 1100, y2: 1450, r: 20 },
      { kind: "tyre", x: 4300, y: 700, r: 40 },
      { kind: "tyre", x: 4300, y: 2200, r: 40 },
      { kind: "log", x1: 4100, y1: 1450, x2: 4500, y2: 1450, r: 20 },
      // Mid-lane markers.
      { kind: "tyre", x: 1800, y: 1450, r: 36 },
      { kind: "tyre", x: 3400, y: 1450, r: 36 },
    ],
    pickups: [
      { id: 0, x: 2000, y: 350, type: "speed" },
      { id: 1, x: 3200, y: 2550, type: "speed" },
      { id: 2, x: 600, y: 1450, type: "shield" },
      { id: 3, x: 4600, y: 1450, type: "shield" },
      { id: 4, x: 1500, y: 700, type: "health" },
      { id: 5, x: 3700, y: 700, type: "health" },
      { id: 6, x: 1500, y: 2200, type: "health" },
      { id: 7, x: 3700, y: 2200, type: "health" },
      { id: 8, x: 1800, y: 1000, type: "rapid" },
      { id: 9, x: 3400, y: 1900, type: "rapid" },
      { id: 10, x: 2600, y: 950, type: "bomb" },
      { id: 11, x: 2600, y: 1950, type: "bomb" },
      { id: 12, x: 1800, y: 1900, type: "triple" },
      { id: 13, x: 3400, y: 1000, type: "triple" },
      { id: 14, x: 1100, y: 1450, type: "mine" },
      { id: 15, x: 4100, y: 1450, type: "mine" },
      { id: 16, x: 2600, y: 600, type: "freeze" },
      { id: 17, x: 2600, y: 2300, type: "freeze" },
      { id: 18, x: 1500, y: 1450, type: "shotgun" },
      { id: 19, x: 3700, y: 1450, type: "shotgun" },
      { id: 20, x: 2200, y: 1450, type: "laser" },
      { id: 21, x: 3000, y: 1450, type: "homing" },
      { id: 22, x: 900, y: 1100, type: "spikes" },
      { id: 23, x: 4300, y: 1800, type: "spikes" },
      { id: 24, x: 900, y: 1800, type: "oil" },
      { id: 25, x: 4300, y: 1100, type: "oil" },
      { id: 26, x: 2000, y: 700, type: "ghost" },
      { id: 27, x: 3200, y: 2200, type: "ghost" },
    ],
  },

  forest: {
    id: "forest",
    name: "Forest",
    theme: "forest",
    w: 5200,
    h: 2900,
    spawns: rectSpawns(5200, 2900),
    obstacles: [
      // Fallen logs, scattered organically.
      { kind: "log", x1: 1625, y1: 810, x2: 2440, y2: 650, r: 26 },
      { kind: "log", x1: 2925, y1: 2275, x2: 3740, y2: 2110, r: 26 },
      { kind: "log", x1: 3575, y1: 845, x2: 4060, y2: 1300, r: 26 },
      { kind: "log", x1: 1140, y1: 1950, x2: 1690, y2: 2275, r: 26 },
      { kind: "log", x1: 700, y1: 700, x2: 1200, y2: 900, r: 24 },
      { kind: "log", x1: 4000, y1: 2000, x2: 4500, y2: 2200, r: 24 },
      // Boulders.
      { kind: "tyre", x: 2600, y: 1450, r: 60 },
      { kind: "tyre", x: 1690, y: 1450, r: 45 },
      { kind: "tyre", x: 3510, y: 1450, r: 45 },
      { kind: "tyre", x: 2145, y: 2080, r: 42 },
      { kind: "tyre", x: 3090, y: 845, r: 42 },
      { kind: "tyre", x: 900, y: 2300, r: 38 },
      { kind: "tyre", x: 4300, y: 600, r: 38 },
      { kind: "tyre", x: 2300, y: 700, r: 34 },
      { kind: "tyre", x: 2900, y: 2200, r: 34 },
    ],
    pickups: [
      { id: 0, x: 2000, y: 400, type: "speed" },
      { id: 1, x: 3200, y: 2500, type: "speed" },
      { id: 2, x: 500, y: 1450, type: "shield" },
      { id: 3, x: 4700, y: 1450, type: "shield" },
      { id: 4, x: 800, y: 800, type: "health" },
      { id: 5, x: 4400, y: 800, type: "health" },
      { id: 6, x: 800, y: 2100, type: "health" },
      { id: 7, x: 4400, y: 2100, type: "health" },
      { id: 8, x: 2000, y: 1450, type: "rapid" },
      { id: 9, x: 3200, y: 1450, type: "rapid" },
      { id: 10, x: 1300, y: 600, type: "bomb" },
      { id: 11, x: 3900, y: 2300, type: "bomb" },
      { id: 12, x: 1300, y: 2300, type: "triple" },
      { id: 13, x: 3900, y: 600, type: "triple" },
      { id: 14, x: 2600, y: 600, type: "mine" },
      { id: 15, x: 2600, y: 2300, type: "mine" },
      { id: 16, x: 1700, y: 1450, type: "freeze" },
      { id: 17, x: 3500, y: 1450, type: "freeze" },
      { id: 18, x: 1150, y: 1450, type: "shotgun" },
      { id: 19, x: 4050, y: 1450, type: "shotgun" },
      { id: 20, x: 2350, y: 1000, type: "laser" },
      { id: 21, x: 2850, y: 1900, type: "homing" },
      { id: 22, x: 700, y: 1450, type: "spikes" },
      { id: 23, x: 4500, y: 1450, type: "spikes" },
      { id: 24, x: 1600, y: 700, type: "oil" },
      { id: 25, x: 3600, y: 2200, type: "oil" },
      { id: 26, x: 3600, y: 700, type: "ghost" },
      { id: 27, x: 1600, y: 2200, type: "ghost" },
    ],
  },

  volcano: {
    id: "volcano",
    name: "Volcano",
    theme: "volcano",
    w: 5200,
    h: 2900,
    spawns: rectSpawns(5200, 2900),
    obstacles: [
      // Central boulder + satellite rocks.
      { kind: "tyre", x: 2600, y: 1450, r: 75 },
      { kind: "tyre", x: 1560, y: 845, r: 50 },
      { kind: "tyre", x: 3640, y: 2080, r: 50 },
      { kind: "tyre", x: 3640, y: 845, r: 45 },
      { kind: "tyre", x: 1560, y: 2080, r: 45 },
      { kind: "tyre", x: 700, y: 1450, r: 40 },
      { kind: "tyre", x: 4500, y: 1450, r: 40 },
      { kind: "tyre", x: 2300, y: 600, r: 40 },
      { kind: "tyre", x: 2900, y: 2300, r: 40 },
      // Basalt ridges.
      { kind: "log", x1: 2080, y1: 975, x2: 2080, y2: 1430, r: 26 },
      { kind: "log", x1: 3120, y1: 1490, x2: 3120, y2: 1950, r: 26 },
      { kind: "log", x1: 810, y1: 1450, x2: 1300, y2: 1450, r: 22 },
      { kind: "log", x1: 3900, y1: 1450, x2: 4390, y2: 1450, r: 22 },
      { kind: "log", x1: 1800, y1: 500, x2: 2200, y2: 650, r: 20 },
      { kind: "log", x1: 3000, y1: 2250, x2: 3400, y2: 2400, r: 20 },
    ],
    pickups: [
      { id: 0, x: 2600, y: 700, type: "speed" },
      { id: 1, x: 2600, y: 2200, type: "rapid" },
      { id: 2, x: 845, y: 845, type: "health" },
      { id: 3, x: 4355, y: 2080, type: "health" },
      { id: 4, x: 845, y: 2080, type: "shield" },
      { id: 5, x: 4355, y: 845, type: "bomb" },
      { id: 6, x: 1950, y: 1450, type: "health" },
      { id: 7, x: 3250, y: 1450, type: "health" },
      { id: 8, x: 1300, y: 700, type: "rapid" },
      { id: 9, x: 3900, y: 2200, type: "speed" },
      { id: 10, x: 2000, y: 1900, type: "bomb" },
      { id: 11, x: 3200, y: 1000, type: "shield" },
      { id: 12, x: 1300, y: 2200, type: "triple" },
      { id: 13, x: 3900, y: 700, type: "triple" },
      { id: 14, x: 1700, y: 1450, type: "mine" },
      { id: 15, x: 3500, y: 1450, type: "mine" },
      { id: 16, x: 2600, y: 600, type: "freeze" },
      { id: 17, x: 2600, y: 2300, type: "freeze" },
      { id: 18, x: 1150, y: 1100, type: "shotgun" },
      { id: 19, x: 4050, y: 1800, type: "shotgun" },
      { id: 20, x: 2150, y: 1450, type: "laser" },
      { id: 21, x: 3050, y: 1450, type: "homing" },
      { id: 22, x: 1150, y: 1800, type: "spikes" },
      { id: 23, x: 4050, y: 1100, type: "spikes" },
      { id: 24, x: 2100, y: 700, type: "oil" },
      { id: 25, x: 3100, y: 2200, type: "oil" },
      { id: 26, x: 3100, y: 700, type: "ghost" },
      { id: 27, x: 2100, y: 2200, type: "ghost" },
    ],
  },

  circuit: {
    id: "circuit",
    name: "Grand Circuit",
    theme: "circuit",
    w: 7600,
    h: 4800,
    spawns: CIRCUIT.spawns,
    obstacles: [
      ...loopCapsules(CIRCUIT.outer, 22),
      ...loopCapsules(CIRCUIT.inner, 22),
      ...CIRCUIT.obstacles,
    ],
    pickups: CIRCUIT.pickups,
  },

  canyon: {
    id: "canyon",
    name: "Canyon",
    theme: "canyon",
    w: 6400,
    h: 4200,
    spawns: CANYON.spawns,
    obstacles: [
      ...loopCapsules(CANYON.boundary, 26),
      // Mesas & ridges inside the bowl.
      { kind: "tyre", x: 3200, y: 2100, r: 75 },
      { kind: "tyre", x: 2240, y: 1470, r: 52 },
      { kind: "tyre", x: 4160, y: 2690, r: 52 },
      { kind: "tyre", x: 4220, y: 1500, r: 45 },
      { kind: "tyre", x: 2210, y: 2720, r: 45 },
      { kind: "tyre", x: 3200, y: 1200, r: 42 },
      { kind: "tyre", x: 3200, y: 3000, r: 42 },
      { kind: "tyre", x: 1600, y: 2100, r: 48 },
      { kind: "tyre", x: 4800, y: 2100, r: 48 },
      { kind: "log", x1: 2820, y1: 1600, x2: 3200, y2: 1500, r: 24 },
      { kind: "log", x1: 3230, y1: 2660, x2: 3620, y2: 2560, r: 24 },
      { kind: "log", x1: 1800, y1: 1600, x2: 2050, y2: 1780, r: 22 },
      { kind: "log", x1: 4350, y1: 2420, x2: 4600, y2: 2600, r: 22 },
    ],
    pickups: CANYON.pickups,
  },
};

export const DEFAULT_MAP = "speedway";

export function getMap(id) {
  return MAPS[id] || MAPS[DEFAULT_MAP];
}
