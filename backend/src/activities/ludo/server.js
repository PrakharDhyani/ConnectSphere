/**
 * Ludo — server module.
 *
 * The last bespoke migration before Kart, and the one with the most timers:
 * turn clock, AFK clock, auto-move, bot roll, bot move, and the 1.2s dead-dice
 * pause. Every one of them fires with no socket in scope, so like skribbl (§52)
 * this module lives on `sdk.socket.detached()` throughout.
 *
 * WHY THIS IS NOT AN adaptLobbyGame() ONE-LINER
 * Ludo *grew* the seat/bot/AFK logic that later became `lobbyGame.js`, but was
 * never moved onto it — so the resemblance is ancestral, not structural. Its
 * seats are COLOUR-KEYED (red/green/yellow/blue), not a flat player list: the
 * board has four fixed positions, turn order is a list of colours, and a token's
 * legal moves are computed from its colour's track. `lobby.seats` models seats
 * as an ordered array of users, which is exactly the wrong shape here. Adapting
 * would have meant translating colour↔index on every call — more code than the
 * transport swap, and a new class of off-by-one bug in the turn rotation.
 *
 * So the same choice as skribbl: port the rules VERBATIM, change only the
 * transport, keep the diff against `ludo.handlers.js` reviewable.
 *
 *   io.to(roomKey(roomId)).emit("ludo:x")  →  bus.broadcast("x")
 *   canAccessRoom / socket.rooms / allow() →  deleted; the host does all three
 *
 * THE BOT/HUMAN SHARED PATH IS THE INVARIANT WORTH PRESERVING
 * `doRoll`/`doMove` take no socket: a human's event validates identity then
 * calls them, and a bot's timer calls the same functions. Bots therefore
 * physically cannot make a move a human couldn't — they only choose among
 * `g.movable`, which the server built. That property is what makes the bots
 * trustworthy, and it survives the migration untouched because those functions
 * never knew about sockets in the first place. They now take the bus instead of
 * `io`, which is the same shape of dependency with a much smaller blast radius.
 *
 * EPHEMERAL BY DESIGN, like skribbl and the framework games: a half-finished
 * turn restored after a restart resumes with a dice roll nobody saw and an AFK
 * clock that already expired. `destroy()` clearing the four timer handles is the
 * only cleanup that matters.
 */
import { COLORS, SAFE, trackIndex } from "../../games/ludoBoard.js";
import { chooseMove, botSeat, delaysFor, DIFFICULTIES, DEFAULT_DIFFICULTY } from "../../games/ludoBot.js";

/** roomId -> game. Ephemeral by design (see header). */
const games = new Map();

// ── AFK rules ──
// A human has `turnMs` to roll; if they don't, the server rolls for them and
// (1.5s later, so the dice is visible) moves a random legal token. A manual roll
// grants MOVE_MS to pick a token before the server picks one. Only turns where
// the ROLL was automatic count as "missed" — 3 in a row ejects the seat.
const DEFAULT_TURN_MS = 30_000;
const MOVE_MS = 15_000;
const AFK_LIMIT = 3;

const REACTION_KINDS = new Set(["angry", "fire", "kiss", "love", "gunshot", "laugh"]);

const isBotSeat = (seat) => Boolean(seat?.isBot);
const humanSeatIds = (g) => COLORS.map((c) => g.seats[c]).filter((s) => s && !s.isBot).map((s) => s.id);

function freshGame(hostId) {
  return {
    status: "lobby",
    seats: { red: null, green: null, yellow: null, blue: null }, // color -> {id,name,isBot?,difficulty?}
    order: [],
    turnIdx: 0,
    dice: null,
    rolled: false,
    movable: [],
    tokens: { red: [0, 0, 0, 0], green: [0, 0, 0, 0], yellow: [0, 0, 0, 0], blue: [0, 0, 0, 0] },
    sixCount: 0,
    winner: null,
    hostId,
    timer: null,
    botTimer: null,
    afkTimer: null,
    autoMoveTimer: null,
    afk: {}, // color -> consecutive fully-auto turns
    turnDeadline: null, // epoch ms the current human must act by (null for bots)
    // Per-room config, read from the manifest's configSchema at join.
    maxSeats: 4,
    allowBots: true,
    botDifficulty: DEFAULT_DIFFICULTY,
    turnMs: DEFAULT_TURN_MS,
    /**
     * The detached broadcaster, captured once per room and refreshed on join.
     *
     * Same reasoning as skribbl: it closes over the activity key alone, so any
     * member's is equivalent — but one built from a socket that has since
     * disconnected is not guaranteed to outlive it, and this game's timer chain
     * routinely outlives the player who started it (a bot game runs itself).
     */
    bus: null,
  };
}

const currentColor = (g) => g.order[g.turnIdx] || null;

/** A blank lobby to render before anyone has taken a seat (no game object yet). */
function emptyLobby() {
  return {
    status: "lobby",
    seats: { red: null, green: null, yellow: null, blue: null },
    order: [],
    turn: null,
    dice: null,
    rolled: false,
    movable: [],
    tokens: { red: [0, 0, 0, 0], green: [0, 0, 0, 0], yellow: [0, 0, 0, 0], blue: [0, 0, 0, 0] },
    winner: null,
    hostId: null,
  };
}

function publicState(g) {
  return {
    status: g.status,
    seats: g.seats,
    order: g.order,
    turn: currentColor(g),
    dice: g.dice,
    rolled: g.rolled,
    movable: g.movable,
    tokens: g.tokens,
    winner: g.winner,
    hostId: g.hostId,
    turnDeadline: g.turnDeadline,
  };
}

/**
 * Broadcast doubles as the AFK-timer arming point: every state change flows
 * through here, so the "current human must act by X" clock can never drift from
 * what clients were told.
 */
function broadcast(roomId) {
  const g = games.get(roomId);
  if (!g) return;
  armAfkTimer(roomId);
  g.bus?.broadcast("state", publicState(g));
}

function notice(roomId, text) {
  games.get(roomId)?.bus?.broadcast("notice", { text });
}

function clearTimers(g) {
  if (!g) return;
  clearTimeout(g.timer);
  clearTimeout(g.botTimer);
  clearTimeout(g.afkTimer);
  clearTimeout(g.autoMoveTimer);
  g.timer = null;
  g.botTimer = null;
  g.afkTimer = null;
  g.autoMoveTimer = null;
}

// ── AFK enforcement ──────────────────────────────────────────────────────────

function armAfkTimer(roomId) {
  const g = games.get(roomId);
  if (!g) return;
  clearTimeout(g.afkTimer);
  g.afkTimer = null;
  g.turnDeadline = null;
  if (g.status !== "playing" || g.winner) return;
  // Turn timer set to "Off" in room config — no deadline, no auto-play.
  if (!g.turnMs) return;
  const color = currentColor(g);
  const seat = g.seats[color];
  if (!seat || seat.isBot) return; // bots have their own pacing

  // Which decision is pending? No decision (e.g. the 1.2s dead-dice window
  // before an automatic turn advance) → no timer.
  let wait = null;
  if (!g.rolled) wait = g.turnMs;
  else if (g.movable?.length) wait = MOVE_MS;
  if (wait === null) return;

  g.turnDeadline = Date.now() + wait;
  g.afkTimer = setTimeout(() => onAfkTimeout(roomId, color), wait);
}

function onAfkTimeout(roomId, color) {
  const g = games.get(roomId);
  if (!g || g.status !== "playing" || currentColor(g) !== color) return;
  const seat = g.seats[color];
  if (!seat || seat.isBot) return;

  if (!g.rolled) {
    // Whole turn missed — the strike that counts toward ejection.
    g.afk[color] = (g.afk[color] || 0) + 1;
    if (g.afk[color] >= AFK_LIMIT) {
      kickSeat(roomId, color, "inactive for 3 turns");
      return;
    }
    notice(roomId, `⏰ Auto-rolling for ${seat.name} (${g.afk[color]}/${AFK_LIMIT} missed turns)`);
    doRoll(roomId);
    // Give the dice a beat on screen, then move a random legal token — the
    // player is absent, waiting the full move window would stall the table.
    clearTimeout(g.autoMoveTimer);
    g.autoMoveTimer = setTimeout(() => {
      const cur = games.get(roomId);
      if (!cur || cur.status !== "playing" || currentColor(cur) !== color || !cur.rolled) return;
      if (cur.movable?.length) {
        doMove(roomId, cur.movable[Math.floor(Math.random() * cur.movable.length)]);
      }
    }, 1500);
  } else if (g.movable?.length) {
    // They rolled but never picked a token — play a random one. Doesn't count
    // as a missed turn (they were present for the roll).
    notice(roomId, `⏰ ${seat.name} ran out of time — moving a random token`);
    doMove(roomId, g.movable[Math.floor(Math.random() * g.movable.length)]);
  }
}

/**
 * Remove a seat mid-game (AFK ejection). Their tokens leave the board; the game
 * continues — or ends immediately when only one player remains.
 */
function kickSeat(roomId, color, reason) {
  const g = games.get(roomId);
  if (!g) return;
  const seat = g.seats[color];
  if (!seat) return;

  notice(roomId, `🚪 ${seat.name} was removed — ${reason}`);
  const wasTurn = currentColor(g) === color;
  const idx = g.order.indexOf(color);

  g.seats[color] = null;
  g.tokens[color] = [0, 0, 0, 0];
  delete g.afk[color];
  if (idx !== -1) {
    g.order.splice(idx, 1);
    if (idx < g.turnIdx) g.turnIdx -= 1;
    if (g.turnIdx >= g.order.length) g.turnIdx = 0;
  }

  // The game host must stay a real, seated human (bots never host).
  if (g.hostId === seat.id) {
    const human = COLORS.map((c) => g.seats[c]).find((s) => s && !s.isBot);
    g.hostId = human?.id || g.hostId;
  }

  if (g.order.length <= 1) {
    g.status = "ended";
    g.winner = g.order[0] || null;
    g.rolled = false;
    g.movable = [];
    clearTimers(g);
    broadcast(roomId);
    return;
  }

  if (wasTurn) {
    g.dice = null;
    g.rolled = false;
    g.movable = [];
    g.sixCount = 0;
  }
  broadcast(roomId);
  maybeBotTurn(roomId);
}

function movableTokens(g, color) {
  const out = [];
  g.tokens[color].forEach((step, i) => {
    if (step === 0) {
      if (g.dice === 6) out.push(i);
    } else if (step < 57 && step + g.dice <= 57) {
      out.push(i);
    }
  });
  return out;
}

// ── Bot turn driver ──────────────────────────────────────────────────────────
// Called after every state change that can hand the turn to a bot. If the seat
// to act is a bot, schedule its roll (and then its move) on a timer so the game
// is watchable rather than instant.
function maybeBotTurn(roomId) {
  const g = games.get(roomId);
  if (!g || g.status !== "playing" || g.winner) return;
  const color = currentColor(g);
  const seat = g.seats[color];
  if (!isBotSeat(seat)) return;

  const delays = delaysFor(seat.difficulty);
  clearTimeout(g.botTimer);

  if (!g.rolled) {
    g.botTimer = setTimeout(() => {
      const cur = games.get(roomId);
      // Re-check everything: the game may have been reset while we waited.
      if (!cur || cur.status !== "playing" || currentColor(cur) !== color || cur.rolled) return;
      doRoll(roomId);
    }, delays.roll);
    return;
  }

  if (g.movable?.length) {
    g.botTimer = setTimeout(() => {
      const cur = games.get(roomId);
      if (!cur || cur.status !== "playing" || currentColor(cur) !== color || !cur.rolled) return;
      const token = chooseMove(cur, color, cur.movable, seat.difficulty);
      if (token !== null && token !== undefined) doMove(roomId, token);
    }, delays.move);
  }
}

function nextTurn(roomId) {
  const g = games.get(roomId);
  if (!g || g.status !== "playing") return;
  g.turnIdx = (g.turnIdx + 1) % g.order.length;
  g.dice = null;
  g.rolled = false;
  g.movable = [];
  g.sixCount = 0;
  broadcast(roomId);
  maybeBotTurn(roomId);
}

// ── Rules (socket-free, so bots and humans share one code path) ──────────────

function doRoll(roomId) {
  const g = games.get(roomId);
  if (!g || g.status !== "playing" || g.rolled) return;
  const color = currentColor(g);

  g.dice = 1 + Math.floor(Math.random() * 6);
  if (g.dice === 6) g.sixCount += 1;

  // Three 6s in a row → forfeit the turn.
  if (g.sixCount === 3) {
    broadcast(roomId);
    g.timer = setTimeout(() => nextTurn(roomId), 1200);
    return;
  }

  const movable = movableTokens(g, color);
  if (movable.length === 0) {
    g.movable = [];
    g.rolled = true;
    broadcast(roomId);
    const extra = g.dice === 6; // rolled a 6 but nothing to move → still lose turn
    g.timer = setTimeout(() => {
      if (extra) {
        g.rolled = false;
        g.dice = null;
        broadcast(roomId); // same player rolls again
        maybeBotTurn(roomId);
      } else {
        nextTurn(roomId);
      }
    }, 1200);
    return;
  }

  g.movable = movable;
  g.rolled = true;
  broadcast(roomId);
  maybeBotTurn(roomId); // a bot now picks its token

  // Quality of life: exactly ONE legal token → there's no decision to make, so
  // play it automatically after a beat (long enough to read the dice).
  const seat = g.seats[color];
  if (movable.length === 1 && seat && !seat.isBot) {
    clearTimeout(g.autoMoveTimer);
    g.autoMoveTimer = setTimeout(() => {
      const cur = games.get(roomId);
      if (!cur || cur.status !== "playing" || currentColor(cur) !== color) return;
      if (!cur.rolled || cur.movable.length !== 1) return; // they already moved
      doMove(roomId, cur.movable[0]);
    }, 900);
  }
}

function doMove(roomId, token) {
  const g = games.get(roomId);
  if (!g || g.status !== "playing" || !g.rolled) return;
  const color = currentColor(g);
  if (!g.movable.includes(token)) return;

  const step = g.tokens[color][token];
  const newStep = step === 0 ? 1 : step + g.dice;
  g.tokens[color][token] = newStep;

  // Capture any opponent tokens sharing this (non-safe) track cell.
  let captured = false;
  const ti = trackIndex(color, newStep);
  if (ti !== -1 && !SAFE.has(ti)) {
    for (const other of g.order) {
      if (other === color) continue;
      g.tokens[other].forEach((s, i) => {
        if (trackIndex(other, s) === ti) {
          g.tokens[other][i] = 0;
          captured = true;
        }
      });
    }
  }
  const reachedHome = newStep === 57;

  // Win?
  if (g.tokens[color].every((s) => s === 57)) {
    g.status = "ended";
    g.winner = color;
    g.rolled = false;
    g.movable = [];
    clearTimers(g);
    broadcast(roomId);
    return;
  }

  g.rolled = false;
  g.movable = [];
  const extraTurn = g.dice === 6 || captured || reachedHome;
  if (extraTurn) {
    g.dice = null; // same player rolls again (sixCount preserved for the 6 case)
    broadcast(roomId);
    maybeBotTurn(roomId);
  } else {
    nextTurn(roomId);
  }
}

/** Seats a player or bot in the first free colour, respecting the seat cap. */
function freeColor(g) {
  const taken = COLORS.filter((c) => g.seats[c]).length;
  if (taken >= g.maxSeats) return null;
  return COLORS.find((c) => !g.seats[c]) || null;
}

export default {
  /**
   * Opening Ludo does NOT seat you — `join` does.
   *
   * Deliberately different from skribbl, and it matches the legacy behaviour:
   * `ludo:sync` only ever read state, and taking a colour was an explicit
   * `ludo:join`. Someone who opens the tab to watch a game in progress must not
   * consume one of four scarce coloured seats.
   */
  async onJoin(sdk) {
    const roomId = sdk.room.id;
    const g = games.get(roomId);
    // Refresh the detached bus even when only spectating — the game's timers
    // may currently be holding a bus built from a socket that has since gone.
    if (g) {
      g.bus = sdk.socket.detached();
      applyConfig(g, sdk);
      return publicState(g);
    }
    return emptyLobby();
  },

  rates: {
    // Matches the legacy limit exactly.
    react: { max: 6, windowMs: 4000 },
  },

  events: {
    /** Take a coloured seat. Lobby only — a game in progress has fixed seats. */
    join(sdk, _payload, ack) {
      const roomId = sdk.room.id;
      let g = games.get(roomId);
      if (!g) {
        g = freshGame(sdk.user.id);
        g.bus = sdk.socket.detached();
        applyConfig(g, sdk);
        games.set(roomId, g);
      }
      if (g.status !== "lobby") return ack({ error: "Game already in progress" });
      if (COLORS.some((c) => g.seats[c]?.id === sdk.user.id)) return ack({ ok: true });
      const free = freeColor(g);
      if (!free) return ack({ error: "All seats taken" });
      g.seats[free] = { id: sdk.user.id, name: sdk.user.name };
      broadcast(roomId);
      ack({ ok: true, color: free });
    },

    leave(sdk) {
      const g = games.get(sdk.room.id);
      if (!g || g.status !== "lobby") return;
      for (const c of COLORS) if (g.seats[c]?.id === sdk.user.id) g.seats[c] = null;
      broadcast(sdk.room.id);
    },

    // ── Bots ── host-only, lobby-only.
    addBot(sdk, { difficulty } = {}, ack) {
      const roomId = sdk.room.id;
      let g = games.get(roomId);
      if (!g) {
        g = freshGame(sdk.user.id);
        g.bus = sdk.socket.detached();
        applyConfig(g, sdk);
        games.set(roomId, g);
      }
      if (!g.allowBots) return ack({ error: "Bots are disabled in this room" });
      if (g.status !== "lobby") return ack({ error: "Game already in progress" });
      if (g.hostId !== sdk.user.id) return ack({ error: "Only the host can add bots" });
      const free = freeColor(g);
      if (!free) return ack({ error: "All seats taken" });
      // An explicit choice wins; otherwise the room's configured default.
      const diff = DIFFICULTIES.includes(difficulty) ? difficulty : g.botDifficulty;
      g.seats[free] = botSeat(free, diff);
      broadcast(roomId);
      ack({ ok: true, color: free });
    },

    removeBot(sdk, { color } = {}, ack) {
      const g = games.get(sdk.room.id);
      if (!g || g.status !== "lobby") return ack({ error: "Cannot remove now" });
      if (g.hostId !== sdk.user.id) return ack({ error: "Only the host can remove bots" });
      const target = color && isBotSeat(g.seats[color])
        ? color
        : [...COLORS].reverse().find((c) => isBotSeat(g.seats[c]));
      if (!target) return ack({ error: "No bot to remove" });
      g.seats[target] = null;
      broadcast(sdk.room.id);
      ack({ ok: true });
    },

    start(sdk, _payload, ack) {
      const roomId = sdk.room.id;
      const g = games.get(roomId);
      if (!g || g.status !== "lobby") return ack({ error: "Cannot start" });
      if (g.hostId !== sdk.user.id) return ack({ error: "Only the host can start" });
      const seated = COLORS.filter((c) => g.seats[c]);
      if (seated.length < 2) return ack({ error: "Need at least 2 players" });
      g.order = seated;
      g.turnIdx = 0;
      g.status = "playing";
      g.dice = null;
      g.rolled = false;
      g.winner = null;
      g.sixCount = 0;
      g.afk = {};
      for (const c of COLORS) g.tokens[c] = [0, 0, 0, 0];
      broadcast(roomId);
      maybeBotTurn(roomId); // the first seat may itself be a bot
      ack({ ok: true });
    },

    roll(sdk) {
      const g = games.get(sdk.room.id);
      if (!g || g.status !== "playing" || g.rolled) return;
      const color = currentColor(g);
      if (g.seats[color]?.id !== sdk.user.id) return; // not your turn (or it's a bot's)
      g.afk[color] = 0; // acting manually clears the inactivity strikes
      doRoll(sdk.room.id);
    },

    move(sdk, { token } = {}) {
      const g = games.get(sdk.room.id);
      if (!g || g.status !== "playing" || !g.rolled) return;
      const color = currentColor(g);
      if (g.seats[color]?.id !== sdk.user.id) return;
      g.afk[color] = 0;
      doMove(sdk.room.id, token);
    },

    /**
     * Sticker reactions — same event shape as the lobby-framework games, so the
     * client shares one reaction system across every game.
     */
    react(sdk, { kind } = {}) {
      if (!REACTION_KINDS.has(kind)) return;
      sdk.socket.broadcast("react", {
        kind,
        name: sdk.user.name,
        // Unique-enough id for React keys across senders and rapid taps.
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      });
    },

    reset(sdk) {
      const roomId = sdk.room.id;
      const g = games.get(roomId);
      if (!g || g.hostId !== sdk.user.id) return;
      clearTimers(g);
      // Keep the seats (including bots) so "play again" doesn't rebuild the lobby.
      const fresh = freshGame(sdk.user.id);
      fresh.seats = g.seats;
      fresh.bus = g.bus;
      fresh.maxSeats = g.maxSeats;
      fresh.allowBots = g.allowBots;
      fresh.botDifficulty = g.botDifficulty;
      fresh.turnMs = g.turnMs;
      games.set(roomId, fresh);
      broadcast(roomId);
    },
  },

  /**
   * Free the game and its four timers once the last participant leaves.
   *
   * The legacy handler had to ask "is any HUMAN seated player still connected?"
   * because a table of bots would otherwise keep running forever. The host's
   * teardown already answers the stronger question — is *anyone* still in this
   * activity — so a bot-only table is freed for the same reason an empty one is.
   */
  destroy(roomId) {
    const g = games.get(roomId);
    if (!g) return;
    clearTimers(g);
    games.delete(roomId);
  },
};

/** Per-room settings from the manifest's configSchema. */
function applyConfig(g, sdk) {
  const cfg = sdk.meta.config || {};
  // Four coloured seats is a property of the board, so this cannot exceed 4.
  g.maxSeats = Math.min(Math.max(Number(cfg.maxPlayers) || 4, 2), 4);
  g.allowBots = cfg.allowBots !== false;
  g.botDifficulty = DIFFICULTIES.includes(cfg.botDifficulty) ? cfg.botDifficulty : DEFAULT_DIFFICULTY;
  // "Off" is 0 and must stay 0 — `|| DEFAULT` would silently re-enable it.
  const t = Number(cfg.turnTimer);
  g.turnMs = Number.isFinite(t) ? t * 1000 : DEFAULT_TURN_MS;
}

/** Test seam — lets a suite assert that destroy() actually freed the room. */
export const __games = games;
export { humanSeatIds };
