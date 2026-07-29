/**
 * Smash Karts — map definitions (server side).
 *
 * Each map is static design data: spawn points, obstacle colliders, and pickup
 * pads. The physics core (kartArena.js) reads `g.obstacles` / `g.spawns` for
 * collision + respawns; the client mirrors these layouts in
 * frontend/src/games/kartMaps.js purely to RENDER them (keep the two in sync).
 *
 * Obstacle colliders come in two shapes:
 *   - circle:  { kind, x, y, r }                      (tyre stacks, rocks)
 *   - capsule: { kind, x1, y1, x2, y2, r }            (logs, barriers)
 *
 * Pickup types: health | rapid | speed | shield | bomb.
 */
import { ARENA_W, ARENA_H } from "./kartArena.js";

// Six spawn points shared by both maps — corners + top/bottom midpoints, all
// well clear of the obstacle layouts below.
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
      // Rocks / tyres.
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
};

export const DEFAULT_MAP = "speedway";

export function getMap(id) {
  return MAPS[id] || MAPS[DEFAULT_MAP];
}
