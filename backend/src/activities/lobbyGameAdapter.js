/**
 * ONE adapter that hosts ANY lobby game as a plugin.
 *
 * WHY THIS IS NOT FOUR MIGRATIONS
 * The migration plan lists chess, uno, typing and bingo as "four framework
 * games, near-mechanical". They are near-mechanical precisely because they are
 * already thin configs over `sockets/lobbyGame.js` — which is itself a plugin
 * framework: games supply pure callbacks (start, publicState, privateState,
 * botAct, tick) and never touch socket.io. §1.2 of the migration plan says so
 * outright: *"That is an SDK. The plugin contract should extend it, not replace
 * it."*
 *
 * So the honest migration is one adapter, not four rewrites. Writing four
 * near-identical server modules would have duplicated the seat/bot/timer logic
 * the framework exists to share, and every future lobby game would pay the same
 * tax. Each game costs two registration lines and zero new logic.
 *
 * WHAT THE ADAPTER ACTUALLY DOES
 * `createLobbyGame()` returns `{ register, games, broadcastFor, makeCtx }` where
 * `register(io, socket)` attaches `<prefix>:*` listeners directly. The plugin
 * host instead routes everything through one `activity:event` dispatcher, so
 * this translates between the two:
 *
 *   host event  "join" / "start" / "move" …   →  the framework's handler
 *   framework broadcast  "<prefix>:state"     →  "activity:<id>:state"
 *
 * The framework's own guards (host-only start, seated-only moves, spectator
 * lock) still run — they live in the callbacks, not in the transport. What the
 * host adds on top is what it adds for every plugin: canAccessRoom, the
 * activity-installed check, per-event rate limiting and error isolation.
 *
 * LIFECYCLE
 * `destroy(roomId)` clears the game's afk/bot/tick timers and drops it. The
 * framework already had this logic on `disconnecting`; routing it through the
 * host's destroy() is what makes it uniform with every other plugin — and is
 * the rehearsal that matters for Kart, whose tick loop is a real cost if it
 * leaks.
 */
import { REACTION_KINDS, DIFFICULTIES } from "../sockets/lobbyGame.js";
import { logger } from "../utils/logger.js";

/**
 * Wrap a lobby-game instance as an activity server module.
 *
 * @param {string} pluginId  manifest id ("chess")
 * @param {object} lobby     the object returned by createLobbyGame()
 * @param {object} cfg       the same config passed to createLobbyGame()
 */
export function adaptLobbyGame(pluginId, lobby, cfg) {
  // The state Map and the transport-free seat rules. `broadcastFor`/`makeCtx`
  // are deliberately NOT used: both close over `io`, which is exactly what a
  // plugin must not hold. Their behaviour is rebuilt below on the detached
  // broadcaster, which reaches this plugin in this room and nothing else.
  const { games, seats } = lobby;

  /** The framework's view of a table, as every client receives it. */
  const snapshot = (g) => ({
    ...cfg.publicState(g),
    status: g.status,
    hostId: g.hostId,
    players: g.players,
    turnDeadline: g.turnDeadline,
  });

  /**
   * Mirror the framework's state onto the ACTIVITY channel.
   *
   * The framework broadcasts on the room channel (`room:<id>`) under its own
   * prefix; the plugin protocol expects `activity:<id>:<event>` on the activity
   * channel. Mirroring rather than rewriting the framework's every emit means
   * the framework stays untouched and keeps serving legacy clients during the
   * migration — and when the last one is gone, this function is what gets
   * deleted rather than a rewrite being unpicked.
   *
   * Takes a DETACHED broadcaster, so it is equally valid from a request and
   * from the framework's bot/AFK timers, which fire with no socket in scope.
   */
  function mirror(wire, roomId) {
    const g = games.get(roomId);
    if (!g) return;
    // Order matters and matches the framework's own broadcast(): arm the AFK
    // clock BEFORE publishing so `turnDeadline` is in the snapshot clients
    // receive, then hand the bot its turn after they have seen the board.
    armAfk(wire, roomId);
    wire.broadcast("state", snapshot(g));
    // Fire-and-forget, with the rejection swallowed: a private send that fails
    // must not become an unhandled rejection on a path every move runs through.
    sendPrivate(wire, roomId, g).catch((err) => logger.error(`[${pluginId}] private state failed:`, err));
    armBot(wire, roomId);
  }

  /**
   * Per-seat secrets — UNO's hand, chess's nothing.
   *
   * `members()` gives ids only, never socket objects, so this can address each
   * player without the plugin ever holding something that could emit to
   * arbitrary events or reach `.server`. Fire-and-forget, exactly as the
   * framework does it: a failed private send must not stall the public
   * broadcast everyone else is waiting on.
   */
  async function sendPrivate(wire, roomId, g) {
    if (!cfg.privateState) return;
    for (const { userId } of await wire.members()) {
      if (!g.players.some((p) => p.id === userId)) continue;
      const priv = cfg.privateState(g, userId);
      if (priv) wire.toUser(userId, "private", priv);
    }
  }

  /**
   * The three timers the framework arms, rebuilt on the detached wire.
   *
   * All of them fire long after the request that armed them, which is the whole
   * reason `detached()` exists — a request-scoped broadcaster would be pointing
   * at a socket that has since gone.
   */
  function armAfk(wire, roomId) {
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
      cfg.onAfkTimeout?.(pluginCtx(wire, roomId));
    }, Math.max(50, deadline - Date.now()));
  }

  function armBot(wire, roomId) {
    const g = games.get(roomId);
    if (!g || g.status !== "playing" || !cfg.botTurn?.(g)) return;
    clearTimeout(g.botTimer);
    g.botTimer = setTimeout(() => {
      const cur = games.get(roomId);
      if (!cur || cur.status !== "playing" || !cfg.botTurn?.(cur)) return;
      cfg.botAct?.(pluginCtx(wire, roomId));
    }, cfg.botDelayMs?.(g) ?? 900);
  }

  function startTicker(wire, roomId) {
    const g = games.get(roomId);
    if (!g || !cfg.tick) return;
    clearInterval(g.tickTimer);
    g.tickTimer = setInterval(() => {
      const cur = games.get(roomId);
      // Self-clearing: a ticker that outlives its game is the leak destroy()
      // is there to catch, but it should not need catching in the normal case.
      if (!cur || cur.status !== "playing") { clearInterval(g.tickTimer); g.tickTimer = null; return; }
      cfg.tick.onTick(pluginCtx(wire, roomId));
    }, cfg.tick.ms);
  }

  /**
   * Seat-management and move events, generated from the framework's own config
   * rather than listed here — a game that declares a new move gets it for free,
   * and this file never learns any game's rules.
   */
  const events = {
    /** Current state for a late joiner, including their private hand. */
    sync(sdk, _payload, ack) {
      const g = games.get(sdk.room.id);
      if (!g) return ack?.({ ok: true, state: null });
      ack?.({ ok: true, state: { ...snapshot(g), you: cfg.privateState?.(g, sdk.user.id) || null } });
    },

    react(sdk, { kind } = {}) {
      // Spectators may react too — it is the crowd noise, not a move.
      if (!REACTION_KINDS.includes(kind)) return;
      sdk.socket.broadcast("react", {
        kind,
        name: sdk.user.name,
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      });
    },

    /**
     * ── SEAT LIFECYCLE ────────────────────────────────────────────────────
     * Delegated to `lobby.seats`, the transport-free half of the framework.
     * These used to live inside `createLobbyGame`'s socket registration, so a
     * plugin migration meant reimplementing join/leave/start/reset/bots —
     * duplicating the exact logic the framework exists to share, once per game.
     * Now both paths call the same functions and only publishing differs.
     */
    join(sdk, _payload, ack) {
      const res = seats.join(sdk.room.id, { id: sdk.user.id, name: sdk.user.name });
      if (res.error) return ack?.(res);
      if (res.changed) mirror(sdk.socket.detached(), sdk.room.id);
      ack?.({ ok: true });
    },

    leave(sdk, _payload, ack) {
      const res = seats.leave(sdk.room.id, sdk.user.id);
      if (res.changed) mirror(sdk.socket.detached(), sdk.room.id);
      ack?.({ ok: true });
    },

    addBot(sdk, { difficulty } = {}, ack) {
      if (!cfg.allowBots) return ack?.({ error: "This game has no bots" });
      const res = seats.addBot(sdk.room.id, sdk.user.id, difficulty);
      if (res.error) return ack?.(res);
      mirror(sdk.socket.detached(), sdk.room.id);
      ack?.({ ok: true });
    },

    removeBot(sdk, { botId } = {}, ack) {
      if (!cfg.allowBots) return ack?.({ error: "This game has no bots" });
      const res = seats.removeBot(sdk.room.id, sdk.user.id, botId);
      if (res.error) return ack?.(res);
      mirror(sdk.socket.detached(), sdk.room.id);
      ack?.({ ok: true });
    },

    start(sdk, _payload, ack) {
      const res = seats.start(sdk.room.id, sdk.user.id);
      if (res.error) return ack?.(res);
      const wire = sdk.socket.detached();
      mirror(wire, sdk.room.id);
      startTicker(wire, sdk.room.id);
      ack?.({ ok: true });
    },

    reset(sdk, _payload, ack) {
      const res = seats.reset(sdk.room.id, sdk.user.id);
      if (res.error) return ack?.(res);
      mirror(sdk.socket.detached(), sdk.room.id);
      ack?.({ ok: true });
    },
  };

  /**
   * Rebuild the framework's `ctx` on top of the SDK — NOT on raw `io`.
   *
   * This is the crux of the migration. `createLobbyGame`'s own `makeCtx` closes
   * over `io`, which a plugin must never hold: `io` addresses every room on the
   * server, so handing it over would make capability isolation (guarantee #5)
   * decorative. Every game callback uses `ctx.broadcast/notice/emit/endGame`
   * and nothing else, so those four can be rebuilt from a detached broadcaster
   * — which reaches this plugin, in this room, and nothing else.
   *
   * The framework's `games` Map is shared, so state stays identical to the
   * legacy path; only the transport differs.
   */
  function pluginCtx(wire, roomId) {
    const g = games.get(roomId);
    const ctx = {
      g,
      roomId,
      games,
      broadcast: () => mirror(wire, roomId),
      notice: (text) => wire.broadcast("notice", { text }),
      emit: (event, payload) => wire.broadcast(event, payload),
      endGame: () => {
        if (!g) return;
        g.status = "ended";
        clearTimeout(g.afkTimer);
        clearTimeout(g.botTimer);
        clearInterval(g.tickTimer);
        g.afkTimer = g.botTimer = g.tickTimer = null;
        mirror(wire, roomId);
      },
    };
    return ctx;
  }

  /**
   * Every game-specific move, taken from the framework's own `events` config.
   *
   * Generated rather than listed: a game that adds a move gets it through the
   * host for free, and this file never learns what any move means. The
   * seated/playing guards are the framework's own, restated here because the
   * host dispatches before the framework's registration would have run.
   */
  for (const [name, handler] of Object.entries(cfg.events || {})) {
    if (events[name]) continue; // never shadow the adapter's own events
    events[name] = (sdk, payload = {}, ack) => {
      const g = games.get(sdk.room.id);
      if (!g || g.status !== "playing") return ack?.({ error: "No game running" });
      const seat = g.players.find((p) => p.id === sdk.user.id);
      if (!seat) return ack?.({ error: "You're spectating" });
      const wire = sdk.socket.detached();
      handler(pluginCtx(wire, sdk.room.id), { ...payload, playerId: sdk.user.id, seat }, ack);
      mirror(wire, sdk.room.id);
    };
  }

  /** Host-only lobby settings (chess time control, etc.). */
  for (const [name, handler] of Object.entries(cfg.lobbyEvents || {})) {
    if (events[name]) continue;
    events[name] = (sdk, payload = {}, ack) => {
      const g = games.get(sdk.room.id);
      if (!g || g.status !== "lobby") return ack?.({ error: "Only in the lobby" });
      if (g.hostId !== sdk.user.id) return ack?.({ error: "Only the host can change settings" });
      const wire = sdk.socket.detached();
      handler(pluginCtx(wire, sdk.room.id), payload, ack);
      mirror(wire, sdk.room.id);
    };
  }

  return {
    /** Entering the activity returns the table as it stands. */
    async onJoin(sdk) {
      const g = games.get(sdk.room.id);
      if (!g) return null;
      return { ...snapshot(g), you: cfg.privateState?.(g, sdk.user.id) || null };
    },

    rates: {
      react: { max: 6, windowMs: 4000 },
      // Moves are deliberate acts in a turn-based game; the default 40/s is
      // generous enough and the framework rejects out-of-turn moves anyway.
    },

    events,

    /**
     * Free the table when the activity empties.
     *
     * The framework cleared timers on `disconnecting`; the host calls this
     * instead, so every plugin's teardown looks the same. Leaked afk/bot/tick
     * timers are the failure mode Kart makes expensive — this is the cheap
     * rehearsal.
     */
    destroy(roomId) {
      const g = games.get(roomId);
      if (!g) return;
      clearTimeout(g.afkTimer);
      clearTimeout(g.botTimer);
      clearInterval(g.tickTimer);
      games.delete(roomId);
      logger.info(`[${pluginId}] table freed for room ${roomId}`);
    },

    // Exposed for tests: the adapter's whole job is translation, so the thing
    // worth asserting is that the framework's state is reachable through it.
    __games: games,
  };
}

export { REACTION_KINDS, DIFFICULTIES };
