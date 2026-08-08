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
import { allow } from "../utils/socketRate.js";
import { roomKey } from "./chat.handlers.js";

const BOT_NAMES = ["Nova", "Pixel", "Turbo", "Echo", "Zippy", "Rook", "Dice", "Bolt"];
export const DIFFICULTIES = ["easy", "medium", "hard"];

// Sticker reactions — shared by every framework game (and mirrored by ludo).
export const REACTION_KINDS = ["angry", "fire", "kiss", "love", "gunshot", "laugh"];

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

  /**
   * SEAT MANAGEMENT, WITH NO TRANSPORT.
   *
   * Extracted so the same rules serve two callers: the legacy socket
   * registration below, and the plugin adapter (activities/lobbyGameAdapter.js)
   * which dispatches through the activity host instead. Before this split the
   * logic lived inline in `register()`, so migrating a game to the plugin
   * system meant reimplementing join/leave/start/reset/bots — duplicating the
   * exact thing this framework exists to share, four times over.
   *
   * Every function here takes the actor's identity explicitly and returns
   * `{ok}` or `{error}`. None of them emit: the caller decides how to publish
   * the result, which is precisely what makes them reusable across transports.
   */
  const seats = {
    /** The table as it stands, or null. Callers must not mutate it. */
    get: (roomId) => games.get(roomId) ?? null,

    join(roomId, user) {
      let g = games.get(roomId);
      if (!g) { g = freshGame(user.id); games.set(roomId, g); }
      if (g.players.some((p) => p.id === user.id)) return { ok: true, changed: false };
      // Spectating rather than refusing: joining mid-game is normal in a
      // hangout, and the framework already locks seats while playing.
      if (g.status !== "lobby") return { error: "Game in progress — you're spectating until it ends", spectate: true };
      if (g.players.length >= cfg.maxPlayers) return { error: `Table is full (${cfg.maxPlayers})` };
      g.players.push({ id: user.id, name: user.name, isBot: false, difficulty: null });
      // Host passes to a real human if the seat was vacant or held by a bot.
      if (!g.hostId || !g.players.some((p) => p.id === g.hostId && !p.isBot)) g.hostId = user.id;
      return { ok: true, changed: true };
    },

    leave(roomId, userId) {
      const g = games.get(roomId);
      if (!g || g.status !== "lobby") return { ok: true, changed: false };
      g.players = g.players.filter((p) => p.id !== userId);
      if (g.hostId === userId) g.hostId = humanIds(g)[0] || null;
      // Last human out: drop the table rather than leave bots playing alone.
      if (humanIds(g).length === 0) { clearTimers(g); games.delete(roomId); return { ok: true, emptied: true }; }
      return { ok: true, changed: true };
    },

    addBot(roomId, userId, difficulty) {
      const g = games.get(roomId);
      if (!g || g.status !== "lobby") return { error: "Not in a lobby" };
      if (g.hostId !== userId) return { error: "Only the host can add bots" };
      if (g.players.length >= cfg.maxPlayers) return { error: "Table is full" };
      const diff = DIFFICULTIES.includes(difficulty) ? difficulty : "medium";
      const n = g.players.filter((p) => p.isBot).length;
      const label = { easy: "Easy", medium: "Med", hard: "Hard" }[diff];
      g.players.push({
        id: `bot:${g.nextBotId++}`,
        name: `${BOT_NAMES[n % BOT_NAMES.length]} (${label})`,
        isBot: true,
        difficulty: diff,
      });
      return { ok: true, changed: true };
    },

    removeBot(roomId, userId, botId) {
      const g = games.get(roomId);
      if (!g || g.status !== "lobby" || g.hostId !== userId) return { error: "Not allowed" };
      const idx = botId
        ? g.players.findIndex((p) => p.id === botId && p.isBot)
        : g.players.findLastIndex((p) => p.isBot);
      if (idx === -1) return { error: "No bot to remove" };
      g.players.splice(idx, 1);
      return { ok: true, changed: true };
    },

    start(roomId, userId) {
      const g = games.get(roomId);
      if (!g || g.status !== "lobby") return { error: "Cannot start" };
      if (g.hostId !== userId) return { error: "Only the host can start" };
      if (g.players.length < cfg.minPlayers) return { error: `Need at least ${cfg.minPlayers} players` };
      g.status = "playing";
      cfg.start(g);
      return { ok: true, changed: true, started: true };
    },

    reset(roomId, userId) {
      const g = games.get(roomId);
      if (!g || g.hostId !== userId) return { error: "Not allowed" };
      clearTimers(g);
      const fresh = freshGame(userId);
      fresh.players = g.players;      // keep the table together for a rematch
      fresh.hostId = g.hostId;
      fresh.nextBotId = g.nextBotId;
      cfg.onReset?.(g, fresh);        // carry over settings (e.g. chess time control)
      games.set(roomId, fresh);
      return { ok: true, changed: true };
    },

    /** Free a table once no seated human is still connected. */
    releaseIfEmpty(roomId, presentUserIds) {
      const g = games.get(roomId);
      if (!g) return false;
      const humans = humanIds(g);
      if (humans.length === 0 || !humans.some((id) => presentUserIds.has(id))) {
        clearTimers(g);
        games.delete(roomId);
        return true;
      }
      return false;
    },

    clearTimers,
  };

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
      const res = seats.join(roomId, socket.user);
      if (res.error) return cb?.(res);
      if (res.changed) broadcast(io, roomId);
      cb?.({ ok: true });
    });

    on("leave", ({ roomId } = {}) => {
      const res = seats.leave(roomId, uid);
      if (res.changed) broadcast(io, roomId);
    });

    if (cfg.allowBots) {
      on("addBot", async ({ roomId, difficulty } = {}, cb) => {
        if (!(await guard(roomId))) return cb?.({ error: "Not allowed" });
        const res = seats.addBot(roomId, uid, difficulty);
        if (res.error) return cb?.(res);
        broadcast(io, roomId);
        cb?.({ ok: true });
      });

      on("removeBot", ({ roomId, botId } = {}, cb) => {
        const res = seats.removeBot(roomId, uid, botId);
        if (res.error) return cb?.(res);
        broadcast(io, roomId);
        cb?.({ ok: true });
      });
    }

    on("start", async ({ roomId } = {}, cb) => {
      if (!(await guard(roomId))) return cb?.({ error: "Not allowed" });
      const res = seats.start(roomId, uid);
      if (res.error) return cb?.(res);
      broadcast(io, roomId);
      startTicker(io, roomId);
      cb?.({ ok: true });
    });

    on("reset", ({ roomId } = {}) => {
      const res = seats.reset(roomId, uid);
      if (res.error) return;
      broadcast(io, roomId);
    });

    // Host-only settings changed BEFORE the game starts (time controls etc.).
    for (const [name, handler] of Object.entries(cfg.lobbyEvents || {})) {
      on(name, async (payload = {}, cb) => {
        const { roomId } = payload;
        const g = games.get(roomId);
        if (!g || g.status !== "lobby") return cb?.({ error: "Only in the lobby" });
        if (g.hostId !== uid) return cb?.({ error: "Only the host can change settings" });
        try {
          handler(makeCtx(io, roomId), payload, cb);
        } catch {
          cb?.({ error: "Setting failed" });
        }
      });
    }

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

    // Animated sticker reactions — anyone in the room (spectators included)
    // can fire them; rate-limited so nobody wallpapers the table.
    on("react", async ({ roomId, kind } = {}) => {
      if (!REACTION_KINDS.includes(kind)) return;
      if (!(await guard(roomId))) return;
      if (!allow(socket, `${cfg.prefix}React`, 6, 4000)) return;
      io.to(roomKey(roomId)).emit(`${cfg.prefix}:react`, {
        kind,
        name: socket.user.name,
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      });
    });

    // Free the room's game once no seated human remains connected.
    socket.on("disconnecting", () => {
      const rooms = [...socket.rooms].filter((k) => k.startsWith("room:")).map((k) => k.slice(5));
      setImmediate(async () => {
        for (const roomId of rooms) {
          if (!games.has(roomId)) continue;
          const sockets = await io.in(roomKey(roomId)).fetchSockets();
          seats.releaseIfEmpty(roomId, new Set(sockets.map((s) => s.user.id)));
        }
      });
    });
  }

  // `seats` and `cfg` are what the plugin adapter consumes: the same rules and
  // callbacks, with no transport attached. Exposing `cfg` means a game exports
  // only its instance — the adapter reads minPlayers/events/tick/etc. straight
  // from the config it was built with, so the two can never drift.
  //
  // `broadcastFor`/`makeCtx` close over `io` and are therefore for the LEGACY
  // path only. A plugin must never receive them; see lobbyGameAdapter.js.
  return { register, games, seats, cfg, broadcastFor: broadcast, makeCtx };
}
