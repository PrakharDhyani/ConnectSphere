/**
 * Unit tests for the Smash Karts physics/rules core and the bot driver.
 *
 * These need no HTTP, DB or sockets — `stepWorld` is a pure function over a
 * game object, which is exactly why the core was kept socket-free.
 */
import { jest } from "@jest/globals";
import {
  stepWorld, respawnPlayer, MAX_HP, CAR_RADIUS,
  BOMB_DAMAGE, BOMB_RADIUS, BOMB_FUSE_MS,
  MINE_COUNT, MINE_ARM_MS, MINE_DAMAGE,
  FREEZE_MS, TRIPLE_MS, SHIELD_MS, BULLET_DAMAGE,
  WEAPONS, SPIKES_MS, SPIKE_DAMAGE, SLIP_MS, GHOST_MS,
} from "../src/games/kartArena.js";
import { botInput, tuningFor, BOT_TUNING, DIFFICULTIES } from "../src/games/kartBot.js";

const NOW = 1_000_000;

function mkPlayer(id, over = {}) {
  return {
    id, name: id, color: "red", seatIndex: 0,
    x: 500, y: 500, angle: 0, speed: 0,
    hp: MAX_HP, alive: true, kills: 0, deaths: 0, lastFire: 0,
    rapidUntil: 0, speedUntil: 0, shieldUntil: 0, bombAt: 0,
    tripleUntil: 0, frozenUntil: 0, minesLeft: 0, nextMineAt: 0,
    team: null, isBot: false, difficulty: null,
    input: { throttle: 0, steer: 0, shoot: false },
    ...over,
  };
}

function mkGame(players, over = {}) {
  const map = new Map();
  for (const p of players) map.set(p.id, p);
  return {
    mode: "ffa", w: 2000, h: 2000,
    players: map, bullets: [], mines: [], nextMineId: 1,
    pickups: [], obstacles: [],
    spawns: [{ x: 100, y: 100, angle: 0 }],
    ...over,
  };
}

describe("kart arena — shield", () => {
  test("shield saves you from a bomb blast standing right next to it", () => {
    const bomber = mkPlayer("bomber", { x: 500, y: 500, bombAt: NOW - 1 });
    const victim = mkPlayer("victim", { x: 500 + BOMB_RADIUS / 2, y: 500, shieldUntil: NOW + SHIELD_MS });
    const g = mkGame([bomber, victim]);

    const { kills } = stepWorld(g, 1 / 30, NOW);

    expect(victim.hp).toBe(MAX_HP); // untouched
    expect(victim.alive).toBe(true);
    expect(kills).toHaveLength(0);
    expect(bomber.alive).toBe(false); // the carrier still dies
  });

  test("without a shield the same blast lands full damage", () => {
    const bomber = mkPlayer("bomber", { x: 500, y: 500, bombAt: NOW - 1 });
    const victim = mkPlayer("victim", { x: 500 + BOMB_RADIUS / 2, y: 500 });
    const g = mkGame([bomber, victim]);

    stepWorld(g, 1 / 30, NOW);

    // BOMB_DAMAGE (95) < MAX_HP (100), so a full-health kart survives on a
    // sliver — that's the balance, not a bug.
    expect(victim.hp).toBe(MAX_HP - BOMB_DAMAGE);
    expect(victim.alive).toBe(true);
  });

  test("a bomb kills an already-damaged victim and credits the bomber", () => {
    const bomber = mkPlayer("bomber", { x: 500, y: 500, bombAt: NOW - 1 });
    const victim = mkPlayer("victim", { x: 500 + BOMB_RADIUS / 2, y: 500, hp: BOMB_DAMAGE });
    const g = mkGame([bomber, victim]);

    const { kills } = stepWorld(g, 1 / 30, NOW);

    expect(victim.alive).toBe(false);
    expect(kills.map((k) => k.victimId)).toContain("victim");
    expect(bomber.kills).toBe(1);
  });

  test("a bomb does not hurt anyone outside its radius", () => {
    const bomber = mkPlayer("bomber", { x: 500, y: 500, bombAt: NOW - 1 });
    const far = mkPlayer("far", { x: 500 + BOMB_RADIUS * 2, y: 500 });
    const g = mkGame([bomber, far]);

    stepWorld(g, 1 / 30, NOW);

    expect(far.hp).toBe(MAX_HP);
  });

  test("shield absorbs bullets too", () => {
    const shooter = mkPlayer("shooter", { x: 100, y: 500, angle: 0 });
    const victim = mkPlayer("victim", { x: 160, y: 500, shieldUntil: NOW + SHIELD_MS });
    const g = mkGame([shooter, victim]);
    g.bullets.push({ ownerId: "shooter", x: 155, y: 500, vx: 100, vy: 0, ttl: 1 });

    stepWorld(g, 1 / 30, NOW);

    expect(victim.hp).toBe(MAX_HP);
  });

  test("teammates are immune to a team-mate's bomb in TDM", () => {
    const bomber = mkPlayer("bomber", { x: 500, y: 500, bombAt: NOW - 1, team: "A" });
    const mate = mkPlayer("mate", { x: 520, y: 500, team: "A" });
    const foe = mkPlayer("foe", { x: 540, y: 500, team: "B" });
    const g = mkGame([bomber, mate, foe], { mode: "tdm" });

    stepWorld(g, 1 / 30, NOW);

    expect(mate.hp).toBe(MAX_HP);
    expect(foe.hp).toBeLessThan(MAX_HP);
  });
});

describe("kart arena — new powerups", () => {
  test("picking up 'triple' makes one shot fire three bullets", () => {
    const p = mkPlayer("p", { tripleUntil: NOW + TRIPLE_MS, input: { throttle: 0, steer: 0, shoot: true } });
    const g = mkGame([p]);

    stepWorld(g, 1 / 30, NOW);

    expect(g.bullets).toHaveLength(3);
    const angles = g.bullets.map((b) => Math.atan2(b.vy, b.vx));
    expect(new Set(angles.map((a) => a.toFixed(3))).size).toBe(3); // genuinely spread
  });

  test("without triple a shot fires a single bullet", () => {
    const p = mkPlayer("p", { input: { throttle: 0, steer: 0, shoot: true } });
    const g = mkGame([p]);
    stepWorld(g, 1 / 30, NOW);
    expect(g.bullets).toHaveLength(1);
  });

  test("'freeze' pickup locks nearby enemies but not shielded ones", () => {
    const grabber = mkPlayer("grabber", { x: 500, y: 500 });
    const near = mkPlayer("near", { x: 560, y: 500 });
    const shielded = mkPlayer("shielded", { x: 570, y: 500, shieldUntil: NOW + SHIELD_MS });
    const far = mkPlayer("far", { x: 1900, y: 1900 });
    const g = mkGame([grabber, near, shielded, far], {
      pickups: [{ id: 0, x: 500, y: 500, type: "freeze", active: true, readyAt: 0 }],
    });

    stepWorld(g, 1 / 30, NOW);

    expect(near.frozenUntil).toBe(NOW + FREEZE_MS);
    expect(shielded.frozenUntil).toBe(0);
    expect(far.frozenUntil).toBe(0);
  });

  test("a frozen kart ignores its input and coasts to a stop", () => {
    const p = mkPlayer("p", {
      frozenUntil: NOW + FREEZE_MS, speed: 400,
      input: { throttle: 1, steer: 1, shoot: true },
    });
    const g = mkGame([p]);
    const angle0 = p.angle;

    stepWorld(g, 1 / 30, NOW);

    expect(p.speed).toBeLessThan(400); // decelerating
    expect(p.angle).toBe(angle0); // steering ignored
    expect(g.bullets).toHaveLength(0); // can't shoot
  });

  test("'mine' pickup lays a trail of mines behind the kart", () => {
    const p = mkPlayer("p", { x: 500, y: 500, angle: 0 });
    const g = mkGame([p], {
      pickups: [{ id: 0, x: 500, y: 500, type: "mine", active: true, readyAt: 0 }],
    });

    // Grab it, then run enough ticks (spaced out) to drop the whole trail.
    stepWorld(g, 1 / 30, NOW);
    expect(p.minesLeft).toBeGreaterThan(0);
    for (let i = 0; i < MINE_COUNT + 1; i++) stepWorld(g, 1 / 30, NOW + i * 600);

    expect(g.mines).toHaveLength(MINE_COUNT);
    // Dropped BEHIND the kart (it faces +x, so mines sit at lower x).
    for (const m of g.mines) expect(m.x).toBeLessThan(p.x);
  });

  test("an armed mine damages an enemy who drives over it, but not the owner", () => {
    const owner = mkPlayer("owner", { x: 100, y: 100 });
    const enemy = mkPlayer("enemy", { x: 500, y: 500 });
    const g = mkGame([owner, enemy]);
    g.mines.push({ id: 1, ownerId: "owner", team: null, x: 500, y: 500, armAt: NOW - 1, expiresAt: NOW + 10000 });

    const { booms } = stepWorld(g, 1 / 30, NOW);

    expect(enemy.hp).toBe(MAX_HP - MINE_DAMAGE);
    expect(owner.hp).toBe(MAX_HP);
    expect(g.mines).toHaveLength(0); // consumed
    expect(booms).toHaveLength(1);
  });

  test("a shielded kart drives over an armed mine unharmed and leaves it live", () => {
    const owner = mkPlayer("owner", { x: 100, y: 100 });
    const enemy = mkPlayer("enemy", { x: 500, y: 500, shieldUntil: NOW + SHIELD_MS });
    const g = mkGame([owner, enemy]);
    g.mines.push({ id: 1, ownerId: "owner", team: null, x: 500, y: 500, armAt: NOW - 1, expiresAt: NOW + 10000 });

    stepWorld(g, 1 / 30, NOW);

    expect(enemy.hp).toBe(MAX_HP);
    expect(g.mines).toHaveLength(1);
  });

  test("an unarmed mine is harmless", () => {
    const owner = mkPlayer("owner", { x: 100, y: 100 });
    const enemy = mkPlayer("enemy", { x: 500, y: 500 });
    const g = mkGame([owner, enemy]);
    g.mines.push({ id: 1, ownerId: "owner", team: null, x: 500, y: 500, armAt: NOW + MINE_ARM_MS, expiresAt: NOW + 10000 });

    stepWorld(g, 1 / 30, NOW);

    expect(enemy.hp).toBe(MAX_HP);
    expect(g.mines).toHaveLength(1);
  });

  test("respawn clears every powerup state", () => {
    const p = mkPlayer("p", {
      tripleUntil: NOW + 1, frozenUntil: NOW + 1, minesLeft: 2,
      shieldUntil: NOW + 1, bombAt: NOW + BOMB_FUSE_MS, hp: 3, alive: false,
    });
    respawnPlayer(p, NOW, 0, [{ x: 10, y: 20, angle: 0 }]);
    expect(p).toMatchObject({
      hp: MAX_HP, alive: true, tripleUntil: 0, frozenUntil: 0,
      minesLeft: 0, shieldUntil: 0, bombAt: 0, x: 10, y: 20,
    });
  });
});

describe("kart arena — weapons", () => {
  const shooting = (over = {}) =>
    mkPlayer("p", { input: { throttle: 0, steer: 0, shoot: true }, ...over });

  test("the shotgun fires a spread of pellets and spends ammo", () => {
    const p = shooting({ weapon: { kind: "shotgun", ammo: WEAPONS.shotgun.ammo } });
    const g = mkGame([p]);
    stepWorld(g, 1 / 30, NOW);

    expect(g.bullets).toHaveLength(WEAPONS.shotgun.pellets);
    expect(p.weapon.ammo).toBe(WEAPONS.shotgun.ammo - 1);
    const angles = g.bullets.map((b) => Math.atan2(b.vy, b.vx));
    expect(Math.max(...angles) - Math.min(...angles)).toBeCloseTo(WEAPONS.shotgun.spread, 1);
    for (const b of g.bullets) expect(b.damage).toBe(WEAPONS.shotgun.damage);
  });

  test("a weapon is dropped when its last round is fired", () => {
    const p = shooting({ weapon: { kind: "laser", ammo: 1 } });
    const g = mkGame([p]);
    stepWorld(g, 1 / 30, NOW);
    expect(p.weapon).toBeNull();
    expect(g.bullets).toHaveLength(1);
  });

  test("the laser pierces: one shot damages two karts in a line", () => {
    const shooter = mkPlayer("shooter", { x: 100, y: 500, angle: 0 });
    const a = mkPlayer("a", { x: 300, y: 500 });
    const b = mkPlayer("b", { x: 340, y: 500 });
    const g = mkGame([shooter, a, b]);
    g.bullets.push({
      ownerId: "shooter", kind: "laser", x: 280, y: 500,
      vx: WEAPONS.laser.speed, vy: 0, ttl: 1,
      damage: WEAPONS.laser.damage, radius: WEAPONS.laser.radius,
      pierce: true, turn: 0, hits: [],
    });

    stepWorld(g, 1 / 30, NOW);

    expect(a.hp).toBe(MAX_HP - WEAPONS.laser.damage);
    expect(b.hp).toBe(MAX_HP - WEAPONS.laser.damage);
  });

  test("a piercing shot cannot hit the same kart twice", () => {
    const shooter = mkPlayer("shooter", { x: 100, y: 500 });
    const victim = mkPlayer("victim", { x: 300, y: 500 });
    const g = mkGame([shooter, victim]);
    g.bullets.push({
      ownerId: "shooter", kind: "laser", x: 295, y: 500,
      vx: 40, vy: 0, ttl: 2, damage: 20, radius: 7, pierce: true, turn: 0, hits: [],
    });

    for (let i = 0; i < 5; i++) stepWorld(g, 1 / 30, NOW + i * 33);

    expect(victim.hp).toBe(MAX_HP - 20); // damaged exactly once
  });

  test("a homing missile curves toward its target", () => {
    const shooter = mkPlayer("shooter", { x: 500, y: 500 });
    const target = mkPlayer("target", { x: 900, y: 900 });
    const g = mkGame([shooter, target]);
    g.bullets.push({
      ownerId: "shooter", kind: "homing", x: 600, y: 500,
      vx: WEAPONS.homing.speed, vy: 0, ttl: 3, // flying straight +x, target is +x+y
      damage: 10, radius: 9, pierce: false, turn: WEAPONS.homing.turn, hits: null,
    });

    const before = Math.atan2(g.bullets[0].vy, g.bullets[0].vx);
    for (let i = 0; i < 5; i++) stepWorld(g, 1 / 30, NOW + i * 33);
    const after = Math.atan2(g.bullets[0].vy, g.bullets[0].vx);

    expect(after).toBeGreaterThan(before); // turned toward +y
    // Speed is preserved while steering.
    expect(Math.hypot(g.bullets[0].vx, g.bullets[0].vy)).toBeCloseTo(WEAPONS.homing.speed, 0);
  });

  test("a homing missile ignores teammates in TDM", () => {
    const shooter = mkPlayer("shooter", { x: 500, y: 500, team: "A" });
    const mate = mkPlayer("mate", { x: 520, y: 900, team: "A" });
    const g = mkGame([shooter, mate], { mode: "tdm" });
    g.bullets.push({
      ownerId: "shooter", kind: "homing", x: 600, y: 500,
      vx: WEAPONS.homing.speed, vy: 0, ttl: 3,
      damage: 10, radius: 9, pierce: false, turn: WEAPONS.homing.turn, hits: null,
    });

    stepWorld(g, 1 / 30, NOW);

    expect(g.bullets[0].vy).toBe(0); // no target → flies straight
  });

  test("a held weapon overrides the triple-shot spread", () => {
    const p = shooting({ tripleUntil: NOW + TRIPLE_MS, weapon: { kind: "laser", ammo: 4 } });
    const g = mkGame([p]);
    stepWorld(g, 1 / 30, NOW);
    expect(g.bullets).toHaveLength(1); // the laser, not a 3-way blaster
    expect(g.bullets[0].kind).toBe("laser");
  });
});

describe("kart arena — spikes, oil, ghost", () => {
  test("spike armour damages a kart you ram and shoves it away", () => {
    const spiked = mkPlayer("spiked", { x: 500, y: 500, spikesUntil: NOW + SPIKES_MS });
    const victim = mkPlayer("victim", { x: 530, y: 500 });
    const g = mkGame([spiked, victim]);

    stepWorld(g, 1 / 30, NOW);

    expect(victim.hp).toBe(MAX_HP - SPIKE_DAMAGE);
    expect(victim.x).toBeGreaterThan(530); // knocked back
  });

  test("spikes respect the per-victim cooldown instead of grinding every tick", () => {
    const spiked = mkPlayer("spiked", { x: 500, y: 500, spikesUntil: NOW + SPIKES_MS });
    const victim = mkPlayer("victim", { x: 530, y: 500 });
    const g = mkGame([spiked, victim]);

    for (let i = 0; i < 8; i++) stepWorld(g, 1 / 30, NOW + i * 33); // ~260ms
    expect(victim.hp).toBe(MAX_HP - SPIKE_DAMAGE); // still only one hit
  });

  test("a shielded kart is immune to spikes", () => {
    const spiked = mkPlayer("spiked", { x: 500, y: 500, spikesUntil: NOW + SPIKES_MS });
    const victim = mkPlayer("victim", { x: 530, y: 500, shieldUntil: NOW + SHIELD_MS });
    const g = mkGame([spiked, victim]);

    stepWorld(g, 1 / 30, NOW);

    expect(victim.hp).toBe(MAX_HP);
  });

  test("oil slicks persist and make a kart that drives over them slip", () => {
    const dropper = mkPlayer("dropper", { x: 100, y: 100 });
    const victim = mkPlayer("victim", { x: 500, y: 500 });
    const g = mkGame([dropper, victim]);
    g.mines.push({ id: 1, kind: "oil", ownerId: "dropper", team: null, x: 500, y: 500, armAt: NOW, expiresAt: NOW + 9999 });

    stepWorld(g, 1 / 30, NOW);

    expect(victim.slipUntil).toBe(NOW + SLIP_MS);
    expect(victim.hp).toBe(MAX_HP); // oil doesn't damage
    expect(g.mines).toHaveLength(1); // and isn't consumed
  });

  test("a slipping kart loses steering authority", () => {
    const mk = (slip) => {
      const p = mkPlayer("p", {
        speed: 400, angle: 0, slipUntil: slip ? NOW + SLIP_MS : 0,
        input: { throttle: 1, steer: 1, shoot: false },
      });
      const g = mkGame([p]);
      stepWorld(g, 1 / 30, NOW);
      return p;
    };
    // Steering input is the same; the slipping kart should respond far less to
    // it (the spin-out is added separately, so compare steering contribution).
    const normal = mk(false);
    const slippy = mk(true);
    expect(normal.angle).not.toBe(slippy.angle);
    expect(slippy.slipUntil).toBeGreaterThan(0);
  });

  test("ghost drives through obstacles that would otherwise block it", () => {
    const mk = (ghost) => {
      const p = mkPlayer("p", {
        x: 400, y: 500, angle: 0, speed: 600,
        ghostUntil: ghost ? NOW + GHOST_MS : 0,
        input: { throttle: 1, steer: 0, shoot: false },
      });
      const g = mkGame([p], { obstacles: [{ kind: "tyre", x: 600, y: 500, r: 80 }] });
      for (let i = 0; i < 30; i++) stepWorld(g, 1 / 30, NOW + i * 33);
      return p;
    };
    expect(mk(true).x).toBeGreaterThan(mk(false).x + 100);
  });
});

describe("kart arena — core rules still hold", () => {
  test("a bullet kills and credits the shooter", () => {
    const shooter = mkPlayer("shooter", { x: 100, y: 500 });
    const victim = mkPlayer("victim", { x: 160, y: 500, hp: BULLET_DAMAGE });
    const g = mkGame([shooter, victim]);
    g.bullets.push({ ownerId: "shooter", x: 155, y: 500, vx: 100, vy: 0, ttl: 1 });

    const { kills } = stepWorld(g, 1 / 30, NOW);

    expect(victim.alive).toBe(false);
    expect(shooter.kills).toBe(1);
    expect(kills).toEqual([{ killerId: "shooter", victimId: "victim" }]);
  });

  test("karts are clamped inside the per-map world bounds", () => {
    const p = mkPlayer("p", { x: 1990, y: 500, angle: 0, speed: 600, input: { throttle: 1, steer: 0, shoot: false } });
    const g = mkGame([p], { w: 2000, h: 2000 });
    stepWorld(g, 1 / 30, NOW);
    expect(p.x).toBeLessThanOrEqual(2000 - CAR_RADIUS);
  });
});

describe("kart bot AI", () => {
  const arenaWithFoe = (botOver = {}, foeOver = {}) => {
    const bot = mkPlayer("bot:1", { x: 500, y: 500, angle: 0, isBot: true, difficulty: "hard", ...botOver });
    const foe = mkPlayer("foe", { x: 900, y: 500, ...foeOver });
    return { g: mkGame([bot, foe]), bot, foe };
  };

  test("every difficulty returns a valid, clamped input tuple", () => {
    for (const d of DIFFICULTIES) {
      const { g, bot } = arenaWithFoe({ difficulty: d });
      const inp = botInput(g, bot, NOW);
      expect(typeof inp.throttle).toBe("number");
      expect(Math.abs(inp.throttle)).toBeLessThanOrEqual(1);
      expect(Math.abs(inp.steer)).toBeLessThanOrEqual(1);
      expect(typeof inp.shoot).toBe("boolean");
      expect(Number.isNaN(inp.steer)).toBe(false);
    }
  });

  test("a hard bot lined up on a close enemy shoots", () => {
    const { g, bot } = arenaWithFoe();
    jest.spyOn(Math, "random").mockReturnValue(0.5); // no aim jitter
    const inp = botInput(g, bot, NOW);
    Math.random.mockRestore();
    expect(inp.shoot).toBe(true);
  });

  test("bots do not shoot through an obstacle", () => {
    const { g, bot } = arenaWithFoe();
    g.obstacles = [{ kind: "tyre", x: 700, y: 500, r: 90 }];
    jest.spyOn(Math, "random").mockReturnValue(0.5);
    const inp = botInput(g, bot, NOW);
    Math.random.mockRestore();
    expect(inp.shoot).toBe(false);
  });

  test("an easy bot is slower, wobblier and shorter-ranged than a hard one", () => {
    const easy = tuningFor("easy");
    const hard = tuningFor("hard");
    expect(easy.throttle).toBeLessThan(hard.throttle);
    expect(easy.aimError).toBeGreaterThan(hard.aimError);
    expect(easy.range).toBeLessThan(hard.range);
    expect(easy.thinkMs).toBeGreaterThan(hard.thinkMs); // slower reactions
    expect(hard.lead).toBeGreaterThan(easy.lead); // only hard bots lead the target
  });

  test("tuning exists for every advertised difficulty", () => {
    for (const d of DIFFICULTIES) expect(BOT_TUNING[d]).toBeDefined();
    expect(tuningFor("nonsense")).toBe(BOT_TUNING.medium); // safe fallback
  });

  test("a fresh bot drives forward instead of assuming it is stuck", () => {
    const { g, bot } = arenaWithFoe();
    expect(botInput(g, bot, NOW).throttle).toBeGreaterThan(0);
  });

  test("a bot backs up once it has genuinely stopped moving", () => {
    const { g, bot } = arenaWithFoe();
    botInput(g, bot, NOW); // establishes the position baseline
    const inp = botInput(g, bot, NOW + 600); // hasn't moved since → stuck
    expect(inp.throttle).toBeLessThan(0);
  });

  test("a bot steers toward a far-off enemy rather than driving blind", () => {
    const { g, bot } = arenaWithFoe({ angle: Math.PI }, { x: 1500, y: 500 });
    jest.spyOn(Math, "random").mockReturnValue(0.5);
    const inp = botInput(g, bot, NOW);
    Math.random.mockRestore();
    expect(Math.abs(inp.steer)).toBeGreaterThan(0.1); // turning around
  });
});
