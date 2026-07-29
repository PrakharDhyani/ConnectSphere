/**
 * Smash Karts — bot driver AI.
 *
 * A bot is an ordinary player in `g.players` (so physics, scoring, powerups and
 * snapshots treat it exactly like a human) that carries `isBot: true` and a
 * `difficulty`. The only difference is WHERE its `input` comes from: instead of
 * arriving over a socket, `botInput()` computes the same
 * `{ throttle, steer, shoot }` tuple the client would have sent.
 *
 * That's the whole trick — because the server was already authoritative over
 * every kart, adding AI required no changes to the simulation at all.
 *
 * Difficulty is a table of knobs, not a different algorithm: how often the bot
 * re-thinks, how much random error it adds to its aim, whether it leads a moving
 * target, how far it will shoot from, and how hard it drives.
 */
import { ARENA_W, ARENA_H, CAR_RADIUS, BULLET_SPEED, BULLET_TTL } from "./kartArena.js";

export const DIFFICULTIES = ["easy", "medium", "hard"];
export const DEFAULT_DIFFICULTY = "medium";

export const BOT_TUNING = {
  easy: {
    thinkMs: 420, // how long between target/route decisions (reaction time)
    aimError: 0.30, // radians of random aim wobble
    aimTolerance: 0.42, // must be within this of the target to pull the trigger
    lead: 0, // 0 = shoots where the target IS, 1 = where it WILL be
    range: 620, // max shooting distance
    throttle: 0.62, // fraction of full throttle it dares to use
    pickupBias: 0.25, // chance it detours for a powerup when healthy
    fleeBelowHp: 25, // hp under which it goes looking for health
    reverseMs: 900, // how long it reverses when stuck
  },
  medium: {
    thinkMs: 220,
    aimError: 0.14,
    aimTolerance: 0.26,
    lead: 0.6,
    range: 900,
    throttle: 0.85,
    pickupBias: 0.5,
    fleeBelowHp: 40,
    reverseMs: 750,
  },
  hard: {
    thinkMs: 90,
    aimError: 0.045,
    aimTolerance: 0.17,
    lead: 1,
    range: 1250,
    throttle: 1,
    pickupBias: 0.75,
    fleeBelowHp: 55,
    reverseMs: 600,
  },
};

export const tuningFor = (d) => BOT_TUNING[d] || BOT_TUNING[DEFAULT_DIFFICULTY];

const TAU = Math.PI * 2;
// Shortest signed angle from a to b, in (-PI, PI].
function angleDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

// Distance from point (x,y) to an obstacle's surface (negative = inside).
function obstacleGap(x, y, o) {
  let cx, cy;
  if (o.x1 !== undefined) {
    const dx = o.x2 - o.x1, dy = o.y2 - o.y1;
    const len2 = dx * dx + dy * dy || 1;
    let t = ((x - o.x1) * dx + (y - o.y1) * dy) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    cx = o.x1 + dx * t; cy = o.y1 + dy * t;
  } else {
    cx = o.x; cy = o.y;
  }
  return Math.hypot(x - cx, y - cy) - o.r;
}

// Is the straight line from the bot to its target blocked by scenery? Sampled
// rather than solved — cheap, and good enough to stop bots shooting walls.
function lineBlocked(g, from, to) {
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  const steps = Math.min(14, Math.max(3, Math.round(dist / 90)));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = from.x + (to.x - from.x) * t;
    const y = from.y + (to.y - from.y) * t;
    for (const o of g.obstacles || []) if (obstacleGap(x, y, o) < 12) return true;
  }
  return false;
}

// Pick what this bot should be driving at right now.
function chooseTarget(g, bot, tune) {
  const enemies = [];
  for (const p of g.players.values()) {
    if (p.id === bot.id || !p.alive) continue;
    if (g.mode === "tdm" && p.team && bot.team && p.team === bot.team) continue;
    enemies.push(p);
  }

  const nearest = (list, mapPt) => {
    let best = null, bestD = Infinity;
    for (const it of list) {
      const pt = mapPt(it);
      const d = Math.hypot(pt.x - bot.x, pt.y - bot.y);
      if (d < bestD) { bestD = d; best = it; }
    }
    return best ? { it: best, d: bestD } : null;
  };

  const pads = (g.pickups || []).filter((p) => p.active);
  const hurt = bot.hp <= tune.fleeBelowHp;

  // Badly hurt → go find health. Otherwise sometimes detour for any powerup.
  if (hurt) {
    const health = nearest(pads.filter((p) => p.type === "health"), (p) => p);
    if (health) return { kind: "pickup", x: health.it.x, y: health.it.y };
  }
  if (bot.wantsPickup) {
    const pad = nearest(pads, (p) => p);
    // Only worth a detour if it's not miles away.
    if (pad && pad.d < 1400) return { kind: "pickup", x: pad.it.x, y: pad.it.y };
  }

  const foe = nearest(enemies, (p) => p);
  if (foe) return { kind: "enemy", x: foe.it.x, y: foe.it.y, player: foe.it, dist: foe.d };

  // Nobody to fight — mill around the arena center so bots never idle.
  return { kind: "roam", x: (g.w || ARENA_W) / 2, y: (g.h || ARENA_H) / 2 };
}

/**
 * Compute this bot's input for the current tick. Mutates only the bot's own
 * scratch fields (`botThinkAt`, `botTarget`, `botStuckAt`, …), never the world.
 */
export function botInput(g, bot, now) {
  const tune = tuningFor(bot.difficulty);

  // ── Think on a timer (this IS the bot's reaction time) ──
  if (!bot.botThinkAt || now >= bot.botThinkAt) {
    bot.botThinkAt = now + tune.thinkMs;
    bot.wantsPickup = Math.random() < tune.pickupBias;
    bot.botTarget = chooseTarget(g, bot, tune);
    bot.botAimJitter = (Math.random() - 0.5) * 2 * tune.aimError;
  }
  const target = bot.botTarget || chooseTarget(g, bot, tune);

  // ── Unstick: if it has barely moved while trying to drive, back up & turn ──
  // The FIRST sample only establishes a baseline — judging "stuck" against a
  // position we just copied from the bot itself would make every fresh spawn
  // reverse for half a second.
  if (!bot.botCheckAt || now >= bot.botCheckAt) {
    const hasBaseline = bot.botLastX !== undefined;
    const movedSq = hasBaseline
      ? (bot.x - bot.botLastX) ** 2 + (bot.y - bot.botLastY) ** 2
      : Infinity;
    bot.botCheckAt = now + 500;
    if (movedSq < 18 * 18 && !bot.botReverseUntil) bot.botReverseUntil = now + tune.reverseMs;
    bot.botLastX = bot.x;
    bot.botLastY = bot.y;
  }
  if (bot.botReverseUntil && now < bot.botReverseUntil) {
    return { throttle: -1, steer: bot.botReverseDir ?? 1, shoot: false };
  }
  if (bot.botReverseUntil && now >= bot.botReverseUntil) {
    bot.botReverseUntil = 0;
    bot.botReverseDir = Math.random() < 0.5 ? -1 : 1;
  }

  // ── Aim ── optionally leading a moving target (harder bots predict).
  let aimX = target.x, aimY = target.y;
  const foe = target.player;
  if (foe && tune.lead > 0) {
    const dist = Math.hypot(foe.x - bot.x, foe.y - bot.y);
    const flight = Math.min(BULLET_TTL, dist / BULLET_SPEED);
    aimX += Math.cos(foe.angle) * foe.speed * flight * tune.lead;
    aimY += Math.sin(foe.angle) * foe.speed * flight * tune.lead;
  }
  const desired = Math.atan2(aimY - bot.y, aimX - bot.x) + (bot.botAimJitter || 0);
  let steer = angleDiff(bot.angle, desired);

  // ── Avoid scenery: steer away from anything close in front ──
  const look = CAR_RADIUS + 70 + Math.abs(bot.speed) * 0.28;
  const aheadX = bot.x + Math.cos(bot.angle) * look;
  const aheadY = bot.y + Math.sin(bot.angle) * look;
  let avoid = 0;
  for (const o of g.obstacles || []) {
    if (obstacleGap(aheadX, aheadY, o) < CAR_RADIUS + 18) {
      // Turn toward whichever side has more room.
      const probe = (sign) => {
        const a = bot.angle + sign * 0.8;
        return obstacleGap(bot.x + Math.cos(a) * look, bot.y + Math.sin(a) * look, o);
      };
      avoid += probe(1) >= probe(-1) ? 1 : -1;
    }
  }
  // Stay off the world edges too.
  const W = g.w || ARENA_W, H = g.h || ARENA_H;
  const edge = 130;
  if (aheadX < edge || aheadX > W - edge || aheadY < edge || aheadY > H - edge) {
    const toCenter = Math.atan2(H / 2 - bot.y, W / 2 - bot.x);
    avoid += angleDiff(bot.angle, toCenter) > 0 ? 1 : -1;
  }
  if (avoid !== 0) steer = Math.sign(avoid) * 1;

  // ── Throttle: ease off for hard turns so it can actually make the corner ──
  const turnPenalty = Math.min(1, Math.abs(steer) / 1.4);
  let throttle = tune.throttle * (1 - 0.55 * turnPenalty);

  // ── Shoot when lined up, in range, and with a clear line ──
  // Weapon choice changes the engagement envelope: a shotgun is only worth
  // firing up close, a homing missile barely needs aiming at all.
  let shoot = false;
  if (foe && target.kind === "enemy") {
    const dist = target.dist ?? Math.hypot(foe.x - bot.x, foe.y - bot.y);
    let range = tune.range;
    let tolerance = tune.aimTolerance;
    switch (bot.weapon?.kind) {
      case "shotgun": range = Math.min(range, 380); tolerance += 0.16; break;
      case "laser": range = Math.max(range, 1400); tolerance *= 0.8; break;
      case "homing": range = Math.max(range, 1600); tolerance += 0.5; break;
      default: break;
    }
    if (dist < range && Math.abs(angleDiff(bot.angle, desired)) < tolerance) {
      shoot = !lineBlocked(g, bot, { x: foe.x, y: foe.y });
    }
    // Spike armour turns ramming into a weapon — charge instead of backing off.
    if (bot.spikesUntil && Date.now() < bot.spikesUntil && dist < 300) throttle = tune.throttle;
    // Don't ram a bomb carrier — back off while its fuse burns.
    else if (foe.bombAt && dist < 260) throttle = -0.6;
  }

  return {
    throttle: Math.max(-1, Math.min(1, throttle)),
    steer: Math.max(-1, Math.min(1, steer)),
    shoot,
  };
}

// Bot display names, picked in order so a lobby reads clearly.
const BOT_NAMES = ["Ace", "Blaze", "Comet", "Dash", "Ember", "Flint"];
export function botName(index, difficulty) {
  const label = { easy: "Easy", medium: "Med", hard: "Hard" }[difficulty] || "Med";
  return `${BOT_NAMES[index % BOT_NAMES.length]} (${label})`;
}
