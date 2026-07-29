/**
 * Smash Karts — client-side map mirror.
 *
 * The OBSTACLE arrays (and the track-generator code that builds barrier
 * capsules) must match backend/src/games/kartMaps.js exactly: the server uses
 * them for collision, the client uses them only to render. The `theme` block
 * is client-only — it drives every visual choice the renderer makes (sky,
 * lighting, floor texture, decorations, ambient particles), so the renderer
 * switches on theme FIELDS, never on map ids.
 *
 * Curvy maps also carry a `shape` block (loops sampled from the same splines)
 * that the renderer turns into the track ribbon, curved rails and start line.
 *
 * Theme reference:
 *   sky        [top, mid, bottom] gradient stops (css hex strings)
 *   night      true → stars/moon path, headlight beams, bright lamp lenses
 *   stars/moon night-sky extras
 *   floor      base floor color · floorTex: "asphalt" | "grass" | "basalt" | "sand"
 *   island     infield color for ring tracks
 *   outer      color of the huge ground plane outside the arena
 *   wall/neon  wall body color + emissive trim color (bloom picks this up)
 *   fog        fog color · fogFar optional override
 *   exposure   tone-mapping exposure · bloom: bloom strength for this map
 *   grid       draw the floor grid helper · centerRing: false → skip center ring
 *   deco       "stadium" | "forest" | "volcano" | "circuit" | "canyon"
 *   circle     how circle colliders render: "tyre" | "rock"
 *   log        how capsule (log) colliders render: "wood" | "basalt"
 *   barrier    how shaped-track edges render: "rail" | "rock"
 *   dust       skid/dust particle tint
 *   sun/hemi   directional + hemisphere light setup
 *   ambient    "flash" | "leaves" | "embers" | "dust"
 */

// ── Curvy-track generation (mirrored verbatim from the server) ──

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

const CIRCUIT = (() => {
  const cx = 1200, cy = 750;
  const center = sampleClosedSpline(
    ringPoints(cx, cy, [520, 610, 450, 640, 560, 470, 650, 520, 430, 600], 0.78),
    8
  );
  const outer = offsetLoop(center, 115, cx, cy);
  const inner = offsetLoop(center, -115, cx, cy);
  const p = center[0], q = center[1];
  const start = { x: p.x, y: p.y, angle: Math.atan2(q.y - p.y, q.x - p.x) };
  return { center, outer, inner, start };
})();

const CANYON = (() => {
  const cx = 1000, cy = 650;
  const boundary = sampleClosedSpline(
    ringPoints(cx, cy, [560, 630, 480, 700, 640, 520, 690, 560, 470], 0.75),
    8
  );
  return { boundary };
})();

export const MAPS = {
  speedway: {
    id: "speedway",
    name: "Speedway",
    theme: {
      sky: ["#16244a", "#0b1430", "#04070f"],
      night: true,
      stars: true,
      moon: true,
      floor: 0x262a35,
      floorTex: "asphalt",
      outer: 0x141a26,
      wall: 0x2a3550,
      neon: 0x38bdf8,
      fog: 0x0b1424,
      exposure: 1.2,
      bloom: 0.7,
      grid: true,
      deco: "stadium",
      circle: "tyre",
      log: "wood",
      dust: 0x9aa3b2,
      sun: { color: 0x9db8ff, intensity: 0.6 },
      hemi: { sky: 0x33456b, ground: 0x0c1524, intensity: 0.75 },
      ambient: "flash",
    },
    obstacles: [
      { kind: "tyre", x: 560, y: 300, r: 32 },
      { kind: "tyre", x: 1040, y: 300, r: 32 },
      { kind: "tyre", x: 560, y: 600, r: 32 },
      { kind: "tyre", x: 1040, y: 600, r: 32 },
      { kind: "tyre", x: 800, y: 450, r: 36 },
      { kind: "log", x1: 700, y1: 250, x2: 900, y2: 250, r: 16 },
      { kind: "log", x1: 700, y1: 650, x2: 900, y2: 650, r: 16 },
      { kind: "log", x1: 400, y1: 380, x2: 400, y2: 520, r: 16 },
      { kind: "log", x1: 1200, y1: 380, x2: 1200, y2: 520, r: 16 },
    ],
  },

  forest: {
    id: "forest",
    name: "Forest",
    theme: {
      sky: ["#9fd3f2", "#68a7d8", "#31628f"],
      night: false,
      stars: false,
      moon: false,
      floor: 0x2b4d33,
      floorTex: "grass",
      outer: 0x24462b,
      wall: 0x5a3d24,
      neon: 0x8ae06e,
      fog: 0x7aa8c4,
      exposure: 1.1,
      bloom: 0.35,
      grid: false,
      deco: "forest",
      circle: "rock",
      log: "wood",
      dust: 0x8a7a55,
      sun: { color: 0xfff2cc, intensity: 1.7 },
      hemi: { sky: 0xbfe3ff, ground: 0x2c4a2f, intensity: 0.9 },
      ambient: "leaves",
    },
    obstacles: [
      { kind: "log", x1: 500, y1: 250, x2: 750, y2: 200, r: 18 },
      { kind: "log", x1: 900, y1: 700, x2: 1150, y2: 650, r: 18 },
      { kind: "log", x1: 1100, y1: 260, x2: 1250, y2: 400, r: 18 },
      { kind: "log", x1: 350, y1: 600, x2: 520, y2: 700, r: 18 },
      { kind: "tyre", x: 800, y: 450, r: 38 },
      { kind: "tyre", x: 520, y: 450, r: 28 },
      { kind: "tyre", x: 1080, y: 450, r: 28 },
      { kind: "tyre", x: 660, y: 640, r: 26 },
      { kind: "tyre", x: 950, y: 260, r: 26 },
    ],
  },

  volcano: {
    id: "volcano",
    name: "Volcano",
    theme: {
      sky: ["#3a1b1b", "#57201a", "#120708"],
      night: true,
      stars: false,
      moon: false,
      floor: 0x1d1a20,
      floorTex: "basalt",
      outer: 0x141014,
      wall: 0x3a2c2c,
      neon: 0xff6b35,
      fog: 0x1a0d0c,
      fogFar: 3800,
      exposure: 1.25,
      bloom: 0.8,
      grid: false,
      deco: "volcano",
      circle: "rock",
      log: "basalt",
      dust: 0x77706b,
      sun: { color: 0xff8c5a, intensity: 0.7 },
      hemi: { sky: 0x5a2c22, ground: 0x120a0a, intensity: 0.8 },
      ambient: "embers",
    },
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
  },

  circuit: {
    id: "circuit",
    name: "Grand Circuit",
    w: 2400,
    h: 1500,
    shape: {
      kind: "ring",
      outer: CIRCUIT.outer,
      inner: CIRCUIT.inner,
      center: CIRCUIT.center,
      start: CIRCUIT.start,
    },
    theme: {
      sky: ["#ff9a56", "#b0486b", "#241b4d"],
      night: true,
      stars: true,
      moon: false,
      floor: 0x262a35,
      floorTex: "asphalt",
      island: 0x2c4a33,
      outer: 0x1c2426,
      wall: 0x3a4560,
      neon: 0x22d3ee,
      fog: 0x241626,
      fogFar: 4400,
      exposure: 1.18,
      bloom: 0.65,
      grid: false,
      centerRing: false,
      deco: "circuit",
      circle: "tyre",
      log: "wood",
      barrier: "rail",
      dust: 0x9aa3b2,
      sun: { color: 0xffb347, intensity: 1.0 },
      hemi: { sky: 0x8a5a7a, ground: 0x141a22, intensity: 0.75 },
      ambient: null,
    },
    obstacles: [
      ...loopCapsules(CIRCUIT.outer, 13),
      ...loopCapsules(CIRCUIT.inner, 13),
    ],
  },

  canyon: {
    id: "canyon",
    name: "Canyon",
    w: 2000,
    h: 1300,
    shape: {
      kind: "blob",
      outer: CANYON.boundary,
    },
    theme: {
      sky: ["#ffd9a0", "#e8975f", "#8a4a3b"],
      night: false,
      stars: false,
      moon: false,
      floor: 0xc2a678,
      floorTex: "sand",
      outer: 0x8f7350,
      wall: 0x8a5c3b,
      neon: 0xffb347,
      fog: 0xd8a878,
      fogFar: 4000,
      exposure: 1.12,
      bloom: 0.3,
      grid: false,
      centerRing: false,
      deco: "canyon",
      circle: "rock",
      log: "wood",
      barrier: "rock",
      dust: 0xc9b089,
      sun: { color: 0xffe0b0, intensity: 1.8 },
      hemi: { sky: 0xffd9b0, ground: 0x8a6a4a, intensity: 0.9 },
      ambient: "dust",
    },
    obstacles: [
      ...loopCapsules(CANYON.boundary, 16),
      { kind: "tyre", x: 1000, y: 650, r: 44 },
      { kind: "tyre", x: 700, y: 460, r: 30 },
      { kind: "tyre", x: 1300, y: 840, r: 30 },
      { kind: "tyre", x: 1320, y: 470, r: 26 },
      { kind: "tyre", x: 690, y: 850, r: 26 },
      { kind: "log", x1: 880, y1: 500, x2: 1000, y2: 470, r: 15 },
      { kind: "log", x1: 1010, y1: 830, x2: 1130, y2: 800, r: 15 },
    ],
  },
};

export const DEFAULT_MAP = "speedway";
export const MAP_LIST = [
  { id: "speedway", name: "Speedway" },
  { id: "forest", name: "Forest" },
  { id: "volcano", name: "Volcano" },
  { id: "circuit", name: "Grand Circuit" },
  { id: "canyon", name: "Canyon" },
];
export const MODES = [
  { id: "ffa", name: "Free for all" },
  { id: "tdm", name: "Team deathmatch" },
];

export function getMap(id) {
  return MAPS[id] || MAPS[DEFAULT_MAP];
}
