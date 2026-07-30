/**
 * Map + collision regression tests.
 *
 * These exist because "the kart can't move forward" was reported three times.
 * Reading the layouts never caught it; DRIVING them does. Every spawn on every
 * map is simulated at full throttle, so a future layout tweak that parks a
 * spawn in front of a wall fails here instead of in someone's playtest.
 */
import { stepWorld, respawnPlayer, MAX_HP, MAX_SPEED, CAR_RADIUS } from "../src/games/kartArena.js";
import { MAPS } from "../src/games/kartMaps.js";

const TICK = 1 / 30;
const NOW = 1_000_000;

function driveFrom(map, spawnIdx, seconds = 3, input = { throttle: 1, steer: 0, shoot: false }) {
  const p = {
    id: "p", name: "p", color: "red", seatIndex: spawnIdx,
    hp: MAX_HP, alive: true, kills: 0, deaths: 0, lastFire: 0,
    team: null, input,
  };
  respawnPlayer(p, NOW, spawnIdx, map.spawns);
  p.input = input;
  const g = {
    mode: "ffa", w: map.w, h: map.h,
    players: new Map([["p", p]]),
    bullets: [], mines: [], nextMineId: 1,
    pickups: [], obstacles: map.obstacles, spawns: map.spawns,
  };
  const x0 = p.x, y0 = p.y;
  for (let i = 0; i < seconds * 30; i++) stepWorld(g, TICK, NOW + i * (1000 / 30));
  return { player: p, distance: Math.hypot(p.x - x0, p.y - y0) };
}

describe.each(Object.entries(MAPS))("map %s", (id, map) => {
  test("declares a world size and at least 6 spawns", () => {
    expect(map.w).toBeGreaterThan(0);
    expect(map.h).toBeGreaterThan(0);
    expect(map.spawns.length).toBeGreaterThanOrEqual(6);
  });

  test("no spawn starts inside an obstacle", () => {
    for (const s of map.spawns) {
      for (const o of map.obstacles) {
        let cx, cy;
        if (o.x1 !== undefined) {
          const dx = o.x2 - o.x1, dy = o.y2 - o.y1;
          const l2 = dx * dx + dy * dy || 1;
          const t = Math.max(0, Math.min(1, ((s.x - o.x1) * dx + (s.y - o.y1) * dy) / l2));
          cx = o.x1 + dx * t; cy = o.y1 + dy * t;
        } else { cx = o.x; cy = o.y; }
        expect(Math.hypot(s.x - cx, s.y - cy)).toBeGreaterThan(CAR_RADIUS + o.r);
      }
    }
  });

  test("every spawn can drive off in the direction it faces", () => {
    // A kart that spawns facing a wall is the bug this whole file exists for.
    // 3s of free running covers ~1980u; anything under 700 means it hit
    // something almost immediately and could not get away.
    map.spawns.forEach((_, i) => {
      const { distance } = driveFrom(map, i);
      expect({ spawn: i, distance: Math.round(distance) }).toMatchObject({
        distance: expect.any(Number),
      });
      expect(distance).toBeGreaterThan(700);
    });
  });

  test("every spawn stays inside the world bounds while driving", () => {
    map.spawns.forEach((_, i) => {
      const { player } = driveFrom(map, i, 4);
      expect(player.x).toBeGreaterThanOrEqual(0);
      expect(player.y).toBeGreaterThanOrEqual(0);
      expect(player.x).toBeLessThanOrEqual(map.w);
      expect(player.y).toBeLessThanOrEqual(map.h);
    });
  });
});

describe("wall collision behaviour", () => {
  const wallGame = (angle, speed) => {
    const p = {
      id: "p", name: "p", color: "red", seatIndex: 0,
      x: 500, y: 500, angle, speed,
      hp: MAX_HP, alive: true, kills: 0, deaths: 0, lastFire: 0,
      rapidUntil: 0, speedUntil: 0, shieldUntil: 0, bombAt: 0,
      tripleUntil: 0, frozenUntil: 0, minesLeft: 0, nextMineAt: 0,
      team: null, input: { throttle: 1, steer: 0, shoot: false },
    };
    return {
      p,
      g: {
        mode: "ffa", w: 4000, h: 4000,
        players: new Map([["p", p]]),
        bullets: [], mines: [], nextMineId: 1, pickups: [],
        // A long horizontal wall just ahead of the kart.
        obstacles: [{ kind: "log", x1: 0, y1: 560, x2: 4000, y2: 560, r: 20 }],
        spawns: [{ x: 500, y: 500, angle: 0 }],
      },
    };
  };

  test("a head-on impact bleeds most of the speed", () => {
    const { p, g } = wallGame(Math.PI / 2, 600); // straight down into the wall
    for (let i = 0; i < 10; i++) stepWorld(g, TICK, NOW + i * 33);
    expect(p.speed).toBeLessThan(300);
  });

  test("a glancing scrape keeps the kart moving fast", () => {
    // Driving almost parallel to the wall: the kart should slide along it, not
    // stop dead. This is the regression that pinned players against walls.
    const { p, g } = wallGame(0.12, 600);
    for (let i = 0; i < 20; i++) stepWorld(g, TICK, NOW + i * 33);
    expect(p.speed).toBeGreaterThan(380);
  });

  test("a kart pressed against a wall can still drive away from it", () => {
    const { p, g } = wallGame(Math.PI / 2, 600); // buried into the wall
    for (let i = 0; i < 15; i++) stepWorld(g, TICK, NOW + i * 33);
    // Now turn around and drive off.
    p.angle = -Math.PI / 2;
    const yStuck = p.y;
    for (let i = 0; i < 45; i++) stepWorld(g, TICK, NOW + (15 + i) * 33);
    expect(yStuck - p.y).toBeGreaterThan(200); // genuinely escaped
  });

  test("a chain of overlapping barrier capsules does not compound the penalty", () => {
    // A curvy track edge is ~80 capsules; the old code applied its speed
    // penalty once PER capsule, so contact instantly zeroed the kart.
    const p = {
      id: "p", name: "p", color: "red", seatIndex: 0,
      x: 500, y: 500, angle: 0.1, speed: 600,
      hp: MAX_HP, alive: true, kills: 0, deaths: 0, lastFire: 0,
      rapidUntil: 0, speedUntil: 0, shieldUntil: 0, bombAt: 0,
      tripleUntil: 0, frozenUntil: 0, minesLeft: 0, nextMineAt: 0,
      team: null, input: { throttle: 1, steer: 0, shoot: false },
    };
    const obstacles = [];
    for (let x = 0; x < 4000; x += 25) {
      obstacles.push({ kind: "barrier", x1: x, y1: 545, x2: x + 25, y2: 545, r: 22 });
    }
    const g = {
      mode: "ffa", w: 4000, h: 4000,
      players: new Map([["p", p]]),
      bullets: [], mines: [], nextMineId: 1, pickups: [],
      obstacles, spawns: [{ x: 500, y: 500, angle: 0 }],
    };
    for (let i = 0; i < 20; i++) stepWorld(g, TICK, NOW + i * 33);
    expect(p.speed).toBeGreaterThan(380);
  });

  test("a kart spawned exactly inside an obstacle is pushed out, not flung", () => {
    const p = {
      id: "p", name: "p", color: "red", seatIndex: 0,
      x: 800, y: 800, angle: 0, speed: 0,
      hp: MAX_HP, alive: true, kills: 0, deaths: 0, lastFire: 0,
      rapidUntil: 0, speedUntil: 0, shieldUntil: 0, bombAt: 0,
      tripleUntil: 0, frozenUntil: 0, minesLeft: 0, nextMineAt: 0,
      team: null, input: { throttle: 0, steer: 0, shoot: false },
    };
    const g = {
      mode: "ffa", w: 4000, h: 4000,
      players: new Map([["p", p]]),
      bullets: [], mines: [], nextMineId: 1, pickups: [],
      obstacles: [{ kind: "tyre", x: 800, y: 800, r: 60 }],
      spawns: [{ x: 800, y: 800, angle: 0 }],
    };
    stepWorld(g, TICK, NOW);
    const dist = Math.hypot(p.x - 800, p.y - 800);
    expect(dist).toBeCloseTo(CAR_RADIUS + 60, 0); // sitting exactly on the surface
    expect(Number.isFinite(p.x)).toBe(true);
  });
});

describe("map data integrity", () => {
  test.each(Object.entries(MAPS))("%s has unique pickup ids and valid types", (id, map) => {
    const ids = map.pickups.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    const valid = new Set(["health", "rapid", "speed", "shield", "bomb", "triple", "freeze", "mine", "shotgun", "laser", "homing", "spikes", "ghost", "oil"]);
    for (const p of map.pickups) expect(valid.has(p.type)).toBe(true);
  });

  test.each(Object.entries(MAPS))("%s keeps pickups inside the arena", (id, map) => {
    for (const p of map.pickups) {
      expect(p.x).toBeGreaterThan(0);
      expect(p.y).toBeGreaterThan(0);
      expect(p.x).toBeLessThan(map.w);
      expect(p.y).toBeLessThan(map.h);
    }
  });

  test("MAX_SPEED is high enough that 3s of driving crosses meaningful ground", () => {
    expect(MAX_SPEED * 3).toBeGreaterThan(1500);
  });
});
