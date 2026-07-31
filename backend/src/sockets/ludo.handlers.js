/**
 * Ludo — server-authoritative board game, one per room.
 *
 * Lobby: players take a colored seat (or the host adds bots); the host starts
 * (2–4 seats). Then turns rotate: roll the die → if you have a legal move, pick
 * a token → move it, capturing opponents on shared cells, racing all 4 tokens
 * home. Rolling a 6 (or capturing, or getting a token home) grants another turn;
 * three 6s in a row forfeits the turn. First to get all 4 tokens to the center
 * wins.
 *
 * The server owns the dice, the board, and turn order; clients only render.
 *
 * BOTS: the roll/move rules live in `doRoll` / `doMove`, which take no socket.
 * A human's socket event validates identity and then calls them; a bot's timer
 * calls exactly the same functions. So bots physically cannot make a move a
 * human couldn't — they only choose among `g.movable`, which the server built.
 */
import { COLORS, SAFE, trackIndex } from "../games/ludoBoard.js";
import { chooseMove, botSeat, delaysFor, DIFFICULTIES, DEFAULT_DIFFICULTY } from "../games/ludoBot.js";
import { canAccessRoom } from "../utils/roomAccess.js";
import { allow } from "../utils/socketRate.js";
import { roomKey } from "./chat.handlers.js";

const games = new Map(); // roomId -> game

// ── AFK rules ──
// A human has TURN_MS to roll; if they don't, the server rolls for them and
// (1.5s later, so the dice is visible) moves a random legal token. A manual
// roll grants MOVE_MS to pick a token before the server picks one. Only turns
// where the ROLL was automatic count as "missed" — 3 in a row ejects the seat.
const TURN_MS = 30_000;
const MOVE_MS = 15_000;
const AFK_LIMIT = 3;

const EMOJIS = new Set(["angry", "fire", "kiss", "love", "gunshot"]);

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
  };
}

const currentColor = (g) => g.order[g.turnIdx] || null;

// A blank lobby to render before anyone has taken a seat (no game object yet).
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

// Broadcast doubles as the AFK-timer arming point: every state change flows
// through here, so the "current human must act by X" clock can never drift
// from what clients were told.
function broadcast(io, roomId) {
  const g = games.get(roomId);
  if (!g) return;
  armAfkTimer(io, roomId);
  io.to(roomKey(roomId)).emit("ludo:state", publicState(g));
}

function notice(io, roomId, text) {
  io.to(roomKey(roomId)).emit("ludo:notice", { text });
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

function armAfkTimer(io, roomId) {
  const g = games.get(roomId);
  if (!g) return;
  clearTimeout(g.afkTimer);
  g.afkTimer = null;
  g.turnDeadline = null;
  if (g.status !== "playing" || g.winner) return;
  const color = currentColor(g);
  const seat = g.seats[color];
  if (!seat || seat.isBot) return; // bots have their own pacing

  // Which decision is pending? No decision (e.g. the 1.2s dead-dice window
  // before an automatic turn advance) → no timer.
  let wait = null;
  if (!g.rolled) wait = TURN_MS;
  else if (g.movable?.length) wait = MOVE_MS;
  if (wait === null) return;

  g.turnDeadline = Date.now() + wait;
  g.afkTimer = setTimeout(() => onAfkTimeout(io, roomId, color), wait);
}

function onAfkTimeout(io, roomId, color) {
  const g = games.get(roomId);
  if (!g || g.status !== "playing" || currentColor(g) !== color) return;
  const seat = g.seats[color];
  if (!seat || seat.isBot) return;

  if (!g.rolled) {
    // Whole turn missed — the strike that counts toward ejection.
    g.afk[color] = (g.afk[color] || 0) + 1;
    if (g.afk[color] >= AFK_LIMIT) {
      kickSeat(io, roomId, color, "inactive for 3 turns");
      return;
    }
    notice(io, roomId, `⏰ Auto-rolling for ${seat.name} (${g.afk[color]}/${AFK_LIMIT} missed turns)`);
    doRoll(io, roomId);
    // Give the dice a beat on screen, then move a random legal token — the
    // player is absent, waiting the full move window would stall the table.
    clearTimeout(g.autoMoveTimer);
    g.autoMoveTimer = setTimeout(() => {
      const cur = games.get(roomId);
      if (!cur || cur.status !== "playing" || currentColor(cur) !== color || !cur.rolled) return;
      if (cur.movable?.length) {
        doMove(io, roomId, cur.movable[Math.floor(Math.random() * cur.movable.length)]);
      }
    }, 1500);
  } else if (g.movable?.length) {
    // They rolled but never picked a token — play a random one. Doesn't count
    // as a missed turn (they were present for the roll).
    notice(io, roomId, `⏰ ${seat.name} ran out of time — moving a random token`);
    doMove(io, roomId, g.movable[Math.floor(Math.random() * g.movable.length)]);
  }
}

// Remove a seat mid-game (AFK ejection). Their tokens leave the board; the
// game continues — or ends immediately when only one player remains.
function kickSeat(io, roomId, color, reason) {
  const g = games.get(roomId);
  if (!g) return;
  const seat = g.seats[color];
  if (!seat) return;

  notice(io, roomId, `🚪 ${seat.name} was removed — ${reason}`);
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
    broadcast(io, roomId);
    return;
  }

  if (wasTurn) {
    g.dice = null;
    g.rolled = false;
    g.movable = [];
    g.sixCount = 0;
  }
  broadcast(io, roomId);
  maybeBotTurn(io, roomId);
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
function maybeBotTurn(io, roomId) {
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
      doRoll(io, roomId);
    }, delays.roll);
    return;
  }

  if (g.movable?.length) {
    g.botTimer = setTimeout(() => {
      const cur = games.get(roomId);
      if (!cur || cur.status !== "playing" || currentColor(cur) !== color || !cur.rolled) return;
      const token = chooseMove(cur, color, cur.movable, seat.difficulty);
      if (token !== null && token !== undefined) doMove(io, roomId, token);
    }, delays.move);
  }
}

function nextTurn(io, roomId) {
  const g = games.get(roomId);
  if (!g || g.status !== "playing") return;
  g.turnIdx = (g.turnIdx + 1) % g.order.length;
  g.dice = null;
  g.rolled = false;
  g.movable = [];
  g.sixCount = 0;
  broadcast(io, roomId);
  maybeBotTurn(io, roomId);
}

// ── Rules (socket-free, so bots and humans share one code path) ──────────────

function doRoll(io, roomId) {
  const g = games.get(roomId);
  if (!g || g.status !== "playing" || g.rolled) return;
  const color = currentColor(g);

  g.dice = 1 + Math.floor(Math.random() * 6);
  if (g.dice === 6) g.sixCount += 1;

  // Three 6s in a row → forfeit the turn.
  if (g.sixCount === 3) {
    broadcast(io, roomId);
    g.timer = setTimeout(() => nextTurn(io, roomId), 1200);
    return;
  }

  const movable = movableTokens(g, color);
  if (movable.length === 0) {
    g.movable = [];
    g.rolled = true;
    broadcast(io, roomId);
    const extra = g.dice === 6; // rolled a 6 but nothing to move → still lose turn
    g.timer = setTimeout(() => {
      if (extra) {
        g.rolled = false;
        g.dice = null;
        broadcast(io, roomId); // same player rolls again
        maybeBotTurn(io, roomId);
      } else {
        nextTurn(io, roomId);
      }
    }, 1200);
    return;
  }

  g.movable = movable;
  g.rolled = true;
  broadcast(io, roomId);
  maybeBotTurn(io, roomId); // a bot now picks its token

  // Quality of life: exactly ONE legal token → there's no decision to make,
  // so play it automatically after a beat (long enough to read the dice).
  const seat = g.seats[color];
  if (movable.length === 1 && seat && !seat.isBot) {
    clearTimeout(g.autoMoveTimer);
    g.autoMoveTimer = setTimeout(() => {
      const cur = games.get(roomId);
      if (!cur || cur.status !== "playing" || currentColor(cur) !== color) return;
      if (!cur.rolled || cur.movable.length !== 1) return; // they already moved
      doMove(io, roomId, cur.movable[0]);
    }, 900);
  }
}

function doMove(io, roomId, token) {
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
    broadcast(io, roomId);
    return;
  }

  g.rolled = false;
  g.movable = [];
  const extraTurn = g.dice === 6 || captured || reachedHome;
  if (extraTurn) {
    g.dice = null; // same player rolls again (sixCount preserved for the 6 case)
    broadcast(io, roomId);
    maybeBotTurn(io, roomId);
  } else {
    nextTurn(io, roomId);
  }
}

export function registerLudoHandlers(io, socket) {
  const guard = async (roomId) =>
    Boolean(roomId) && socket.rooms.has(roomKey(roomId)) && (await canAccessRoom(socket.user, roomId));

  socket.on("ludo:sync", ({ roomId } = {}, cb) => {
    const g = games.get(roomId);
    cb?.(g ? publicState(g) : emptyLobby());
  });

  socket.on("ludo:join", async ({ roomId } = {}, cb) => {
    if (!(await guard(roomId))) return cb?.({ error: "Not allowed" });
    let g = games.get(roomId);
    if (!g) {
      g = freshGame(socket.user.id);
      games.set(roomId, g);
    }
    if (g.status !== "lobby") return cb?.({ error: "Game already in progress" });
    // Already seated?
    if (COLORS.some((c) => g.seats[c]?.id === socket.user.id)) return cb?.({ ok: true });
    const free = COLORS.find((c) => !g.seats[c]);
    if (!free) return cb?.({ error: "All seats taken" });
    g.seats[free] = { id: socket.user.id, name: socket.user.name };
    broadcast(io, roomId);
    cb?.({ ok: true, color: free });
  });

  socket.on("ludo:leave", ({ roomId } = {}) => {
    const g = games.get(roomId);
    if (!g || g.status !== "lobby") return;
    for (const c of COLORS) if (g.seats[c]?.id === socket.user.id) g.seats[c] = null;
    broadcast(io, roomId);
  });

  // ── Bots ── host-only, lobby-only.
  socket.on("ludo:addBot", async ({ roomId, difficulty } = {}, cb) => {
    if (!(await guard(roomId))) return cb?.({ error: "Not allowed" });
    let g = games.get(roomId);
    if (!g) {
      g = freshGame(socket.user.id);
      games.set(roomId, g);
    }
    if (g.status !== "lobby") return cb?.({ error: "Game already in progress" });
    if (g.hostId !== socket.user.id) return cb?.({ error: "Only the host can add bots" });
    const free = COLORS.find((c) => !g.seats[c]);
    if (!free) return cb?.({ error: "All seats taken" });
    const diff = DIFFICULTIES.includes(difficulty) ? difficulty : DEFAULT_DIFFICULTY;
    g.seats[free] = botSeat(free, diff);
    broadcast(io, roomId);
    cb?.({ ok: true, color: free });
  });

  socket.on("ludo:removeBot", ({ roomId, color } = {}, cb) => {
    const g = games.get(roomId);
    if (!g || g.status !== "lobby") return cb?.({ error: "Cannot remove now" });
    if (g.hostId !== socket.user.id) return cb?.({ error: "Only the host can remove bots" });
    const target = color && isBotSeat(g.seats[color])
      ? color
      : [...COLORS].reverse().find((c) => isBotSeat(g.seats[c]));
    if (!target) return cb?.({ error: "No bot to remove" });
    g.seats[target] = null;
    broadcast(io, roomId);
    cb?.({ ok: true });
  });

  socket.on("ludo:start", async ({ roomId } = {}, cb) => {
    if (!(await guard(roomId))) return cb?.({ error: "Not allowed" });
    const g = games.get(roomId);
    if (!g || g.status !== "lobby") return cb?.({ error: "Cannot start" });
    if (g.hostId !== socket.user.id) return cb?.({ error: "Only the host can start" });
    const seated = COLORS.filter((c) => g.seats[c]);
    if (seated.length < 2) return cb?.({ error: "Need at least 2 players" });
    g.order = seated;
    g.turnIdx = 0;
    g.status = "playing";
    g.dice = null;
    g.rolled = false;
    g.winner = null;
    g.sixCount = 0;
    g.afk = {};
    for (const c of COLORS) g.tokens[c] = [0, 0, 0, 0];
    broadcast(io, roomId);
    maybeBotTurn(io, roomId); // the first seat may itself be a bot
    cb?.({ ok: true });
  });

  socket.on("ludo:roll", ({ roomId } = {}) => {
    const g = games.get(roomId);
    if (!g || g.status !== "playing" || g.rolled) return;
    const color = currentColor(g);
    if (g.seats[color]?.id !== socket.user.id) return; // not your turn (or it's a bot's)
    g.afk[color] = 0; // acting manually clears the inactivity strikes
    doRoll(io, roomId);
  });

  socket.on("ludo:move", ({ roomId, token } = {}) => {
    const g = games.get(roomId);
    if (!g || g.status !== "playing" || !g.rolled) return;
    const color = currentColor(g);
    if (g.seats[color]?.id !== socket.user.id) return;
    g.afk[color] = 0;
    doMove(io, roomId, token);
  });

  // Emoji reactions — visible to everyone in the room, animated client-side.
  // Rate-limited so nobody wallpapers the board.
  socket.on("ludo:emoji", async ({ roomId, emoji } = {}) => {
    if (!EMOJIS.has(emoji)) return;
    if (!(await guard(roomId))) return;
    if (!allow(socket, "ludoEmoji", 6, 4000)) return;
    io.to(roomKey(roomId)).emit("ludo:emoji", {
      emoji,
      name: socket.user.name,
      // Unique-enough id for React keys across senders and rapid taps.
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    });
  });

  socket.on("ludo:reset", ({ roomId } = {}) => {
    const g = games.get(roomId);
    if (!g || g.hostId !== socket.user.id) return;
    clearTimers(g);
    // Keep the seats (including bots) so "play again" doesn't rebuild the lobby.
    const fresh = freshGame(socket.user.id);
    fresh.seats = g.seats;
    games.set(roomId, fresh);
    broadcast(io, roomId);
  });

  // Free the game (and its timers) once no HUMAN seated player is still
  // connected — a table of bots must never keep a room's game alive.
  socket.on("disconnecting", () => {
    const rooms = [...socket.rooms].filter((k) => k.startsWith("room:")).map((k) => k.slice(5));
    setImmediate(async () => {
      for (const roomId of rooms) {
        const g = games.get(roomId);
        if (!g) continue;
        const sockets = await io.in(roomKey(roomId)).fetchSockets();
        const present = new Set(sockets.map((s) => s.user.id));
        const humans = humanSeatIds(g);
        if (humans.length === 0 || !humans.some((id) => present.has(id))) {
          clearTimers(g);
          games.delete(roomId);
        } else {
          broadcast(io, roomId);
        }
      }
    });
  });
}
