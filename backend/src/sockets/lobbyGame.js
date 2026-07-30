/**
 * Shared lobby-game framework — the common shell every seat-based game needs:
 * join/leave seats, host powers, bots with difficulty, start/reset, spectate
 * lock while playing, AFK deadlines, and cleanup when the last human leaves.
 *
 * Ludo/kart grew this logic organically; chess/UNO/typing/bingo would each
 * have re-implemented it. Instead a game module supplies pure callbacks:
 *
 *   createLobbyGame({
 *     prefix,                    // event namespace: "<prefix>:join" etc.
 *     minPlayers, maxPlayers,
 *     allowBots,                 // false → no addBot/removeBot events
 *     start(g),                  // mutate g into "playing"
 *     publicState(g),            // what every client sees
 *     privateState(g, playerId), // optional per-seat secrets (UNO hands)
 *     events: { name: (ctx, payload) => {} },   // game moves
 *     afkDeadline(g),            // ms timestamp or null (armed per broadcast)
 *     onAfkTimeout(ctx),
 *     botDelayMs(g),             // pacing for bot turns
 *     botAct(ctx),               // perform the bot's action
 *     botTurn(g),                // is it a bot's turn? (turn games)
 *     tick: { ms, onTick(ctx) }, // optional heartbeat while playing (bingo caller, typing bots)
 *   }).register(io, socket)
 *
 * ctx = { g, io, roomId, broadcast, notice, endGame } — handlers never touch
 * socket.io rooms directly, so game rules stay pure and testable.
 */
import { canAccessRoom } from "../utils/roomAccess.js";
import { roomKey } from "./chat.handlers.js";

const BOT_NAMES = ["Nova", "Pixel", "Turbo", "Echo", "Zippy", "Rook", "Dice", "Bolt"];
export const DIFFICULTIES = ["easy", "medium", "hard"];

export function createLobbyGame(cfg) {
  const games = new Map(); // roomId -> game

  function freshGame(hostId) {
    return {
      status: "lobby", // lobby | playing | ended
      hostId,
      players: [], // [{id,name,isBot,difficulty}]
      nextBotId: 1,
      afkTimer: null,
      botTimer: null,
      tickTimer: null,
      turnDeadline: null,
      ...cfg.init?.(),
    };
  }

  const humanIds = (g) => g.players.filter((p) => !p.isBot).map((p) => p.id);

  function clearTimers(g) {
    clearTimeout(g.afkTimer);
    clearTimeout(g.botTimer);
    clearInterval(g.tickTimer);
    g.afkTimer = g.botTimer = g.tickTimer = null;
  }

  function makeCtx(io, roomId) {
    const g = games.get(roomId);
    const ctx = {
      g,
      io,
      roomId,
      games,
      broadcast: () => broadcast(io, roomId),
      notice: (text) => io.to(roomKey(roomId)).emit(`${cfg.prefix}:notice`, { text }),
      emit: (event, payload) => io.to(roomKey(roomId)).emit(`${cfg.prefix}:${event}`, payload),
      endGame: () => {
        g.status = "ended";
        clearTimers(g);
        broadcast(io, roomId);
      },
    };
    return ctx;
  }

  async function sendPrivate(io, roomId, g) {
    if (!cfg.privateState) return;
    const sockets = await io.in(roomKey(roomId)).fetchSockets();
    for (const s of sockets) {
      const seat = g.players.find((p) => p.id === s.user.id);
      if (!seat) continue;
      const priv = cfg.privateState(g, s.user.id);
      if (priv) s.emit(`${cfg.prefix}:private`, priv);
    }
  }

  function armAfk(io, roomId) {
    const g = games.get(roomId);
    if (!g) return;
    clearTimeout(g.afkTimer);
    g.afkTimer = null;
    g.turnDeadline = null;
    if (g.status !== "playing" || !cfg.afkDeadline) return;
    const deadline = cfg.afkDeadline(g);
    if (!deadline) return;
    g.turnDeadline = deadline;
    g.afkTimer = setTimeout(() => {
      const cur = games.get(roomId);
      if (!cur || cur.status !== "playing") return;
      cfg.onAfkTimeout?.(makeCtx(io, roomId));
    }, Math.max(50, deadline - Date.now()));
  }

  function armBot(io, roomId) {
    const g = games.get(roomId);
    if (!g || g.status !== "playing" || !cfg.botTurn?.(g)) return;
    clearTimeout(g.botTimer);
    g.botTimer = setTimeout(() => {
      const cur = games.get(roomId);
      if (!cur || cur.status !== "playing" || !cfg.botTurn?.(cur)) return;
      cfg.botAct?.(makeCtx(io, roomId));
    }, cfg.botDelayMs?.(g) ?? 900);
  }

  function broadcast(io, roomId) {
    const g = games.get(roomId);
    if (!g) return;
    armAfk(io, roomId);
    io.to(roomKey(roomId)).emit(`${cfg.prefix}:state`, {
      ...cfg.publicState(g),
      status: g.status,
      hostId: g.hostId,
      players: g.players,
      turnDeadline: g.turnDeadline,
    });
    sendPrivate(io, roomId, g); // async fire-and-forget
    armBot(io, roomId);
  }

  function startTicker(io, roomId) {
    const g = games.get(roomId);
    if (!g || !cfg.tick) return;
    clearInterval(g.tickTimer);
    g.tickTimer = setInterval(() => {
      const cur = games.get(roomId);
      if (!cur || cur.status !== "playing") { clearInterval(g.tickTimer); return; }
      cfg.tick.onTick(makeCtx(io, roomId));
    }, cfg.tick.ms);
  }

  function register(io, socket) {
    const uid = socket.user.id;
    const guard = async (roomId) =>
      Boolean(roomId) && socket.rooms.has(roomKey(roomId)) && (await canAccessRoom(socket.user, roomId));

    const on = (name, handler) => socket.on(`${cfg.prefix}:${name}`, handler);

    on("sync", ({ roomId } = {}, cb) => {
      const g = games.get(roomId);
      if (!g) return cb?.(null);
      cb?.({
        ...cfg.publicState(g),
        status: g.status,
        hostId: g.hostId,
        players: g.players,
        turnDeadline: g.turnDeadline,
        you: cfg.privateState?.(g, uid) || null,
      });
    });

    on("join", async ({ roomId } = {}, cb) => {
      if (!(await guard(roomId))) return cb?.({ error: "Not allowed" });
      let g = games.get(roomId);
      if (!g) { g = freshGame(uid); games.set(roomId, g); }
      if (g.players.some((p) => p.id === uid)) return cb?.({ ok: true });
      if (g.status !== "lobby") return cb?.({ error: "Game in progress — you're spectating until it ends", spectate: true });
      if (g.players.length >= cfg.maxPlayers) return cb?.({ error: `Table is full (${cfg.maxPlayers})` });
      g.players.push({ id: uid, name: socket.user.name, isBot: false, difficulty: null });
      if (!g.hostId || !g.players.some((p) => p.id === g.hostId && !p.isBot)) g.hostId = uid;
      broadcast(io, roomId);
      cb?.({ ok: true });
    });

    on("leave", ({ roomId } = {}) => {
      const g = games.get(roomId);
      if (!g || g.status !== "lobby") return;
      g.players = g.players.filter((p) => p.id !== uid);
      if (g.hostId === uid) g.hostId = humanIds(g)[0] || null;
      if (humanIds(g).length === 0) { clearTimers(g); games.delete(roomId); return; }
      broadcast(io, roomId);
    });

    if (cfg.allowBots) {
      on("addBot", async ({ roomId, difficulty } = {}, cb) => {
        if (!(await guard(roomId))) return cb?.({ error: "Not allowed" });
        const g = games.get(roomId);
        if (!g || g.status !== "lobby") return cb?.({ error: "Not in a lobby" });
        if (g.hostId !== uid) return cb?.({ error: "Only the host can add bots" });
        if (g.players.length >= cfg.maxPlayers) return cb?.({ error: "Table is full" });
        const diff = DIFFICULTIES.includes(difficulty) ? difficulty : "medium";
        const n = g.players.filter((p) => p.isBot).length;
        const label = { easy: "Easy", medium: "Med", hard: "Hard" }[diff];
        g.players.push({
          id: `bot:${g.nextBotId++}`,
          name: `${BOT_NAMES[n % BOT_NAMES.length]} (${label})`,
          isBot: true,
          difficulty: diff,
        });
        broadcast(io, roomId);
        cb?.({ ok: true });
      });

      on("removeBot", ({ roomId, botId } = {}, cb) => {
        const g = games.get(roomId);
        if (!g || g.status !== "lobby" || g.hostId !== uid) return cb?.({ error: "Not allowed" });
        const idx = botId
          ? g.players.findIndex((p) => p.id === botId && p.isBot)
          : g.players.findLastIndex((p) => p.isBot);
        if (idx === -1) return cb?.({ error: "No bot to remove" });
        g.players.splice(idx, 1);
        broadcast(io, roomId);
        cb?.({ ok: true });
      });
    }

    on("start", async ({ roomId } = {}, cb) => {
      if (!(await guard(roomId))) return cb?.({ error: "Not allowed" });
      const g = games.get(roomId);
      if (!g || g.status !== "lobby") return cb?.({ error: "Cannot start" });
      if (g.hostId !== uid) return cb?.({ error: "Only the host can start" });
      if (g.players.length < cfg.minPlayers) return cb?.({ error: `Need at least ${cfg.minPlayers} players` });
      g.status = "playing";
      cfg.start(g);
      broadcast(io, roomId);
      startTicker(io, roomId);
      cb?.({ ok: true });
    });

    on("reset", ({ roomId } = {}) => {
      const g = games.get(roomId);
      if (!g || g.hostId !== uid) return;
      clearTimers(g);
      const fresh = freshGame(uid);
      fresh.players = g.players; // keep the table together for a rematch
      fresh.hostId = g.hostId;
      fresh.nextBotId = g.nextBotId;
      games.set(roomId, fresh);
      broadcast(io, roomId);
    });

    // Game-specific moves. Handlers get a validated seated context.
    for (const [name, handler] of Object.entries(cfg.events || {})) {
      on(name, async (payload = {}, cb) => {
        const { roomId } = payload;
        const g = games.get(roomId);
        if (!g || g.status !== "playing") return cb?.({ error: "No game running" });
        const seat = g.players.find((p) => p.id === uid);
        if (!seat) return cb?.({ error: "You're spectating" });
        try {
          handler(makeCtx(io, roomId), { ...payload, playerId: uid, seat }, cb);
        } catch {
          cb?.({ error: "Move failed" });
        }
      });
    }

    // Free the room's game once no seated human remains connected.
    socket.on("disconnecting", () => {
      const rooms = [...socket.rooms].filter((k) => k.startsWith("room:")).map((k) => k.slice(5));
      setImmediate(async () => {
        for (const roomId of rooms) {
          const g = games.get(roomId);
          if (!g) continue;
          const sockets = await io.in(roomKey(roomId)).fetchSockets();
          const present = new Set(sockets.map((s) => s.user.id));
          const humans = humanIds(g);
          if (humans.length === 0 || !humans.some((id) => present.has(id))) {
            clearTimers(g);
            games.delete(roomId);
          }
        }
      });
    });
  }

  return { register, games, broadcastFor: broadcast, makeCtx };
}
