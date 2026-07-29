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
import { canAccessRoom } from "../utils/roomAccess.js";
import { allow } from "../utils/socketRate.js";
import { roomKey } from "./chat.handlers.js";

const games = new Map(); // roomId -> game
const MODES = new Set(["ffa", "tdm"]);

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
    pickups: [],
    startedAt: 0,
    endsAt: 0,
    winnerId: null,
    winnerTeam: null,
    loop: null,
    tick: 0,
  };
}

function newPlayer(id, name, color, seatIndex, spawns) {
  const s = spawns[seatIndex % spawns.length];
  return {
    id, name, color, seatIndex,
    x: s.x, y: s.y, angle: 0, speed: 0,
    hp: MAX_HP,
    alive: false,
    kills: 0, deaths: 0,
    lastFire: 0,
    rapidUntil: 0, speedUntil: 0, shieldUntil: 0, bombAt: 0,
    team: null,
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
      }))
      .sort((a, b) => b.kills - a.kills),
    bullets: g.bullets.map((b) => ({ x: Math.round(b.x), y: Math.round(b.y) })),
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
      if (!seat) return cb?.({ error: "Arena is full (6 karts)" });
      const p = newPlayer(uid, socket.user.name, seat.color, seat.seatIndex, g.spawns);
      if (g.status === "playing") {
        if (g.mode === "tdm") p.team = smallerTeam(g);
        respawnPlayer(p, Date.now(), p.seatIndex, g.spawns);
      }
      g.players.set(uid, p);
    }
    if (!g.hostId || !g.players.has(g.hostId)) g.hostId = [...g.players.keys()][0];

    broadcast(io, roomId);
    cb?.({ ok: true, color: g.players.get(uid)?.color });
  });

  socket.on("kart:leave", ({ roomId } = {}) => {
    const g = games.get(roomId);
    if (!g) return;
    g.players.delete(uid);
    if (g.hostId === uid) g.hostId = [...g.players.keys()][0] || null;
    if (g.players.size === 0) { stopLoop(g); games.delete(roomId); return; }
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
    g.winnerId = null;
    g.winnerTeam = null;
    for (const p of g.players.values()) {
      p.alive = false; p.kills = 0; p.deaths = 0; p.speed = 0;
      p.rapidUntil = 0; p.speedUntil = 0; p.shieldUntil = 0; p.bombAt = 0;
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
        if (g.hostId === uid) g.hostId = [...g.players.keys()][0] || null;

        const sockets = await io.in(roomKey(roomId)).fetchSockets();
        const present = new Set(sockets.map((s) => s.user.id));
        if (g.players.size === 0 || ![...g.players.keys()].some((id) => present.has(id))) {
          stopLoop(g);
          games.delete(roomId);
        } else {
          broadcast(io, roomId);
        }
      }
    });
  });
}
