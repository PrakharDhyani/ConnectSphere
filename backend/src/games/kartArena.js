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
// Retuned for the 10x-area maps: faster cruise + longer-reaching bullets so
// the bigger world still plays fast. (Barrier capsule radii were bumped with
// this — contact band must exceed max distance-per-tick to avoid tunneling.)
export const CAR_RADIUS = 20;
export const MAX_SPEED = 660;
export const MAX_REVERSE = 300;
export const ACCEL = 1150;
export const BRAKE_FRICTION = 1.8;
export const TURN_RATE = 4.1;

// Blaster.
export const BULLET_SPEED = 980;
export const BULLET_TTL = 1.35;
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
export const SHIELD_MS = 5000; // invulnerability — blocks bullets, bombs AND mines
export const HEALTH_AMOUNT = 45;
export const BOMB_FUSE_MS = 5000; // "suicide" pickup: explode after this long
export const BOMB_RADIUS = 180; // blast radius
export const BOMB_DAMAGE = 95; // blast damage to others in range

// Triple shot — every shot becomes a 3-way spread.
export const TRIPLE_MS = 8000;
export const TRIPLE_SPREAD = 0.17; // radians between spread bullets

// Freeze (EMP) — detonates on pickup, locking nearby enemies in place.
export const FREEZE_MS = 1900; // how long victims stay frozen
export const FREEZE_RADIUS = 340;

// Mines — grabbing the pack lays a short trail of proximity mines behind you.
export const MINE_COUNT = 3; // mines dropped per pickup
export const MINE_DROP_GAP_MS = 550; // spacing between drops
export const MINE_ARM_MS = 700; // can't hurt anyone until armed
export const MINE_TTL_MS = 25000;
export const MINE_TRIGGER = 34; // proximity radius that sets it off
export const MINE_BLAST_RADIUS = 130;
export const MINE_DAMAGE = 65;

// ── Weapons ──
// A weapon REPLACES the default blaster until its ammo runs out, so picking one
// up is a real commitment (you trade your reliable pea-shooter for something
// situational). Each is defined purely by these numbers; `fireWeapon()` reads
// the table, so adding a weapon never touches the collision or damage code.
export const WEAPONS = {
  shotgun: {
    ammo: 8, cooldown: 620, pellets: 5, spread: 0.3,
    speed: 900, ttl: 0.4, damage: 17, radius: 6,
  },
  laser: {
    // Railgun: hypersonic and PIERCES — one shot can skewer a whole line.
    ammo: 4, cooldown: 850, pellets: 1, spread: 0,
    speed: 2300, ttl: 0.55, damage: 52, radius: 7, pierce: true,
  },
  homing: {
    // Slow, but it turns to chase the nearest enemy.
    ammo: 3, cooldown: 1150, pellets: 1, spread: 0,
    speed: 560, ttl: 3.2, damage: 58, radius: 9, turn: 2.9,
  },
};

// Spike armour — a ring of spikes that damages anything you ram.
export const SPIKES_MS = 9000;
export const SPIKE_REACH = 18; // beyond the car radius
export const SPIKE_DAMAGE = 34;
export const SPIKE_HIT_COOLDOWN = 700; // per victim, so contact isn't per-tick
export const SPIKE_KNOCKBACK = 300;

// Oil slicks — dropped behind you; victims lose grip and spin out.
export const OIL_COUNT = 3;
export const OIL_DROP_GAP_MS = 420;
export const OIL_TTL_MS = 20000;
export const OIL_RADIUS = 48;
export const SLIP_MS = 1300;

// Ghost — near-invisible and able to drive through scenery.
export const GHOST_MS = 6500;

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
  p.tripleUntil = 0;
  p.frozenUntil = 0;
  p.minesLeft = 0;
  p.nextMineAt = 0;
  p.weapon = null;
  p.spikesUntil = 0;
  p.slipUntil = 0;
  p.ghostUntil = 0;
  p.oilLeft = 0;
  p.nextOilAt = 0;
  p.spikeHits = {};
  p.input = { throttle: 0, steer: 0, shoot: false };
}

// Area damage shared by bombs and mines. Skips the owner, teammates (in TDM)
// and SHIELDED players — a shield makes you immune to explosive damage, not
// just bullets. Returns the kills it caused.
function areaDamage(g, { x, y, radius, damage, ownerId, team }, now, kills) {
  for (const q of g.players.values()) {
    if (q.id === ownerId || !q.alive) continue;
    if (g.mode === "tdm" && q.team && team && q.team === team) continue; // no friendly fire
    if (now < q.shieldUntil) continue; // shielded → takes nothing
    const dx = q.x - x, dy = q.y - y;
    if (dx * dx + dy * dy > radius * radius) continue;
    q.hp -= damage;
    if (q.hp <= 0) {
      q.hp = 0;
      q.alive = false;
      q.deaths += 1;
      q.respawnAt = now + RESPAWN_MS;
      const owner = g.players.get(ownerId);
      if (owner) owner.kills += 1;
      kills.push({ killerId: ownerId, victimId: q.id });
    }
  }
}

// Detonate a bomb carrier: area damage to non-teammates in range, self dies.
// NOTE: a shielded victim survives untouched (see areaDamage) — the shield is
// the hard counter to the suicide bomb.
function detonate(g, bomber, now, kills, booms) {
  booms.push({ x: bomber.x, y: bomber.y, big: true });
  areaDamage(
    g,
    { x: bomber.x, y: bomber.y, radius: BOMB_RADIUS, damage: BOMB_DAMAGE, ownerId: bomber.id, team: bomber.team },
    now,
    kills
  );
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
  if (!g.mines) g.mines = [];
  if (g.nextMineId === undefined) g.nextMineId = 1;
  // Per-map world size (curvy maps are bigger); default rectangle otherwise.
  const W = g.w || ARENA_W;
  const H = g.h || ARENA_H;
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

    // Frozen by an EMP: controls are dead and the kart coasts to a stop.
    const frozen = now < p.frozenUntil;
    const inp = frozen ? { throttle: 0, steer: 0, shoot: false } : (p.input || { throttle: 0, steer: 0, shoot: false });
    if (frozen) p.speed -= p.speed * clamp(6 * dt, 0, 1);
    const boosted = now < p.speedUntil;
    const accel = boosted ? ACCEL * SPEED_MULT : ACCEL;
    const maxSpeed = boosted ? MAX_SPEED * SPEED_MULT : MAX_SPEED;

    p.speed += (inp.throttle || 0) * accel * dt;
    if (!inp.throttle) p.speed -= p.speed * clamp(BRAKE_FRICTION * dt, 0, 1);
    p.speed = clamp(p.speed, -MAX_REVERSE, maxSpeed);

    // Oil makes the kart skate: steering barely bites and it spins slowly.
    const slipping = now < p.slipUntil;
    const grip = clamp(0.35 + Math.abs(p.speed) / 240, 0.35, 1) * (slipping ? 0.25 : 1);
    const dir = p.speed >= 0 ? 1 : -1;
    p.angle += (inp.steer || 0) * TURN_RATE * dt * grip * dir;
    if (slipping) p.angle += 2.4 * dt; // the spin-out

    p.x += Math.cos(p.angle) * p.speed * dt;
    p.y += Math.sin(p.angle) * p.speed * dt;

    // ── Collision ──────────────────────────────────────────────────────────
    // Karts SLIDE along surfaces instead of being stopped dead by them.
    //
    // The old code did `p.speed *= 0.35` on every contact, every tick. Because
    // steering effectiveness scales with speed, a kart that touched a wall lost
    // its speed, then couldn't turn, then stayed touching the wall — pinned,
    // "unable to move forward". Worse, a chain of barrier capsules (a curvy
    // track edge is ~80 of them) applied the penalty once PER capsule, so the
    // factor compounded to 0.35^n and glued the kart instantly.
    //
    // Now: push out of the surface, then scale speed by how HEAD-ON the contact
    // was — 1 = driving straight into it (lose most speed), 0 = parallel scrape
    // (lose almost nothing). The penalty is applied once per tick using the
    // worst contact, so overlapping capsules can't compound.
    const travelDir = p.speed < 0 ? -1 : 1;
    // `nx, ny` = outward surface normal (points away from the obstacle).
    const headOnAgainst = (nx, ny) =>
      -(Math.cos(p.angle) * nx + Math.sin(p.angle) * ny) * travelDir;
    let worstAlign = 0;

    // World bounds (shaped maps enforce their real edge via barrier capsules;
    // this clamp is the outer safety net).
    if (p.x < CAR_RADIUS) { p.x = CAR_RADIUS; worstAlign = Math.max(worstAlign, headOnAgainst(1, 0)); }
    if (p.x > W - CAR_RADIUS) { p.x = W - CAR_RADIUS; worstAlign = Math.max(worstAlign, headOnAgainst(-1, 0)); }
    if (p.y < CAR_RADIUS) { p.y = CAR_RADIUS; worstAlign = Math.max(worstAlign, headOnAgainst(0, 1)); }
    if (p.y > H - CAR_RADIUS) { p.y = H - CAR_RADIUS; worstAlign = Math.max(worstAlign, headOnAgainst(0, -1)); }

    // Ghost drives straight through scenery (world bounds still apply).
    for (const o of (now < p.ghostUntil ? [] : obstacles)) {
      const n = nearestOnObstacle(p.x, p.y, o);
      let dx = p.x - n.cx, dy = p.y - n.cy;
      const d2 = dx * dx + dy * dy;
      const minD = CAR_RADIUS + n.r;
      if (d2 >= minD * minD) continue;

      const d = Math.sqrt(d2);
      if (d < 0.01) {
        // Dead centre (spawned inside it): shove out opposite the heading
        // rather than dividing by ~0 and flinging the kart across the map.
        dx = -Math.cos(p.angle); dy = -Math.sin(p.angle);
      } else {
        dx /= d; dy /= d;
      }
      p.x = n.cx + dx * minD;
      p.y = n.cy + dy * minD;
      worstAlign = Math.max(worstAlign, headOnAgainst(dx, dy));
    }

    if (worstAlign > 0) p.speed *= 1 - 0.85 * worstAlign;

    // Lay the mine trail behind the kart, one at a time.
    if (p.minesLeft > 0 && now >= p.nextMineAt) {
      p.minesLeft -= 1;
      p.nextMineAt = now + MINE_DROP_GAP_MS;
      g.mines.push({
        id: g.nextMineId++,
        kind: "mine",
        ownerId: p.id,
        team: p.team,
        x: p.x - Math.cos(p.angle) * (CAR_RADIUS + 14),
        y: p.y - Math.sin(p.angle) * (CAR_RADIUS + 14),
        armAt: now + MINE_ARM_MS,
        expiresAt: now + MINE_TTL_MS,
      });
    }

    // Oil slicks ride the same entity list as mines — same lifecycle, different
    // payload (slip instead of blast).
    if (p.oilLeft > 0 && now >= p.nextOilAt) {
      p.oilLeft -= 1;
      p.nextOilAt = now + OIL_DROP_GAP_MS;
      g.mines.push({
        id: g.nextMineId++,
        kind: "oil",
        ownerId: p.id,
        team: p.team,
        x: p.x - Math.cos(p.angle) * (CAR_RADIUS + 16),
        y: p.y - Math.sin(p.angle) * (CAR_RADIUS + 16),
        armAt: now, // slicks are slippery the moment they land
        expiresAt: now + OIL_TTL_MS,
      });
    }

    // Fire. A held weapon replaces the blaster until its ammo runs out;
    // otherwise it's the default blaster (3-way while triple shot is active).
    if (inp.shoot) {
      const w = p.weapon && WEAPONS[p.weapon.kind] ? WEAPONS[p.weapon.kind] : null;
      const cd = w ? w.cooldown : (now < p.rapidUntil ? RAPID_COOLDOWN : FIRE_COOLDOWN);
      if (now - p.lastFire >= cd) {
        p.lastFire = now;
        const spec = w || {
          pellets: 1, spread: 0, speed: BULLET_SPEED, ttl: BULLET_TTL,
          damage: BULLET_DAMAGE, radius: BULLET_RADIUS,
        };
        // Offsets: an explicit spread for multi-pellet weapons, or the triple
        // shot's fixed 3-way for the plain blaster.
        let offsets;
        if (spec.pellets > 1) {
          offsets = [];
          // `spread` is the TOTAL cone angle, so pellets span ±spread/2.
          for (let i = 0; i < spec.pellets; i++) {
            offsets.push(spec.spread * (i / (spec.pellets - 1) - 0.5));
          }
        } else if (!w && now < p.tripleUntil) {
          offsets = [-TRIPLE_SPREAD, 0, TRIPLE_SPREAD];
        } else {
          offsets = [0];
        }
        for (const off of offsets) {
          const a = p.angle + off;
          g.bullets.push({
            ownerId: p.id,
            kind: p.weapon?.kind || "blaster",
            x: p.x + Math.cos(a) * (CAR_RADIUS + 4),
            y: p.y + Math.sin(a) * (CAR_RADIUS + 4),
            vx: Math.cos(a) * spec.speed,
            vy: Math.sin(a) * spec.speed,
            ttl: spec.ttl,
            damage: spec.damage,
            radius: spec.radius,
            pierce: Boolean(spec.pierce),
            turn: spec.turn || 0,
            hits: spec.pierce ? [] : null,
          });
        }
        if (p.weapon) {
          p.weapon.ammo -= 1;
          if (p.weapon.ammo <= 0) p.weapon = null;
        }
      }
    }
  }

  // ── Spike armour ── ramming damage, with a per-victim cooldown so contact
  // doesn't drain 30 hits a second.
  for (const p of players) {
    if (!p.alive || !(now < p.spikesUntil)) continue;
    p.spikeHits ||= {};
    for (const q of players) {
      if (q.id === p.id || !q.alive) continue;
      if (tdm && q.team && p.team && q.team === p.team) continue;
      if (now < q.shieldUntil) continue; // shield turns the spikes aside
      const dx = q.x - p.x, dy = q.y - p.y;
      const dist = Math.hypot(dx, dy);
      if (dist > CAR_RADIUS * 2 + SPIKE_REACH) continue;
      if (now - (p.spikeHits[q.id] || 0) < SPIKE_HIT_COOLDOWN) continue;
      p.spikeHits[q.id] = now;
      q.hp -= SPIKE_DAMAGE;
      // Shove the victim clear so they aren't ground down while overlapping.
      const nx = dist > 0.01 ? dx / dist : 1;
      const ny = dist > 0.01 ? dy / dist : 0;
      q.x += nx * 26;
      q.y += ny * 26;
      q.speed *= 0.4;
      if (q.hp <= 0) {
        q.hp = 0;
        q.alive = false;
        q.deaths += 1;
        q.respawnAt = now + RESPAWN_MS;
        p.kills += 1;
        kills.push({ killerId: p.id, victimId: q.id });
      }
    }
  }

  // ── Ground hazards (mines + oil slicks) ──
  // Mines detonate once armed; slicks stay put and make you skate. Shielded
  // karts ignore both.
  if (g.mines?.length) {
    const liveMines = [];
    for (const m of g.mines) {
      if (now >= m.expiresAt) continue;

      if (m.kind === "oil") {
        for (const p of players) {
          if (!p.alive || p.id === m.ownerId) continue;
          if (tdm && p.team && m.team && p.team === m.team) continue;
          if (now < p.shieldUntil) continue;
          const dx = p.x - m.x, dy = p.y - m.y;
          if (dx * dx + dy * dy <= (OIL_RADIUS + CAR_RADIUS) ** 2) p.slipUntil = now + SLIP_MS;
        }
        liveMines.push(m); // slicks are not consumed
        continue;
      }

      let triggered = false;
      if (now >= m.armAt) {
        for (const p of players) {
          if (!p.alive || p.id === m.ownerId) continue;
          if (tdm && p.team && m.team && p.team === m.team) continue;
          if (now < p.shieldUntil) continue; // shield → drives straight over it
          const dx = p.x - m.x, dy = p.y - m.y;
          if (dx * dx + dy * dy <= (MINE_TRIGGER + CAR_RADIUS) ** 2) { triggered = true; break; }
        }
      }
      if (!triggered) { liveMines.push(m); continue; }
      booms.push({ x: m.x, y: m.y, big: false });
      areaDamage(
        g,
        { x: m.x, y: m.y, radius: MINE_BLAST_RADIUS, damage: MINE_DAMAGE, ownerId: m.ownerId, team: m.team },
        now,
        kills
      );
    }
    g.mines = liveMines;
  }

  // ── Bullets ──
  const liveBullets = [];
  for (const b of g.bullets) {
    b.ttl -= dt;
    if (b.ttl <= 0) continue;

    const owner = g.players.get(b.ownerId);
    const dmg = b.damage ?? BULLET_DAMAGE;
    const rad = b.radius ?? BULLET_RADIUS;

    // Homing missiles steer toward the nearest valid target.
    if (b.turn) {
      let best = null, bestD = Infinity;
      for (const p of players) {
        if (!p.alive || p.id === b.ownerId) continue;
        if (tdm && p.team && owner && p.team === owner.team) continue;
        const d = Math.hypot(p.x - b.x, p.y - b.y);
        if (d < bestD) { bestD = d; best = p; }
      }
      if (best) {
        const speed = Math.hypot(b.vx, b.vy) || 1;
        const cur = Math.atan2(b.vy, b.vx);
        const want = Math.atan2(best.y - b.y, best.x - b.x);
        let diff = want - cur;
        while (diff > Math.PI) diff -= 2 * Math.PI;
        while (diff < -Math.PI) diff += 2 * Math.PI;
        const step = Math.max(-b.turn * dt, Math.min(b.turn * dt, diff));
        const a = cur + step;
        b.vx = Math.cos(a) * speed;
        b.vy = Math.sin(a) * speed;
      }
    }

    // ── Swept movement ──
    // Advance in sub-steps so a fast round can't tunnel through a target. The
    // laser covers ~77u in one 30 Hz tick while a kart is only ~54u across, so
    // a single position check per tick would miss most of its shots.
    const travel = Math.hypot(b.vx, b.vy) * dt;
    const subSteps = Math.min(8, Math.max(1, Math.ceil(travel / CAR_RADIUS)));
    const sdt = dt / subSteps;
    let consumed = false;
    let gone = false;

    for (let s = 0; s < subSteps && !consumed && !gone; s++) {
      b.x += b.vx * sdt;
      b.y += b.vy * sdt;
      if (b.x < 0 || b.x > W || b.y < 0 || b.y > H) { gone = true; break; }

      // Obstacles block bullets.
      for (const o of obstacles) {
        const n = nearestOnObstacle(b.x, b.y, o);
        const dx = b.x - n.cx, dy = b.y - n.cy;
        if (dx * dx + dy * dy <= (n.r + rad) ** 2) { gone = true; break; }
      }
      if (gone) break;

      for (const p of players) {
        if (!p.alive || p.id === b.ownerId) continue;
        if (tdm && p.team && owner && p.team === owner.team) continue; // no friendly fire
        // A piercing shot passes through, but must not re-hit the same kart.
        if (b.pierce && b.hits.includes(p.id)) continue;
        const dx = p.x - b.x, dy = p.y - b.y;
        if (dx * dx + dy * dy > (CAR_RADIUS + rad) ** 2) continue;

        if (b.pierce) b.hits.push(p.id);
        else consumed = true;

        if (now < p.shieldUntil) break; // shield absorbs the shot
        p.hp -= dmg;
        if (p.hp <= 0) {
          p.hp = 0;
          p.alive = false;
          p.deaths += 1;
          p.respawnAt = now + RESPAWN_MS;
          if (owner) owner.kills += 1;
          kills.push({ killerId: b.ownerId, victimId: p.id });
        }
        if (!b.pierce) break;
      }
    }
    if (!consumed && !gone) liveBullets.push(b);
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
        case "triple": p.tripleUntil = now + TRIPLE_MS; break;
        case "mine": p.minesLeft = MINE_COUNT; p.nextMineAt = now; break;
        case "oil": p.oilLeft = OIL_COUNT; p.nextOilAt = now; break;
        case "spikes": p.spikesUntil = now + SPIKES_MS; p.spikeHits = {}; break;
        case "ghost": p.ghostUntil = now + GHOST_MS; break;
        case "shotgun": case "laser": case "homing":
          p.weapon = { kind: pad.type, ammo: WEAPONS[pad.type].ammo };
          break;
        case "freeze":
          // EMP: detonates immediately, locking every nearby enemy in place.
          booms.push({ x: p.x, y: p.y, big: false, freeze: true });
          for (const q of players) {
            if (q.id === p.id || !q.alive) continue;
            if (tdm && q.team && p.team && q.team === p.team) continue;
            if (now < q.shieldUntil) continue; // shield blocks the freeze too
            const ddx = q.x - p.x, ddy = q.y - p.y;
            if (ddx * ddx + ddy * ddy <= FREEZE_RADIUS * FREEZE_RADIUS) q.frozenUntil = now + FREEZE_MS;
          }
          break;
        default: break;
      }
      pad.active = false;
      pad.readyAt = now + PICKUP_RESPAWN_MS;
      break;
    }
  }

  return { kills, booms };
}
