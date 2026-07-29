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
 * fallen log. Maps without `w`/`h` use the default 1600×900 arena.
 *
 * Pickup types: health | rapid | speed | shield | bomb.
 */
import { ARENA_W, ARENA_H } from "./kartArena.js";

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

// Grand Circuit — a closed curvy racing ring (2400×1500 world). The varied
// radii give it sweepers, pinches and S-ish transitions; the track is the
// ±115 offset band around the centerline.
const CIRCUIT = (() => {
  const cx = 1200, cy = 750;
  const center = sampleClosedSpline(
    ringPoints(cx, cy, [520, 610, 450, 640, 560, 470, 650, 520, 430, 600], 0.78),
    8
  );
  const outer = offsetLoop(center, 115, cx, cy);
  const inner = offsetLoop(center, -115, cx, cy);
  const spawns = [0, 13, 27, 40, 53, 67].map((i) => {
    const p = center[i], q = center[(i + 1) % center.length];
    return { x: p.x, y: p.y, angle: Math.atan2(q.y - p.y, q.x - p.x) };
  });
  const types = ["speed", "health", "rapid", "shield", "health", "bomb"];
  const pickups = [7, 20, 33, 47, 60, 73].map((i, k) => ({
    id: k, x: center[i].x, y: center[i].y, type: types[k],
  }));
  return { center, outer, inner, spawns, pickups };
})();

// Canyon — a big open curvy blob (2000×1300 world): one winding boundary,
// rocks and ridges inside.
const CANYON = (() => {
  const cx = 1000, cy = 650;
  const boundary = sampleClosedSpline(
    ringPoints(cx, cy, [560, 630, 480, 700, 640, 520, 690, 560, 470], 0.75),
    8
  );
  const spawns = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.26;
    spawns.push({ x: cx + Math.cos(a) * 300, y: cy + Math.sin(a) * 300 * 0.75, angle: a + Math.PI / 2 });
  }
  const types = ["speed", "health", "rapid", "shield", "health", "bomb"];
  const pickups = types.map((type, i) => {
    const a = (i / 6) * Math.PI * 2;
    return { id: i, x: cx + Math.cos(a) * 440, y: cy + Math.sin(a) * 440 * 0.75, type };
  });
  return { boundary, spawns, pickups };
})();

// Six spawn points shared by the rectangular maps — corners + top/bottom
// midpoints, all well clear of the obstacle layouts below.
const SPAWNS = [
  { x: 180, y: 160, angle: 0.4 },
  { x: ARENA_W - 180, y: 160, angle: Math.PI - 0.4 },
  { x: 180, y: ARENA_H - 160, angle: -0.4 },
  { x: ARENA_W - 180, y: ARENA_H - 160, angle: Math.PI + 0.4 },
  { x: ARENA_W / 2, y: 130, angle: Math.PI / 2 },
  { x: ARENA_W / 2, y: ARENA_H - 130, angle: -Math.PI / 2 },
];

export const MAPS = {
  speedway: {
    id: "speedway",
    name: "Speedway",
    theme: "speedway",
    spawns: SPAWNS,
    obstacles: [
      // Tyre stacks forming a central chicane.
      { kind: "tyre", x: 560, y: 300, r: 32 },
      { kind: "tyre", x: 1040, y: 300, r: 32 },
      { kind: "tyre", x: 560, y: 600, r: 32 },
      { kind: "tyre", x: 1040, y: 600, r: 32 },
      { kind: "tyre", x: 800, y: 450, r: 36 },
      // Barrier logs top & bottom of the middle.
      { kind: "log", x1: 700, y1: 250, x2: 900, y2: 250, r: 16 },
      { kind: "log", x1: 700, y1: 650, x2: 900, y2: 650, r: 16 },
      // Side barriers.
      { kind: "log", x1: 400, y1: 380, x2: 400, y2: 520, r: 16 },
      { kind: "log", x1: 1200, y1: 380, x2: 1200, y2: 520, r: 16 },
    ],
    pickups: [
      { id: 0, x: 800, y: 180, type: "speed" },
      { id: 1, x: 800, y: 720, type: "shield" },
      { id: 2, x: 300, y: 450, type: "health" },
      { id: 3, x: 1300, y: 450, type: "health" },
      { id: 4, x: 560, y: 450, type: "bomb" },
      { id: 5, x: 1040, y: 450, type: "rapid" },
    ],
  },

  forest: {
    id: "forest",
    name: "Forest",
    theme: "forest",
    spawns: SPAWNS,
    obstacles: [
      // Fallen logs, scattered organically.
      { kind: "log", x1: 500, y1: 250, x2: 750, y2: 200, r: 18 },
      { kind: "log", x1: 900, y1: 700, x2: 1150, y2: 650, r: 18 },
      { kind: "log", x1: 1100, y1: 260, x2: 1250, y2: 400, r: 18 },
      { kind: "log", x1: 350, y1: 600, x2: 520, y2: 700, r: 18 },
      // Rocks.
      { kind: "tyre", x: 800, y: 450, r: 38 },
      { kind: "tyre", x: 520, y: 450, r: 28 },
      { kind: "tyre", x: 1080, y: 450, r: 28 },
      { kind: "tyre", x: 660, y: 640, r: 26 },
      { kind: "tyre", x: 950, y: 260, r: 26 },
    ],
    pickups: [
      { id: 0, x: 800, y: 150, type: "speed" },
      { id: 1, x: 800, y: 750, type: "shield" },
      { id: 2, x: 250, y: 450, type: "health" },
      { id: 3, x: 1350, y: 450, type: "health" },
      { id: 4, x: 400, y: 250, type: "bomb" },
      { id: 5, x: 1200, y: 650, type: "rapid" },
    ],
  },

  volcano: {
    id: "volcano",
    name: "Volcano",
    theme: "volcano",
    spawns: SPAWNS,
    obstacles: [
      // Central boulder + satellite rocks.
      { kind: "tyre", x: 800, y: 450, r: 46 },
      { kind: "tyre", x: 480, y: 260, r: 30 },
      { kind: "tyre", x: 1120, y: 640, r: 30 },
      { kind: "tyre", x: 1120, y: 260, r: 26 },
      { kind: "tyre", x: 480, y: 640, r: 26 },
      // Basalt ridges guarding the center + side barriers.
      { kind: "log", x1: 640, y1: 300, x2: 640, y2: 440, r: 16 },
      { kind: "log", x1: 960, y1: 460, x2: 960, y2: 600, r: 16 },
      { kind: "log", x1: 250, y1: 450, x2: 400, y2: 450, r: 14 },
      { kind: "log", x1: 1200, y1: 450, x2: 1350, y2: 450, r: 14 },
    ],
    pickups: [
      { id: 0, x: 800, y: 160, type: "speed" },
      { id: 1, x: 800, y: 700, type: "rapid" },
      { id: 2, x: 260, y: 260, type: "health" },
      { id: 3, x: 1340, y: 640, type: "health" },
      { id: 4, x: 260, y: 640, type: "shield" },
      { id: 5, x: 1340, y: 260, type: "bomb" },
    ],
  },

  circuit: {
    id: "circuit",
    name: "Grand Circuit",
    theme: "circuit",
    w: 2400,
    h: 1500,
    spawns: CIRCUIT.spawns,
    obstacles: [
      ...loopCapsules(CIRCUIT.outer, 13),
      ...loopCapsules(CIRCUIT.inner, 13),
    ],
    pickups: CIRCUIT.pickups,
  },

  canyon: {
    id: "canyon",
    name: "Canyon",
    theme: "canyon",
    w: 2000,
    h: 1300,
    spawns: CANYON.spawns,
    obstacles: [
      ...loopCapsules(CANYON.boundary, 16),
      // Mesas & ridges inside the bowl.
      { kind: "tyre", x: 1000, y: 650, r: 44 },
      { kind: "tyre", x: 700, y: 460, r: 30 },
      { kind: "tyre", x: 1300, y: 840, r: 30 },
      { kind: "tyre", x: 1320, y: 470, r: 26 },
      { kind: "tyre", x: 690, y: 850, r: 26 },
      { kind: "log", x1: 880, y1: 500, x2: 1000, y2: 470, r: 15 },
      { kind: "log", x1: 1010, y1: 830, x2: 1130, y2: 800, r: 15 },
    ],
    pickups: CANYON.pickups,
  },
};

export const DEFAULT_MAP = "speedway";

export function getMap(id) {
  return MAPS[id] || MAPS[DEFAULT_MAP];
}
