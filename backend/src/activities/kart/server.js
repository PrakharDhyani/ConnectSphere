/**
 * Smash Karts — server module. THE LAST MIGRATION, and the only activity that
 * runs its own server-side simulation.
 *
 * Everything else on the plugin host is event-driven: something happens because
 * someone did something. Kart runs a fixed 30 Hz `setInterval` that advances
 * physics whether or not anyone speaks, and streams a world snapshot at ~15 Hz.
 * That single fact is why the migration plan scheduled it last and called its
 * `destroy()` "the reference lifecycle test".
 *
 * THE OBLIGATION THAT MAKES THIS DIFFERENT
 * A leaked `setTimeout` fires once into an empty room — wasteful, bounded. A
 * leaked `setInterval` running physics for ten karts burns CPU for the life of
 * the *process*, and nothing in the logs ever mentions it: the room is gone,
 * the players left, and a core is quietly pinned. `destroy()` clearing the loop
 * is the whole reason the host owns teardown instead of each plugin, and this
 * is the plugin that proves it works.
 *
 * WHY THE STREAM NEEDED A NEW SDK CAPABILITY
 * The legacy handler used `io.to(room).volatile.emit(...)`. Volatile means a
 * congested client DROPS stale frames rather than queueing them — for a
 * continuous simulation that is the difference between degrading and breaking,
 * because a reliable queue on bad wifi grows forever and the player ends up
 * watching a match seconds behind real time. No plugin had ever needed it (all
 * previous traffic was discrete events that must arrive), so this migration
 * added `detached().stream()` to the SDK. It is deliberately not the default:
 * lobby and end-of-match broadcasts must be reliable.
 *
 * TRANSPORT-ONLY DIFF, as with skribbl (§52) and ludo (§53). `stepWorld`,
 * `botInput`, the maps and the arena rules are untouched imports — the physics
 * is not this file's business and was never coupled to sockets.
 *
 *   io.to(roomKey(roomId)).emit("kart:x")           -> bus.broadcast("x")
 *   io.to(roomKey(roomId)).volatile.emit("kart:x")  -> bus.stream("x")
 *   canAccessRoom / socket.rooms / allow()          -> deleted; the host does it
 */
import {
  COLORS,
  MAX_HP,
  MATCH_MS,
  TICK_HZ,
  SNAPSHOT_EVERY,
  stepWorld,
  respawnPlayer,
} from "../../games/kartArena.js";
import { MAPS, DEFAULT_MAP, getMap } from "../../games/kartMaps.js";
import { botInput, botName, DIFFICULTIES, DEFAULT_DIFFICULTY } from "../../games/kartBot.js";

/** roomId -> game. Ephemeral: a match is 3 minutes of live physics. */
const games = new Map();

const MODES = new Set(["ffa", "tdm"]);
const MAX_KARTS = 10;

// Host-editable match length, clamped to something sane.
const MIN_MATCH_S = 60;
const MAX_MATCH_S = 600;
const cleanTeamName = (s) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, 16);

const isBotId = (id) => typeof id === "string" && id.startsWith("bot:");
const humanPlayers = (g) => [...g.players.values()].filter((p) => !p.isBot);

/**
 * Attach a map to a game. Every map-derived field must be set HERE — the world
 * size included: a map swap that updated obstacles/spawns but kept the previous
 * map's w/h clamped karts outside the new arena (spawning them inside barriers,
 * unable to move).
 */
function applyMap(g, mapId) {
  const map = getMap(mapId);
  g.mapId = map.id;
  g.map = map;
  g.obstacles = map.obstacles;
  g.spawns = map.spawns;
  g.w = map.w;
  g.h = map.h;
  return map;
}

function newGame(hostId) {
  const map = getMap(DEFAULT_MAP);
  return {
    status: "lobby", // "lobby" | "playing" | "ended"
    hostId,
    mapId: map.id,
    mode: "ffa",
    matchMs: MATCH_MS,
    teamNames: { A: "Team A", B: "Team B" },
    map,
    obstacles: map.obstacles,
    spawns: map.spawns,
    w: map.w,
    h: map.h,
    players: new Map(), // userId -> player
    bullets: [],
    mines: [],
    nextMineId: 1,
    nextBotId: 1,
    pickups: [],
    startedAt: 0,
    endsAt: 0,
    winnerId: null,
    winnerTeam: null,
    loop: null,
    tick: 0,
    // Per-room settings from the manifest's configSchema, read at join.
    maxKarts: MAX_KARTS,
    allowBots: true,
    /**
     * The detached broadcaster, refreshed on every join.
     *
     * More load-bearing here than anywhere else: the physics loop speaks ~15
     * times a second from a timer that outlives every request, and a match runs
     * for minutes after the socket that started it may have gone.
     */
    bus: null,
  };
}

function newPlayer(id, name, color, seatIndex, spawns, opts = {}) {
  const s = spawns[seatIndex % spawns.length];
  return {
    id, name, color, seatIndex,
    x: s.x, y: s.y, angle: 0, speed: 0,
    hp: MAX_HP,
    alive: false,
    kills: 0, deaths: 0,
    lastFire: 0,
    rapidUntil: 0, speedUntil: 0, shieldUntil: 0, bombAt: 0,
    tripleUntil: 0, frozenUntil: 0, minesLeft: 0, nextMineAt: 0,
    team: null,
    isBot: Boolean(opts.isBot),
    difficulty: opts.difficulty || null,
    input: { throttle: 0, steer: 0, shoot: false },
  };
}

function freeSeat(g) {
  const used = new Set([...g.players.values()].map((p) => p.color));
  const color = COLORS.find((c) => !used.has(c));
  return color ? { color, seatIndex: COLORS.indexOf(color) } : null;
}

/** Balance a late-joiner onto the smaller team (TDM only). */
function smallerTeam(g) {
  let a = 0, b = 0;
  for (const p of g.players.values()) { if (p.team === "A") a++; else if (p.team === "B") b++; }
  return a <= b ? "A" : "B";
}

/** Respect the host's manual picks; balance everyone else onto the smaller team. */
function assignTeams(g) {
  const players = [...g.players.values()];
  let a = players.filter((p) => p.team === "A").length;
  let b = players.filter((p) => p.team === "B").length;
  for (const p of players) {
    if (p.team === "A" || p.team === "B") continue;
    if (a <= b) { p.team = "A"; a += 1; } else { p.team = "B"; b += 1; }
  }
}

function teamScores(g) {
  let A = 0, B = 0;
  for (const p of g.players.values()) { if (p.team === "A") A += p.kills; else if (p.team === "B") B += p.kills; }
  return { A, B };
}

function snapshot(g, now = Date.now()) {
  return {
    status: g.status,
    hostId: g.hostId,
    mapId: g.mapId,
    mode: g.mode,
    matchMs: g.matchMs,
    teamNames: g.teamNames,
    timeLeft: g.status === "playing" ? Math.max(0, g.endsAt - now) : 0,
    winnerId: g.winnerId,
    winnerTeam: g.winnerTeam,
    teamScores: g.mode === "tdm" ? teamScores(g) : null,
    players: [...g.players.values()]
      .map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        team: p.team,
        x: Math.round(p.x),
        y: Math.round(p.y),
        angle: Number(p.angle.toFixed(3)),
        hp: p.hp,
        alive: p.alive,
        kills: p.kills,
        deaths: p.deaths,
        rapid: now < p.rapidUntil,
        speed: now < p.speedUntil,
        shield: now < p.shieldUntil,
        bomb: p.bombAt ? Math.max(0, p.bombAt - now) : 0,
        triple: now < p.tripleUntil,
        frozen: now < p.frozenUntil,
        spikes: now < p.spikesUntil,
        ghost: now < p.ghostUntil,
        slip: now < p.slipUntil,
        weapon: p.weapon ? p.weapon.kind : null,
        ammo: p.weapon ? p.weapon.ammo : 0,
        isBot: p.isBot,
        difficulty: p.difficulty,
      }))
      .sort((a, b) => b.kills - a.kills),
    bullets: g.bullets.map((b) => ({
      x: Math.round(b.x), y: Math.round(b.y),
      k: b.kind || "blaster",
      a: Number(Math.atan2(b.vy, b.vx).toFixed(2)), // lets the client orient tracers
    })),
    // Mines are visible to everyone (one shared snapshot per room — hiding them
    // per-viewer would mean a per-socket snapshot at 15 Hz). They work as area
    // denial rather than a hidden trap, and the client dims enemy ones.
    mines: (g.mines || []).map((m) => ({
      id: m.id, x: Math.round(m.x), y: Math.round(m.y), kind: m.kind || "mine",
      ownerId: m.ownerId, team: m.team, armed: now >= m.armAt,
    })),
    pickups: g.pickups.map((p) => ({ id: p.id, x: p.x, y: p.y, type: p.type, active: p.active })),
  };
}

const emptyLobby = () => ({
  status: "lobby", hostId: null, mapId: DEFAULT_MAP, mode: "ffa",
  matchMs: MATCH_MS, teamNames: { A: "Team A", B: "Team B" },
  players: [], bullets: [], pickups: [], timeLeft: 0, winnerId: null, winnerTeam: null, teamScores: null,
});

function broadcast(roomId) {
  const g = games.get(roomId);
  if (g?.bus) g.bus.broadcast("state", snapshot(g));
}

/**
 * The 15Hz in-match stream. Two optimizations over plain broadcast():
 *  - stream() (volatile): a client whose socket buffer is congested (bad wifi,
 *    tab hiccup) DROPS stale frames instead of queueing them — the alternative
 *    is a growing backlog where the game drifts seconds behind real time.
 *  - pickup deltas: the pickup list only ships when something was grabbed or
 *    respawned (g.pickupsDirty); clients keep their last copy otherwise.
 *    Lobby/end broadcasts stay reliable and complete — only the high-rate
 *    stream is lossy, and every field in it is superseded 66ms later.
 */
function streamSnapshot(roomId) {
  const g = games.get(roomId);
  if (!g?.bus) return;
  const snap = snapshot(g);
  // Keyframe once per second: volatile drops are per-client and invisible to
  // us, so a client that missed the dirty frame would otherwise render stale
  // pickups until the next change. 1s of staleness max, in the worst case.
  g.snapSeq = (g.snapSeq || 0) + 1;
  const keyframe = g.snapSeq % 15 === 0;
  if (!g.pickupsDirty && !keyframe) delete snap.pickups;
  g.pickupsDirty = false;
  g.bus.stream("state", snap);
}

function stopLoop(g) {
  if (g?.loop) { clearInterval(g.loop); g.loop = null; }
}

function endMatch(roomId) {
  const g = games.get(roomId);
  if (!g) return;
  stopLoop(g);
  g.status = "ended";
  if (g.mode === "tdm") {
    const s = teamScores(g);
    g.winnerTeam = s.A === s.B ? "tie" : s.A > s.B ? "A" : "B";
    g.winnerId = null;
  } else {
    const ranked = [...g.players.values()].sort((a, b) => b.kills - a.kills);
    g.winnerId = ranked[0]?.id || null;
    g.winnerTeam = null;
  }
  broadcast(roomId);
}

function startLoop(roomId) {
  const g = games.get(roomId);
  if (!g) return;
  stopLoop(g);
  const dt = 1 / TICK_HZ;
  g.loop = setInterval(() => {
    const game = games.get(roomId);
    if (!game || game.status !== "playing") return stopLoop(game);
    const now = Date.now();

    // Bots produce the SAME input tuple a client would have sent, so the
    // simulation below can't tell them apart from humans.
    for (const p of game.players.values()) {
      if (p.isBot && p.alive) p.input = botInput(game, p, now);
    }

    const { kills, booms } = stepWorld(game, dt, now);
    for (const k of kills) {
      game.bus?.broadcast("kill", {
        killerName: game.players.get(k.killerId)?.name || "someone",
        victimName: game.players.get(k.victimId)?.name || "someone",
      });
    }
    for (const bm of booms) game.bus?.broadcast("boom", bm);

    if (now >= game.endsAt) return endMatch(roomId);

    game.tick += 1;
    if (game.tick % SNAPSHOT_EVERY === 0) streamSnapshot(roomId);
  }, 1000 / TICK_HZ);
}

/** Per-room settings from the manifest's configSchema. */
function applyConfig(g, sdk) {
  const cfg = sdk.meta.config || {};
  // The arena is built for 10; a room may cap it lower but never higher.
  g.maxKarts = Math.min(Math.max(Number(cfg.maxPlayers) || MAX_KARTS, 2), MAX_KARTS);
  g.allowBots = cfg.allowBots !== false;
  // "random" is a real, valid choice the wizard offers — getMap() resolves it.
  if (cfg.map && (MAPS[cfg.map] || cfg.map === "random") && g.status === "lobby") {
    applyMap(g, cfg.map);
  }
  const secs = Number(cfg.matchLength);
  if (Number.isFinite(secs) && secs >= MIN_MATCH_S && secs <= MAX_MATCH_S) {
    g.matchMs = secs * 1000;
  }
}

export default {
  /**
   * Opening the arena does NOT put a kart in it — `join` does.
   *
   * Same split as ludo (§53) and the same reason: seats are finite (10) and a
   * spectator watching a match must not hold one. It also matters more here,
   * because joining mid-match is refused outright — see the `join` event.
   */
  async onJoin(sdk) {
    const roomId = sdk.room.id;
    const g = games.get(roomId);
    if (g) {
      // The running physics loop may be holding a bus built from a socket that
      // has since disconnected; refreshing on every join keeps it live.
      g.bus = sdk.socket.detached();
      applyConfig(g, sdk);
      return snapshot(g);
    }
    return emptyLobby();
  },

  rates: {
    // Matches the legacy limit exactly: input is a 40/sec stream, everything
    // else is a discrete action.
    input: { max: 40, windowMs: 1000 },
  },

  events: {
    join(sdk, _payload, ack) {
      const roomId = sdk.room.id;
      const uid = sdk.user.id;
      let g = games.get(roomId);
      if (!g) {
        g = newGame(uid);
        g.bus = sdk.socket.detached();
        games.set(roomId, g);
        applyConfig(g, sdk);
      }

      if (!g.players.has(uid)) {
        // No hot-joining a live match — latecomers spectate until it ends.
        // (Being mid-match with fresh full-health opponents dropping in was
        // unfair to everyone already fighting.)
        if (g.status === "playing") {
          return ack({ error: "Match in progress — you're spectating. Join when it ends!", spectate: true });
        }
        if (g.players.size >= g.maxKarts) return ack({ error: `Arena is full (${g.maxKarts} karts)` });
        const seat = freeSeat(g);
        if (!seat) return ack({ error: `Arena is full (${g.maxKarts} karts)` });
        g.players.set(uid, newPlayer(uid, sdk.user.name, seat.color, seat.seatIndex, g.spawns));
      }
      // A bot must never end up hosting — the host drives start/config.
      if (!g.hostId || !g.players.has(g.hostId) || isBotId(g.hostId)) {
        g.hostId = humanPlayers(g)[0]?.id || null;
      }

      broadcast(roomId);
      ack({ ok: true, color: g.players.get(uid)?.color });
    },

    // ── Bots ── host-only; a bot is a normal player driven by botInput().
    addBot(sdk, { difficulty } = {}, ack) {
      const roomId = sdk.room.id;
      const g = games.get(roomId);
      if (!g) return ack({ error: "Join the arena first" });
      if (!g.allowBots) return ack({ error: "Bots are disabled in this room" });
      if (g.hostId !== sdk.user.id) return ack({ error: "Only the host can add bots" });
      if (g.players.size >= g.maxKarts) return ack({ error: `Arena is full (${g.maxKarts} karts)` });

      const diff = DIFFICULTIES.includes(difficulty) ? difficulty : DEFAULT_DIFFICULTY;
      const seat = freeSeat(g);
      if (!seat) return ack({ error: "No free seat" });
      const id = `bot:${g.nextBotId++}`;
      const botCount = [...g.players.values()].filter((p) => p.isBot).length;
      const p = newPlayer(id, botName(botCount, diff), seat.color, seat.seatIndex, g.spawns, {
        isBot: true,
        difficulty: diff,
      });
      // A bot added mid-match joins the fight immediately, unlike a human.
      if (g.status === "playing") {
        if (g.mode === "tdm") p.team = smallerTeam(g);
        respawnPlayer(p, Date.now(), p.seatIndex, g.spawns);
      }
      g.players.set(id, p);
      broadcast(roomId);
      ack({ ok: true, id });
    },

    removeBot(sdk, { botId } = {}, ack) {
      const g = games.get(sdk.room.id);
      if (!g) return ack({ error: "No arena" });
      if (g.hostId !== sdk.user.id) return ack({ error: "Only the host can remove bots" });
      // No id given → drop the most recently added bot.
      const target = botId && isBotId(botId)
        ? botId
        : [...g.players.values()].filter((p) => p.isBot).pop()?.id;
      if (!target || !g.players.get(target)?.isBot) return ack({ error: "No bot to remove" });
      g.players.delete(target);
      broadcast(sdk.room.id);
      ack({ ok: true });
    },

    leave(sdk) {
      const roomId = sdk.room.id;
      const g = games.get(roomId);
      if (!g) return;
      g.players.delete(sdk.user.id);
      if (g.hostId === sdk.user.id) g.hostId = humanPlayers(g)[0]?.id || null;
      broadcast(roomId);
    },

    /** Host picks the map + mode before starting (only in lobby / ended). */
    config(sdk, { mapId, mode, duration, teamName } = {}) {
      const g = games.get(sdk.room.id);
      if (!g || g.hostId !== sdk.user.id || g.status === "playing") return;
      if (mapId && MAPS[mapId]) applyMap(g, mapId);
      if (mode && MODES.has(mode)) g.mode = mode;
      // Match length in seconds, clamped — the host picks the pace.
      if (Number.isFinite(Number(duration))) {
        const s = Math.round(Number(duration));
        if (s >= MIN_MATCH_S && s <= MAX_MATCH_S) g.matchMs = s * 1000;
      }
      // Rename a team (TDM flavor): { team: "A"|"B", name }.
      if (teamName && (teamName.team === "A" || teamName.team === "B")) {
        const name = cleanTeamName(teamName.name);
        if (name) g.teamNames[teamName.team] = name;
      }
      broadcast(sdk.room.id);
    },

    /**
     * Host drags players (and bots) onto a team before a TDM match. Anyone left
     * unassigned gets balanced automatically at start.
     */
    setTeam(sdk, { playerId, team } = {}) {
      const g = games.get(sdk.room.id);
      if (!g || g.hostId !== sdk.user.id || g.status === "playing") return;
      if (team !== "A" && team !== "B" && team !== null) return;
      const p = g.players.get(playerId);
      if (!p) return;
      p.team = team;
      broadcast(sdk.room.id);
    },

    start(sdk, _payload, ack) {
      const roomId = sdk.room.id;
      const g = games.get(roomId);
      if (!g) return ack({ error: "No arena" });
      if (g.hostId !== sdk.user.id) return ack({ error: "Only the host can start" });
      if (g.status === "playing") return ack({ error: "Match already running" });
      if (g.players.size < 1) return ack({ error: "Need at least 1 kart" });

      applyMap(g, g.mapId);

      if (g.mode === "tdm") assignTeams(g);
      else for (const p of g.players.values()) p.team = null;

      const now = Date.now();
      for (const p of g.players.values()) {
        p.kills = 0; p.deaths = 0; p.lastFire = 0;
        respawnPlayer(p, now, p.seatIndex, g.spawns);
      }
      g.bullets = [];
      g.mines = [];
      g.pickups = g.map.pickups.map((pad) => ({ ...pad, active: true, readyAt: 0 }));
      g.status = "playing";
      g.startedAt = now;
      g.endsAt = now + (g.matchMs || MATCH_MS);
      g.winnerId = null;
      g.winnerTeam = null;
      g.tick = 0;

      broadcast(roomId);
      startLoop(roomId);
      ack({ ok: true });
    },

    /**
     * The hot path: up to 40 input tuples per second per player.
     *
     * Stores into the player's slot and returns — the loop reads it on the next
     * tick. It never broadcasts, which is what keeps N players from producing
     * N² traffic.
     */
    input(sdk, { input } = {}) {
      const g = games.get(sdk.room.id);
      if (!g || g.status !== "playing") return;
      const p = g.players.get(sdk.user.id);
      if (!p || !input) return;
      const clamp1 = (n) => (typeof n === "number" && n === n ? Math.max(-1, Math.min(1, n)) : 0);
      p.input = {
        throttle: clamp1(input.throttle),
        steer: clamp1(input.steer),
        shoot: Boolean(input.shoot),
      };
    },

    reset(sdk) {
      const g = games.get(sdk.room.id);
      if (!g || g.hostId !== sdk.user.id) return;
      stopLoop(g);
      g.status = "lobby";
      g.bullets = [];
      g.mines = [];
      g.winnerId = null;
      g.winnerTeam = null;
      for (const p of g.players.values()) {
        p.alive = false; p.kills = 0; p.deaths = 0; p.speed = 0;
        p.rapidUntil = 0; p.speedUntil = 0; p.shieldUntil = 0; p.bombAt = 0;
        p.tripleUntil = 0; p.frozenUntil = 0; p.minesLeft = 0;
      }
      broadcast(sdk.room.id);
    },
  },

  /**
   * THE REFERENCE LIFECYCLE TEST.
   *
   * A leaked `setTimeout` fires once into nothing. A leaked `setInterval`
   * running physics for ten karts pins a core for the life of the process, and
   * says nothing about it in any log. The host calls this when the last
   * participant leaves; the plugin only has to implement it.
   *
   * The legacy handler had to work out "is any HUMAN still connected?" itself,
   * because a lobby of bots would otherwise keep ticking forever. The host
   * answers the stronger question — is anyone still in this activity at all —
   * so that logic is gone.
   */
  destroy(roomId) {
    const g = games.get(roomId);
    if (!g) return;
    stopLoop(g);
    games.delete(roomId);
  },
};

/** Test seam — lets a suite assert the interval was actually cleared. */
export const __games = games;
