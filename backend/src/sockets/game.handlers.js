/**
 * Skribbl-style draw-and-guess game, one per room.
 *
 * LOBBY first: players join the game and mark themselves "ready"; the host can
 * only start once there are 2+ players and everyone is ready. Then each ready
 * player takes a turn as DRAWER (picks 1 of 3 words, draws it) while the others
 * guess in a timed race. Speed scores the guesser; the drawer scores per correct
 * guesser. After `maxRounds` turns each, a final scoreboard shows.
 *
 * The server is authoritative: it owns the timers, the word, and the scoring,
 * and only tells guessers a MASKED word (hint letters reveal over time). The
 * drawer gets the real word privately (their per-user room).
 */
import { pickWords, maskWord, letterIndices } from "../games/words.js";
import { canAccessRoom } from "../utils/roomAccess.js";
import { allow } from "../utils/socketRate.js";
import { roomKey } from "./chat.handlers.js";

// A drawing segment is normalized 0..1 coords + small style — reject anything else.
const num01 = (n) => typeof n === "number" && n >= -0.1 && n <= 1.1;
const validStroke = (s) =>
  s && num01(s.x0) && num01(s.y0) && num01(s.x1) && num01(s.y1) &&
  typeof s.color === "string" && s.color.length <= 16 &&
  typeof s.size === "number" && s.size >= 0 && s.size <= 64;

const TURN_MS = 75_000;
const CHOOSE_MS = 15_000;
const REVEAL_MS = 5_000;

const games = new Map();

function newGame(hostId) {
  return {
    status: "lobby",
    hostId,
    lobby: new Map(), // userId -> { id, name, ready }
    players: new Map(), // userId -> { id, name, avatarUrl, score } (set at start)
    order: [],
    drawnThisRound: new Set(),
    round: 1,
    maxRounds: 3,
    drawerId: null,
    word: null,
    wordChoices: [],
    revealedIdx: new Set(),
    guessed: new Set(),
    turnEndsAt: null,
    timers: { choose: null, turn: null, reveal: null, hints: [] },
  };
}

function clearTimers(g) {
  clearTimeout(g.timers.choose);
  clearTimeout(g.timers.turn);
  clearTimeout(g.timers.reveal);
  (g.timers.hints || []).forEach(clearTimeout);
  g.timers.hints = [];
}

async function presentIds(io, roomId) {
  const sockets = await io.in(roomKey(roomId)).fetchSockets();
  return new Set(sockets.map((s) => s.user.id));
}

function publicState(g) {
  return {
    status: g.status,
    hostId: g.hostId,
    lobby: [...g.lobby.values()],
    round: g.round,
    maxRounds: g.maxRounds,
    drawerId: g.drawerId,
    drawerName: g.players.get(g.drawerId)?.name || null,
    players: [...g.players.values()]
      .map((p) => ({ id: p.id, name: p.name, avatarUrl: p.avatarUrl, score: p.score }))
      .sort((a, b) => b.score - a.score),
    masked: g.word ? maskWord(g.word, g.revealedIdx) : null,
    turnEndsAt: g.status === "drawing" ? g.turnEndsAt : null,
    guessed: [...g.guessed],
    word: g.status === "reveal" || g.status === "ended" ? g.word : null,
  };
}

function broadcast(io, roomId) {
  const g = games.get(roomId);
  if (g) io.to(roomKey(roomId)).emit("game:state", publicState(g));
}

function startChoosing(io, roomId, drawerId) {
  const g = games.get(roomId);
  g.status = "choosing";
  g.drawerId = drawerId;
  g.word = null;
  g.wordChoices = pickWords(3);
  g.revealedIdx = new Set();
  g.guessed = new Set();
  clearTimers(g);
  broadcast(io, roomId);
  io.to(`user:${drawerId}`).emit("game:choices", { choices: g.wordChoices });
  g.timers.choose = setTimeout(() => beginDrawing(io, roomId, g.wordChoices[0]), CHOOSE_MS);
}

function revealHint(io, roomId, idxs) {
  const g = games.get(roomId);
  if (!g || g.status !== "drawing") return;
  const hidden = idxs.filter((i) => !g.revealedIdx.has(i));
  if (hidden.length <= 1) return;
  g.revealedIdx.add(hidden[Math.floor(Math.random() * hidden.length)]);
  broadcast(io, roomId);
}

function beginDrawing(io, roomId, word) {
  const g = games.get(roomId);
  if (!g || g.status !== "choosing") return;
  clearTimers(g);
  g.word = word;
  g.status = "drawing";
  g.turnEndsAt = Date.now() + TURN_MS;
  io.to(roomKey(roomId)).emit("game:clear");
  broadcast(io, roomId);
  io.to(`user:${g.drawerId}`).emit("game:drawerWord", { word });
  const idxs = letterIndices(word);
  g.timers.turn = setTimeout(() => endTurn(io, roomId), TURN_MS);
  g.timers.hints = [
    setTimeout(() => revealHint(io, roomId, idxs), TURN_MS * 0.5),
    setTimeout(() => revealHint(io, roomId, idxs), TURN_MS * 0.75),
  ];
}

function endTurn(io, roomId) {
  const g = games.get(roomId);
  if (!g || g.status === "reveal") return;
  clearTimers(g);
  g.status = "reveal";
  broadcast(io, roomId);
  io.to(roomKey(roomId)).emit("game:turnEnd", { word: g.word });
  g.timers.reveal = setTimeout(() => advance(io, roomId), REVEAL_MS);
}

function endGame(io, roomId) {
  const g = games.get(roomId);
  if (!g) return;
  clearTimers(g);
  g.status = "ended";
  g.drawerId = null;
  // reset ready flags so the group can ready-up for another round
  for (const p of g.lobby.values()) p.ready = false;
  broadcast(io, roomId);
  io.to(roomKey(roomId)).emit("game:ended", { players: publicState(g).players });
}

async function advance(io, roomId) {
  const g = games.get(roomId);
  if (!g) return;
  const present = await presentIds(io, roomId);
  const candidates = g.order.filter((id) => !g.drawnThisRound.has(id) && present.has(id));
  if (candidates.length === 0) {
    // did anyone present remain to play at all?
    const anyPresent = g.order.some((id) => present.has(id));
    if (!anyPresent) return endGame(io, roomId);
    g.round += 1;
    g.drawnThisRound.clear();
    if (g.round > g.maxRounds) return endGame(io, roomId);
    return advance(io, roomId);
  }
  const drawerId = candidates[0];
  g.drawnThisRound.add(drawerId);
  startChoosing(io, roomId, drawerId);
}

async function checkAllGuessed(io, roomId) {
  const g = games.get(roomId);
  if (!g || g.status !== "drawing") return;
  const present = await presentIds(io, roomId);
  const guessers = g.order.filter((id) => id !== g.drawerId && present.has(id));
  if (guessers.length > 0 && guessers.every((id) => g.guessed.has(id))) endTurn(io, roomId);
}

export function registerGameHandlers(io, socket) {
  const uid = socket.user.id;

  socket.on("game:sync", ({ roomId } = {}, cb) => {
    const g = games.get(roomId);
    cb?.(g ? publicState(g) : { status: "lobby", lobby: [], players: [], hostId: null });
  });

  socket.on("game:join", async ({ roomId } = {}, cb) => {
    if (!(await canAccessRoom(socket.user, roomId)) || !socket.rooms.has(roomKey(roomId))) return cb?.({ error: "Not allowed" });
    let g = games.get(roomId);
    if (!g) { g = newGame(uid); games.set(roomId, g); }
    // A round in progress is closed to newcomers — they spectate (they still
    // receive state broadcasts and see the canvas; they just aren't scored or
    // allowed to guess) and take a seat when the game returns to the lobby.
    if (!g.lobby.has(uid) && g.status !== "lobby" && g.status !== "ended") {
      return cb?.({ ok: true, spectate: true });
    }
    if (!g.lobby.has(uid)) g.lobby.set(uid, { id: uid, name: socket.user.name, ready: false });
    if (!g.hostId || ![...g.lobby.keys()].includes(g.hostId)) g.hostId = [...g.lobby.keys()][0];
    broadcast(io, roomId);
    cb?.({ ok: true });
  });

  socket.on("game:leave", ({ roomId } = {}) => {
    const g = games.get(roomId);
    if (!g) return;
    g.lobby.delete(uid);
    if (g.hostId === uid) g.hostId = [...g.lobby.keys()][0] || null;
    if (g.lobby.size === 0 && (g.status === "lobby" || g.status === "ended")) {
      clearTimers(g);
      games.delete(roomId);
      return;
    }
    broadcast(io, roomId);
  });

  socket.on("game:ready", ({ roomId, ready } = {}) => {
    const g = games.get(roomId);
    const p = g?.lobby.get(uid);
    if (!p) return;
    p.ready = Boolean(ready);
    broadcast(io, roomId);
  });

  socket.on("game:start", async ({ roomId, rounds } = {}, cb) => {
    const g = games.get(roomId);
    if (!g) return cb?.({ error: "No game" });
    if (g.hostId !== uid) return cb?.({ error: "Only the host can start" });
    if (g.status !== "lobby" && g.status !== "ended") return cb?.({ error: "Game already running" });
    const members = [...g.lobby.values()];
    if (members.length < 2) return cb?.({ error: "Need at least 2 players" });
    if (!members.every((p) => p.ready)) return cb?.({ error: "Everyone must be ready" });

    g.maxRounds = Math.min(Math.max(Number(rounds) || 3, 1), 10);
    g.players = new Map(members.map((p) => [p.id, { id: p.id, name: p.name, avatarUrl: null, score: 0 }]));
    g.order = [...g.players.keys()];
    g.drawnThisRound = new Set();
    g.round = 1;
    g.guessed = new Set();
    advance(io, roomId);
    cb?.({ ok: true });
  });

  socket.on("game:chooseWord", ({ roomId, word } = {}) => {
    const g = games.get(roomId);
    if (!g || g.status !== "choosing" || uid !== g.drawerId) return;
    if (!g.wordChoices.includes(word)) return;
    beginDrawing(io, roomId, word);
  });

  socket.on("game:draw", ({ roomId, stroke } = {}) => {
    const g = games.get(roomId);
    if (!g || g.status !== "drawing" || uid !== g.drawerId) return;
    if (!allow(socket, "draw", 80, 1000) || !validStroke(stroke)) return;
    socket.to(roomKey(roomId)).emit("game:draw", { stroke });
  });

  socket.on("game:clear", ({ roomId } = {}) => {
    const g = games.get(roomId);
    if (!g || uid !== g.drawerId) return;
    io.to(roomKey(roomId)).emit("game:clear");
  });

  socket.on("game:guess", ({ roomId, text } = {}) => {
    const g = games.get(roomId);
    if (!g || g.status !== "drawing" || !g.players.has(uid)) return;
    if (uid === g.drawerId || g.guessed.has(uid)) return;
    if (!allow(socket, "guess", 12, 5000)) return;
    const guess = (text || "").trim().toLowerCase();
    if (!guess || guess.length > 100) return;

    if (guess === g.word.toLowerCase()) {
      g.guessed.add(uid);
      const timeLeft = Math.max(0, g.turnEndsAt - Date.now());
      const pts = Math.round(50 + 300 * (timeLeft / TURN_MS));
      const player = g.players.get(uid);
      if (player) player.score += pts;
      const drawer = g.players.get(g.drawerId);
      if (drawer) drawer.score += 40;
      io.to(roomKey(roomId)).emit("game:correct", { name: socket.user.name, userId: uid });
      broadcast(io, roomId);
      checkAllGuessed(io, roomId);
    } else {
      io.to(roomKey(roomId)).emit("game:guessMessage", { name: socket.user.name, text });
    }
  });

  socket.on("disconnecting", () => {
    const rooms = [...socket.rooms].filter((k) => k.startsWith("room:")).map((k) => k.slice(5));
    setImmediate(async () => {
      for (const roomId of rooms) {
        const g = games.get(roomId);
        if (!g) continue;
        g.lobby.delete(uid);
        if (g.hostId === uid) g.hostId = [...g.lobby.keys()][0] || null;

        // Free the game entirely once nobody's left (no lobby, no present players).
        const present = await presentIds(io, roomId);
        if (g.lobby.size === 0 && !g.order.some((id) => present.has(id))) {
          clearTimers(g);
          games.delete(roomId);
          continue;
        }
        if ((g.status === "choosing" || g.status === "drawing") && g.drawerId === uid) {
          endTurn(io, roomId);
        } else {
          broadcast(io, roomId);
        }
      }
    });
  });
}
