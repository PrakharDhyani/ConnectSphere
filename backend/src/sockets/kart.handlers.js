/**
 * Smash Karts — real-time 2D top-down deathmatch, one arena per room.
 *
 * Continuous game: once the host starts, the server runs a fixed 30 Hz tick loop
 * that advances the physics (games/kartArena.js) and broadcasts a world snapshot
 * at ~15 Hz. Clients stream compact input; the server owns all state — positions,
 * hits, scores, powerups, teams.
 *
 * Two maps (see games/kartMaps.js) and two modes: FFA (free for all) and TDM
 * (team deathmatch). Powerups: health, rapid-fire, speed, shield, and a "bomb"
 * that turns the carrier into a rolling explosive.
 */
import {
  COLORS,
  MAX_HP,
  MATCH_MS,
  TICK_HZ,
  SNAPSHOT_EVERY,
  stepWorld,
  respawnPlayer,
} from "../games/kartArena.js";
import { MAPS, DEFAULT_MAP, getMap } from "../games/kartMaps.js";
import { botInput, botName, DIFFICULTIES, DEFAULT_DIFFICULTY } from "../games/kartBot.js";
import { canAccessRoom } from "../utils/roomAccess.js";
import { allow } from "../utils/socketRate.js";
import { roomKey } from "./chat.handlers.js";

const games = new Map(); // roomId -> game
const MODES = new Set(["ffa", "tdm"]);
const MAX_KARTS = 6;

const isBotId = (id) => typeof id === "string" && id.startsWith("bot:");
const humanPlayers = (g) => [...g.players.values()].filter((p) => !p.isBot);

// Attach a map to a game. Every map-derived field must be set HERE — the world
// size included: a map swap that updated obstacles/spawns but kept the previous
// map's w/h clamped karts outside the new arena (spawning them inside barriers,
// unable to move).
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

// Balance a late-joiner onto the smaller team (TDM only).
function smallerTeam(g) {
  let a = 0, b = 0;
  for (const p of g.players.values()) { if (p.team === "A") a++; else if (p.team === "B") b++; }
  return a <= b ? "A" : "B";
}

function assignTeams(g) {
  const players = [...g.players.values()];
  players.forEach((p, i) => { p.team = i % 2 === 0 ? "A" : "B"; });
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
        isBot: p.isBot,
        difficulty: p.difficulty,
      }))
      .sort((a, b) => b.kills - a.kills),
    bullets: g.bullets.map((b) => ({ x: Math.round(b.x), y: Math.round(b.y) })),
    // Mines are visible to everyone (one shared snapshot per room — hiding them
    // per-viewer would mean a per-socket snapshot at 15 Hz). They work as area
    // denial rather than a hidden trap, and the client dims enemy ones.
    mines: (g.mines || []).map((m) => ({
      id: m.id, x: Math.round(m.x), y: Math.round(m.y),
      ownerId: m.ownerId, team: m.team, armed: now >= m.armAt,
    })),
    pickups: g.pickups.map((p) => ({ id: p.id, x: p.x, y: p.y, type: p.type, active: p.active })),
  };
}

const emptyLobby = () => ({
  status: "lobby", hostId: null, mapId: DEFAULT_MAP, mode: "ffa",
  players: [], bullets: [], pickups: [], timeLeft: 0, winnerId: null, winnerTeam: null, teamScores: null,
});

function broadcast(io, roomId) {
  const g = games.get(roomId);
  if (g) io.to(roomKey(roomId)).emit("kart:state", snapshot(g));
}

function stopLoop(g) {
  if (g?.loop) { clearInterval(g.loop); g.loop = null; }
}

function endMatch(io, roomId) {
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
  broadcast(io, roomId);
}

function startLoop(io, roomId) {
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
      io.to(roomKey(roomId)).emit("kart:kill", {
        killerName: game.players.get(k.killerId)?.name || "someone",
        victimName: game.players.get(k.victimId)?.name || "someone",
      });
    }
    for (const bm of booms) io.to(roomKey(roomId)).emit("kart:boom", bm);

    if (now >= game.endsAt) return endMatch(io, roomId);

    game.tick += 1;
    if (game.tick % SNAPSHOT_EVERY === 0) broadcast(io, roomId);
  }, 1000 / TICK_HZ);
}

export function registerKartHandlers(io, socket) {
  const uid = socket.user.id;
  const guard = async (roomId) =>
    Boolean(roomId) && socket.rooms.has(roomKey(roomId)) && (await canAccessRoom(socket.user, roomId));

  socket.on("kart:sync", ({ roomId } = {}, cb) => {
    const g = games.get(roomId);
    cb?.(g ? snapshot(g) : emptyLobby());
  });

  socket.on("kart:join", async ({ roomId } = {}, cb) => {
    if (!(await guard(roomId))) return cb?.({ error: "Not allowed" });
    let g = games.get(roomId);
    if (!g) { g = newGame(uid); games.set(roomId, g); }

    if (!g.players.has(uid)) {
      const seat = freeSeat(g);
      if (!seat) return cb?.({ error: `Arena is full (${MAX_KARTS} karts)` });
      const p = newPlayer(uid, socket.user.name, seat.color, seat.seatIndex, g.spawns);
      if (g.status === "playing") {
        if (g.mode === "tdm") p.team = smallerTeam(g);
        respawnPlayer(p, Date.now(), p.seatIndex, g.spawns);
      }
      g.players.set(uid, p);
    }
    // A bot must never end up hosting — the host drives start/config.
    if (!g.hostId || !g.players.has(g.hostId) || isBotId(g.hostId)) {
      g.hostId = humanPlayers(g)[0]?.id || null;
    }

    broadcast(io, roomId);
    cb?.({ ok: true, color: g.players.get(uid)?.color });
  });

  // ── Bots ── host-only; a bot is a normal player driven by botInput().
  socket.on("kart:addBot", async ({ roomId, difficulty } = {}, cb) => {
    if (!(await guard(roomId))) return cb?.({ error: "Not allowed" });
    const g = games.get(roomId);
    if (!g) return cb?.({ error: "Join the arena first" });
    if (g.hostId !== uid) return cb?.({ error: "Only the host can add bots" });
    if (g.players.size >= MAX_KARTS) return cb?.({ error: `Arena is full (${MAX_KARTS} karts)` });

    const diff = DIFFICULTIES.includes(difficulty) ? difficulty : DEFAULT_DIFFICULTY;
    const seat = freeSeat(g);
    if (!seat) return cb?.({ error: "No free seat" });
    const id = `bot:${g.nextBotId++}`;
    const botCount = [...g.players.values()].filter((p) => p.isBot).length;
    const p = newPlayer(id, botName(botCount, diff), seat.color, seat.seatIndex, g.spawns, {
      isBot: true,
      difficulty: diff,
    });
    if (g.status === "playing") {
      if (g.mode === "tdm") p.team = smallerTeam(g);
      respawnPlayer(p, Date.now(), p.seatIndex, g.spawns);
    }
    g.players.set(id, p);
    broadcast(io, roomId);
    cb?.({ ok: true, id });
  });

  socket.on("kart:removeBot", async ({ roomId, botId } = {}, cb) => {
    const g = games.get(roomId);
    if (!g) return cb?.({ error: "No arena" });
    if (g.hostId !== uid) return cb?.({ error: "Only the host can remove bots" });
    // No id given → drop the most recently added bot.
    const target = botId && isBotId(botId)
      ? botId
      : [...g.players.values()].filter((p) => p.isBot).pop()?.id;
    if (!target || !g.players.get(target)?.isBot) return cb?.({ error: "No bot to remove" });
    g.players.delete(target);
    broadcast(io, roomId);
    cb?.({ ok: true });
  });

  socket.on("kart:leave", ({ roomId } = {}) => {
    const g = games.get(roomId);
    if (!g) return;
    g.players.delete(uid);
    if (g.hostId === uid) g.hostId = humanPlayers(g)[0]?.id || null;
    // Bots alone must never keep a tick loop (and a match) running forever.
    if (humanPlayers(g).length === 0) { stopLoop(g); games.delete(roomId); return; }
    broadcast(io, roomId);
  });

  // Host picks the map + mode before starting (only in lobby / ended).
  socket.on("kart:config", ({ roomId, mapId, mode } = {}) => {
    const g = games.get(roomId);
    if (!g || g.hostId !== uid || g.status === "playing") return;
    if (mapId && MAPS[mapId]) applyMap(g, mapId);
    if (mode && MODES.has(mode)) g.mode = mode;
    broadcast(io, roomId);
  });

  socket.on("kart:start", async ({ roomId } = {}, cb) => {
    if (!(await guard(roomId))) return cb?.({ error: "Not allowed" });
    const g = games.get(roomId);
    if (!g) return cb?.({ error: "No arena" });
    if (g.hostId !== uid) return cb?.({ error: "Only the host can start" });
    if (g.status === "playing") return cb?.({ error: "Match already running" });
    if (g.players.size < 1) return cb?.({ error: "Need at least 1 kart" });

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
    g.endsAt = now + MATCH_MS;
    g.winnerId = null;
    g.winnerTeam = null;
    g.tick = 0;

    broadcast(io, roomId);
    startLoop(io, roomId);
    cb?.({ ok: true });
  });

  socket.on("kart:input", ({ roomId, input } = {}) => {
    const g = games.get(roomId);
    if (!g || g.status !== "playing") return;
    const p = g.players.get(uid);
    if (!p || !input) return;
    if (!allow(socket, "kartInput", 40, 1000)) return;
    const clamp1 = (n) => (typeof n === "number" && n === n ? Math.max(-1, Math.min(1, n)) : 0);
    p.input = {
      throttle: clamp1(input.throttle),
      steer: clamp1(input.steer),
      shoot: Boolean(input.shoot),
    };
  });

  socket.on("kart:reset", ({ roomId } = {}) => {
    const g = games.get(roomId);
    if (!g || g.hostId !== uid) return;
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
    broadcast(io, roomId);
  });

  socket.on("disconnecting", () => {
    const rooms = [...socket.rooms].filter((k) => k.startsWith("room:")).map((k) => k.slice(5));
    setImmediate(async () => {
      for (const roomId of rooms) {
        const g = games.get(roomId);
        if (!g) continue;
        g.players.delete(uid);
        if (g.hostId === uid) g.hostId = humanPlayers(g)[0]?.id || null;

        const sockets = await io.in(roomKey(roomId)).fetchSockets();
        const present = new Set(sockets.map((s) => s.user.id));
        // Only HUMANS count as "someone is still here" — a lobby of bots is not.
        const humans = humanPlayers(g);
        if (humans.length === 0 || !humans.some((p) => present.has(p.id))) {
          stopLoop(g);
          games.delete(roomId);
        } else {
          broadcast(io, roomId);
        }
      }
    });
  });
}
