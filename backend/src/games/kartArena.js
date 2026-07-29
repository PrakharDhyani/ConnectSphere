/**
 * Smash Karts — the pure physics/rules core for a 2D top-down deathmatch arena.
 *
 * This module owns NO sockets and NO per-room registry (that's kart.handlers.js).
 * It exposes world constants and a single `stepWorld(g, dt, now)` that advances
 * one game object by `dt` seconds. Map data (obstacles, spawns, pickups) lives on
 * the game object (`g.obstacles`, `g.spawns`, `g.mode`); see games/kartMaps.js.
 *
 * Coordinate space: a fixed 1600×900 world. Angles are radians; 0 points +x.
 * Everything is arcade: a single speed scalar along the heading, not a full 2D
 * velocity vector — predictable to drive and cheap to simulate.
 */

export const ARENA_W = 1600;
export const ARENA_H = 900;

export const TICK_HZ = 30; // physics steps per second
export const SNAPSHOT_EVERY = 2; // broadcast every Nth tick → ~15 Hz on the wire
export const MATCH_MS = 3 * 60 * 1000; // 3-minute match

// Car dynamics (world units / second). Arcade feel: quick accel, snappy turn.
export const CAR_RADIUS = 20;
export const MAX_SPEED = 520;
export const MAX_REVERSE = 240;
export const ACCEL = 920;
export const BRAKE_FRICTION = 1.8;
export const TURN_RATE = 4.1;

// Blaster.
export const BULLET_SPEED = 820;
export const BULLET_TTL = 1.1;
export const BULLET_RADIUS = 7;
export const BULLET_DAMAGE = 25;
export const FIRE_COOLDOWN = 300;
export const RAPID_COOLDOWN = 120;

// Health / lifecycle.
export const MAX_HP = 100;
export const RESPAWN_MS = 3000;

// Powerup durations / effects.
export const RAPID_MS = 6000; // faster fire rate
export const SPEED_MS = 5000; // top-speed + accel burst
export const SPEED_MULT = 1.6;
export const SHIELD_MS = 5000; // invulnerability
export const HEALTH_AMOUNT = 45;
export const BOMB_FUSE_MS = 5000; // "suicide" pickup: explode after this long
export const BOMB_RADIUS = 180; // blast radius
export const BOMB_DAMAGE = 95; // blast damage to others in range

// Pickups recharge this long after being grabbed.
export const PICKUP_RESPAWN_MS = 8000;

// Seat colors, in pick order.
export const COLORS = ["red", "blue", "green", "yellow", "orange", "purple"];

// Fallback spawns if a game has no map attached (defensive).
export const SPAWN_POINTS = [
  { x: 180, y: 160, angle: 0.4 },
  { x: ARENA_W - 180, y: 160, angle: Math.PI - 0.4 },
  { x: 180, y: ARENA_H - 160, angle: -0.4 },
  { x: ARENA_W - 180, y: ARENA_H - 160, angle: Math.PI + 0.4 },
  { x: ARENA_W / 2, y: 130, angle: Math.PI / 2 },
  { x: ARENA_W / 2, y: ARENA_H - 130, angle: -Math.PI / 2 },
];

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// Nearest point on an obstacle's surface reference (circle center, or closest
// point on a capsule's segment) plus its radius — unifies circle & capsule.
function nearestOnObstacle(x, y, o) {
  if (o.x1 !== undefined) {
    const dx = o.x2 - o.x1, dy = o.y2 - o.y1;
    const len2 = dx * dx + dy * dy || 1;
    let t = ((x - o.x1) * dx + (y - o.y1) * dy) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return { cx: o.x1 + dx * t, cy: o.y1 + dy * t, r: o.r };
  }
  return { cx: o.x, cy: o.y, r: o.r };
}

// Places a player at a spawn point and gives them a full, alive reset.
export function respawnPlayer(p, now, spawnIndex, spawns = SPAWN_POINTS) {
  const s = spawns[spawnIndex % spawns.length];
  p.x = s.x;
  p.y = s.y;
  p.angle = s.angle;
  p.speed = 0;
  p.hp = MAX_HP;
  p.alive = true;
  p.respawnAt = 0;
  p.rapidUntil = 0;
  p.speedUntil = 0;
  p.shieldUntil = 0;
  p.bombAt = 0;
  p.input = { throttle: 0, steer: 0, shoot: false };
}

// Detonate a bomb carrier: area damage to non-teammates in range, self dies.
function detonate(g, bomber, now, kills, booms) {
  booms.push({ x: bomber.x, y: bomber.y });
  for (const q of g.players.values()) {
    if (q.id === bomber.id || !q.alive) continue;
    if (g.mode === "tdm" && q.team && q.team === bomber.team) continue; // no friendly fire
    if (now < q.shieldUntil) continue; // shielded survivors
    const dx = q.x - bomber.x, dy = q.y - bomber.y;
    if (dx * dx + dy * dy > BOMB_RADIUS * BOMB_RADIUS) continue;
    q.hp -= BOMB_DAMAGE;
    if (q.hp <= 0) {
      q.hp = 0;
      q.alive = false;
      q.deaths += 1;
      q.respawnAt = now + RESPAWN_MS;
      bomber.kills += 1;
      kills.push({ killerId: bomber.id, victimId: q.id });
    }
  }
  bomber.alive = false;
  bomber.bombAt = 0;
  bomber.deaths += 1;
  bomber.respawnAt = now + RESPAWN_MS;
}

// Advance the whole world by dt seconds. Mutates `g`. Returns { kills, booms }
// so the caller can announce kills and spawn blast effects.
export function stepWorld(g, dt, now) {
  const kills = [];
  const booms = [];
  const spawns = g.spawns || SPAWN_POINTS;
  const obstacles = g.obstacles || [];
  const tdm = g.mode === "tdm";
  const players = [...g.players.values()];

  // ── Cars ──
  for (const p of players) {
    if (!p.alive) {
      if (now >= p.respawnAt) respawnPlayer(p, now, p.seatIndex, spawns);
      continue;
    }

    // Bomb fuse.
    if (p.bombAt && now >= p.bombAt) {
      detonate(g, p, now, kills, booms);
      continue;
    }

    const inp = p.input || { throttle: 0, steer: 0, shoot: false };
    const boosted = now < p.speedUntil;
    const accel = boosted ? ACCEL * SPEED_MULT : ACCEL;
    const maxSpeed = boosted ? MAX_SPEED * SPEED_MULT : MAX_SPEED;

    p.speed += (inp.throttle || 0) * accel * dt;
    if (!inp.throttle) p.speed -= p.speed * clamp(BRAKE_FRICTION * dt, 0, 1);
    p.speed = clamp(p.speed, -MAX_REVERSE, maxSpeed);

    const grip = clamp(0.35 + Math.abs(p.speed) / 240, 0.35, 1);
    const dir = p.speed >= 0 ? 1 : -1;
    p.angle += (inp.steer || 0) * TURN_RATE * dt * grip * dir;

    p.x += Math.cos(p.angle) * p.speed * dt;
    p.y += Math.sin(p.angle) * p.speed * dt;

    // Arena walls.
    if (p.x < CAR_RADIUS) { p.x = CAR_RADIUS; p.speed *= 0.3; }
    if (p.x > ARENA_W - CAR_RADIUS) { p.x = ARENA_W - CAR_RADIUS; p.speed *= 0.3; }
    if (p.y < CAR_RADIUS) { p.y = CAR_RADIUS; p.speed *= 0.3; }
    if (p.y > ARENA_H - CAR_RADIUS) { p.y = ARENA_H - CAR_RADIUS; p.speed *= 0.3; }

    // Obstacles — push the car back out and bleed speed on contact.
    for (const o of obstacles) {
      const n = nearestOnObstacle(p.x, p.y, o);
      const dx = p.x - n.cx, dy = p.y - n.cy;
      const d2 = dx * dx + dy * dy;
      const minD = CAR_RADIUS + n.r;
      if (d2 < minD * minD && d2 > 0.01) {
        const d = Math.sqrt(d2);
        p.x = n.cx + (dx / d) * minD;
        p.y = n.cy + (dy / d) * minD;
        p.speed *= 0.35;
      }
    }

    // Fire.
    if (inp.shoot) {
      const cd = now < p.rapidUntil ? RAPID_COOLDOWN : FIRE_COOLDOWN;
      if (now - p.lastFire >= cd) {
        p.lastFire = now;
        g.bullets.push({
          ownerId: p.id,
          x: p.x + Math.cos(p.angle) * (CAR_RADIUS + 4),
          y: p.y + Math.sin(p.angle) * (CAR_RADIUS + 4),
          vx: Math.cos(p.angle) * BULLET_SPEED,
          vy: Math.sin(p.angle) * BULLET_SPEED,
          ttl: BULLET_TTL,
        });
      }
    }
  }

  // ── Bullets ──
  const liveBullets = [];
  for (const b of g.bullets) {
    b.ttl -= dt;
    if (b.ttl <= 0) continue;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    if (b.x < 0 || b.x > ARENA_W || b.y < 0 || b.y > ARENA_H) continue;

    // Obstacles block bullets.
    let blocked = false;
    for (const o of obstacles) {
      const n = nearestOnObstacle(b.x, b.y, o);
      const dx = b.x - n.cx, dy = b.y - n.cy;
      if (dx * dx + dy * dy <= (n.r + BULLET_RADIUS) ** 2) { blocked = true; break; }
    }
    if (blocked) continue;

    const owner = g.players.get(b.ownerId);
    let consumed = false;
    for (const p of players) {
      if (!p.alive || p.id === b.ownerId) continue;
      if (tdm && p.team && owner && p.team === owner.team) continue; // no friendly fire
      const dx = p.x - b.x, dy = p.y - b.y;
      if (dx * dx + dy * dy <= (CAR_RADIUS + BULLET_RADIUS) ** 2) {
        consumed = true;
        if (now < p.shieldUntil) break; // shield absorbs the shot
        p.hp -= BULLET_DAMAGE;
        if (p.hp <= 0) {
          p.hp = 0;
          p.alive = false;
          p.deaths += 1;
          p.respawnAt = now + RESPAWN_MS;
          if (owner) owner.kills += 1;
          kills.push({ killerId: b.ownerId, victimId: p.id });
        }
        break;
      }
    }
    if (!consumed) liveBullets.push(b);
  }
  g.bullets = liveBullets;

  // ── Pickups ──
  for (const pad of g.pickups) {
    if (!pad.active) {
      if (now >= pad.readyAt) pad.active = true;
      continue;
    }
    for (const p of players) {
      if (!p.alive) continue;
      const dx = p.x - pad.x, dy = p.y - pad.y;
      if (dx * dx + dy * dy > (CAR_RADIUS + 24) ** 2) continue;
      switch (pad.type) {
        case "health": p.hp = clamp(p.hp + HEALTH_AMOUNT, 0, MAX_HP); break;
        case "rapid": p.rapidUntil = now + RAPID_MS; break;
        case "speed": p.speedUntil = now + SPEED_MS; break;
        case "shield": p.shieldUntil = now + SHIELD_MS; break;
        case "bomb": if (!p.bombAt) p.bombAt = now + BOMB_FUSE_MS; break;
        default: break;
      }
      pad.active = false;
      pad.readyAt = now + PICKUP_RESPAWN_MS;
      break;
    }
  }

  return { kills, booms };
}
