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
 *   rockColor  rock albedo · rockEmissive: optional glow (contrast vs floor!)
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
  const cx = 3800, cy = 2400;
  const center = sampleClosedSpline(
    ringPoints(cx, cy, [1650, 1950, 1430, 2050, 1790, 1500, 2080, 1660, 1370, 1920], 0.78),
    8
  );
  const HALF = 230;
  const outer = offsetLoop(center, HALF, cx, cy);
  const inner = offsetLoop(center, -HALF, cx, cy);
  const N = center.length;
  const nrm = (i) => {
    const a = center[(i + N - 1) % N], b = center[(i + 1) % N];
    let tx = b.x - a.x, ty = b.y - a.y;
    const L = Math.hypot(tx, ty) || 1;
    let nx = -ty / L, ny = tx / L;
    if ((center[i].x - cx) * nx + (center[i].y - cy) * ny < 0) { nx = -nx; ny = -ny; }
    return { nx, ny };
  };
  const obstacles = [4, 10, 17, 24, 30, 37, 44, 50, 57, 64, 70, 77].map((i, k) => {
    const { nx, ny } = nrm(i);
    const side = k % 2 === 0 ? 0.5 : -0.5;
    return { kind: "tyre", x: center[i].x + nx * HALF * side, y: center[i].y + ny * HALF * side, r: 38 };
  });
  const p = center[0], q = center[1];
  const start = { x: p.x, y: p.y, angle: Math.atan2(q.y - p.y, q.x - p.x) };
  return { center, outer, inner, obstacles, start, width: HALF * 2 };
})();

const CANYON = (() => {
  const cx = 3200, cy = 2100;
  const boundary = sampleClosedSpline(
    ringPoints(cx, cy, [1790, 2020, 1540, 2240, 2050, 1660, 2210, 1790, 1500], 0.75),
    8
  );
  return { boundary };
})();

export const MAPS = {
  speedway: {
    id: "speedway",
    name: "Speedway",
    w: 5200,
    h: 2900,
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
      fogFar: 6200,
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
      { kind: "tyre", x: 2600, y: 1450, r: 55 },
      { kind: "tyre", x: 2100, y: 950, r: 48 },
      { kind: "tyre", x: 3100, y: 950, r: 48 },
      { kind: "tyre", x: 2100, y: 1950, r: 48 },
      { kind: "tyre", x: 3100, y: 1950, r: 48 },
      { kind: "log", x1: 2250, y1: 800, x2: 2950, y2: 800, r: 24 },
      { kind: "log", x1: 2250, y1: 2100, x2: 2950, y2: 2100, r: 24 },
      { kind: "log", x1: 1300, y1: 1200, x2: 1300, y2: 1700, r: 24 },
      { kind: "log", x1: 3900, y1: 1200, x2: 3900, y2: 1700, r: 24 },
      { kind: "tyre", x: 900, y: 700, r: 40 },
      { kind: "tyre", x: 900, y: 2200, r: 40 },
      { kind: "log", x1: 700, y1: 1450, x2: 1100, y2: 1450, r: 20 },
      { kind: "tyre", x: 4300, y: 700, r: 40 },
      { kind: "tyre", x: 4300, y: 2200, r: 40 },
      { kind: "log", x1: 4100, y1: 1450, x2: 4500, y2: 1450, r: 20 },
      { kind: "tyre", x: 1800, y: 1450, r: 36 },
      { kind: "tyre", x: 3400, y: 1450, r: 36 },
    ],
  },

  forest: {
    id: "forest",
    name: "Forest",
    w: 5200,
    h: 2900,
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
      fogFar: 6200,
      exposure: 1.1,
      bloom: 0.35,
      grid: false,
      deco: "forest",
      circle: "rock",
      rockColor: 0x707d68,
      log: "wood",
      dust: 0x8a7a55,
      sun: { color: 0xfff2cc, intensity: 1.7 },
      hemi: { sky: 0xbfe3ff, ground: 0x2c4a2f, intensity: 0.9 },
      ambient: "leaves",
    },
    obstacles: [
      { kind: "log", x1: 1625, y1: 810, x2: 2440, y2: 650, r: 26 },
      { kind: "log", x1: 2925, y1: 2275, x2: 3740, y2: 2110, r: 26 },
      { kind: "log", x1: 3575, y1: 845, x2: 4060, y2: 1300, r: 26 },
      { kind: "log", x1: 1140, y1: 1950, x2: 1690, y2: 2275, r: 26 },
      { kind: "log", x1: 700, y1: 700, x2: 1200, y2: 900, r: 24 },
      { kind: "log", x1: 4000, y1: 2000, x2: 4500, y2: 2200, r: 24 },
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
  },

  volcano: {
    id: "volcano",
    name: "Volcano",
    w: 5200,
    h: 2900,
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
      fogFar: 6800,
      exposure: 1.25,
      bloom: 0.8,
      grid: false,
      deco: "volcano",
      circle: "rock",
      // Obsidian rocks with lava-lit edges — dark core + emissive glow so
      // they pop against the dark basalt floor instead of blending in.
      rockColor: 0x0f0c10,
      rockEmissive: 0xff5a1f,
      log: "basalt",
      dust: 0x77706b,
      sun: { color: 0xff8c5a, intensity: 0.7 },
      hemi: { sky: 0x5a2c22, ground: 0x120a0a, intensity: 0.8 },
      ambient: "embers",
    },
    obstacles: [
      { kind: "tyre", x: 2600, y: 1450, r: 75 },
      { kind: "tyre", x: 1560, y: 845, r: 50 },
      { kind: "tyre", x: 3640, y: 2080, r: 50 },
      { kind: "tyre", x: 3640, y: 845, r: 45 },
      { kind: "tyre", x: 1560, y: 2080, r: 45 },
      { kind: "tyre", x: 700, y: 1450, r: 40 },
      { kind: "tyre", x: 4500, y: 1450, r: 40 },
      { kind: "tyre", x: 2300, y: 600, r: 40 },
      { kind: "tyre", x: 2900, y: 2300, r: 40 },
      { kind: "log", x1: 2080, y1: 975, x2: 2080, y2: 1430, r: 26 },
      { kind: "log", x1: 3120, y1: 1490, x2: 3120, y2: 1950, r: 26 },
      { kind: "log", x1: 810, y1: 1450, x2: 1300, y2: 1450, r: 22 },
      { kind: "log", x1: 3900, y1: 1450, x2: 4390, y2: 1450, r: 22 },
      { kind: "log", x1: 1800, y1: 500, x2: 2200, y2: 650, r: 20 },
      { kind: "log", x1: 3000, y1: 2250, x2: 3400, y2: 2400, r: 20 },
    ],
  },

  circuit: {
    id: "circuit",
    name: "Grand Circuit",
    w: 7600,
    h: 4800,
    shape: {
      kind: "ring",
      outer: CIRCUIT.outer,
      inner: CIRCUIT.inner,
      center: CIRCUIT.center,
      start: CIRCUIT.start,
      width: CIRCUIT.width,
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
      fogFar: 9500,
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
      ...loopCapsules(CIRCUIT.outer, 22),
      ...loopCapsules(CIRCUIT.inner, 22),
      ...CIRCUIT.obstacles,
    ],
  },

  canyon: {
    id: "canyon",
    name: "Canyon",
    w: 6400,
    h: 4200,
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
      fogFar: 9000,
      exposure: 1.12,
      bloom: 0.3,
      grid: false,
      centerRing: false,
      deco: "canyon",
      circle: "rock",
      rockColor: 0x4a3a2c,
      log: "wood",
      barrier: "rock",
      dust: 0xc9b089,
      sun: { color: 0xffe0b0, intensity: 1.8 },
      hemi: { sky: 0xffd9b0, ground: 0x8a6a4a, intensity: 0.9 },
      ambient: "dust",
    },
    obstacles: [
      ...loopCapsules(CANYON.boundary, 26),
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
