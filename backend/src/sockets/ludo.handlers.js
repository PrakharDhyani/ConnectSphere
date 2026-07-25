/**
 * Ludo — server-authoritative board game, one per room.
 *
 * Lobby: players take a colored seat; the host starts (2–4 players). Then turns
 * rotate: roll the die → if you have a legal move, pick a token → move it,
 * capturing opponents on shared cells, racing all 4 tokens home. Rolling a 6 (or
 * capturing, or getting a token home) grants another turn; three 6s in a row
 * forfeits the turn. First to get all 4 tokens to the center wins.
 *
 * The server owns the dice, the board, and turn order; clients only render.
 */
import { COLORS, SAFE, trackIndex } from "../games/ludoBoard.js";
import { canAccessRoom } from "../utils/roomAccess.js";
import { roomKey } from "./chat.handlers.js";

const games = new Map(); // roomId -> game

function freshGame(hostId) {
  return {
    status: "lobby",
    seats: { red: null, green: null, yellow: null, blue: null }, // color -> {id,name}
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
  };
}

function broadcast(io, roomId) {
  const g = games.get(roomId);
  if (g) io.to(roomKey(roomId)).emit("ludo:state", publicState(g));
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

function nextTurn(io, roomId) {
  const g = games.get(roomId);
  if (!g || g.status !== "playing") return;
  g.turnIdx = (g.turnIdx + 1) % g.order.length;
  g.dice = null;
  g.rolled = false;
  g.movable = [];
  g.sixCount = 0;
  broadcast(io, roomId);
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
    for (const c of COLORS) g.tokens[c] = [0, 0, 0, 0];
    broadcast(io, roomId);
    cb?.({ ok: true });
  });

  socket.on("ludo:roll", ({ roomId } = {}) => {
    const g = games.get(roomId);
    if (!g || g.status !== "playing" || g.rolled) return;
    const color = currentColor(g);
    if (g.seats[color]?.id !== socket.user.id) return; // not your turn

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
        } else {
          nextTurn(io, roomId);
        }
      }, 1200);
      return;
    }

    g.movable = movable;
    g.rolled = true;
    broadcast(io, roomId);
  });

  socket.on("ludo:move", ({ roomId, token } = {}) => {
    const g = games.get(roomId);
    if (!g || g.status !== "playing" || !g.rolled) return;
    const color = currentColor(g);
    if (g.seats[color]?.id !== socket.user.id) return;
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
      broadcast(io, roomId);
      return;
    }

    g.rolled = false;
    g.movable = [];
    const extraTurn = g.dice === 6 || captured || reachedHome;
    if (extraTurn) {
      g.dice = null; // same player rolls again (sixCount preserved for the 6 case)
      broadcast(io, roomId);
    } else {
      nextTurn(io, roomId);
    }
  });

  socket.on("ludo:reset", ({ roomId } = {}) => {
    const g = games.get(roomId);
    if (!g || g.hostId !== socket.user.id) return;
    clearTimeout(g.timer);
    games.set(roomId, freshGame(socket.user.id));
    broadcast(io, roomId);
  });
}
