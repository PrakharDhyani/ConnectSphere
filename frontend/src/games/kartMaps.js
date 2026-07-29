/**
 * Smash Karts — client-side map mirror.
 *
 * The OBSTACLE arrays here must match backend/src/games/kartMaps.js exactly:
 * the server uses them for collision, the client uses them only to render. The
 * `theme` block is client-only (colors + which background decorations to build).
 */

export const MAPS = {
  speedway: {
    id: "speedway",
    name: "Speedway",
    theme: {
      sky: ["#2a4d7a", "#16294a", "#08101f"],
      floor: 0x1a2030,
      wall: 0x2a3550,
      neon: 0x38bdf8,
      fog: 0x0b1424,
      deco: "stadium",
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
      sky: ["#6ea9d6", "#3f7a55", "#1c3324"],
      floor: 0x24422c,
      wall: 0x5a3d24,
      neon: 0x8ae06e,
      fog: 0x213524,
      deco: "forest",
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
};

export const DEFAULT_MAP = "speedway";
export const MAP_LIST = [
  { id: "speedway", name: "Speedway" },
  { id: "forest", name: "Forest" },
];
export const MODES = [
  { id: "ffa", name: "Free for all" },
  { id: "tdm", name: "Team deathmatch" },
];

export function getMap(id) {
  return MAPS[id] || MAPS[DEFAULT_MAP];
}
