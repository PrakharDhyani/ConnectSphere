/**
 * Skribbl-style draw-and-guess game, one per room.
 *
 * Flow: start → each present player takes a turn as the DRAWER: they pick 1 of
 * 3 words, then draw it while everyone else guesses in a race. Correct guessers
 * score by speed; the drawer scores per correct guesser. After everyone has
 * drawn `maxRounds` times, the final scoreboard shows.
 *
 * The server is authoritative: it owns the timers, the word, the scoring, and
 * only tells guessers a MASKED word (letters revealed as hints over time). The
 * drawer receives the real word privately (via their per-user room).
 *
 * Client → server: game:start, game:chooseWord, game:draw, game:clear,
 *   game:guess, game:sync
 * Server → client: game:state (public snapshot), game:choices (drawer only),
 *   game:drawerWord (drawer only), game:clear, game:draw, game:correct,
 *   game:guessMessage, game:turnEnd, game:ended
 */
import { pickWords, maskWord, letterIndices } from "../games/words.js";
import { canAccessRoom } from "../utils/roomAccess.js";
import { roomKey } from "./chat.handlers.js";

const TURN_MS = 75_000;
const CHOOSE_MS = 15_000;
const REVEAL_MS = 5_000;

const games = new Map(); // roomId -> game

function clearTimers(g) {
  clearTimeout(g.timers.choose);
  clearTimeout(g.timers.turn);
  clearTimeout(g.timers.reveal);
  (g.timers.hints || []).forEach(clearTimeout);
  g.timers.hints = [];
}

async function presentPlayers(io, roomId) {
  const sockets = await io.in(roomKey(roomId)).fetchSockets();
  const map = new Map();
  for (const s of sockets) {
    if (!map.has(s.user.id)) map.set(s.user.id, { id: s.user.id, name: s.user.name, avatarUrl: s.user.avatarUrl });
  }
  return map;
}

function publicState(g) {
  return {
    status: g.status,
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
    // The real word is public only once the turn is over.
    word: g.status === "reveal" || g.status === "ended" ? g.word : null,
  };
}

function broadcastState(io, roomId) {
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
  g.correctCount = 0;
  clearTimers(g);
  broadcastState(io, roomId);
  io.to(`user:${drawerId}`).emit("game:choices", { choices: g.wordChoices });
  g.timers.choose = setTimeout(() => beginDrawing(io, roomId, g.wordChoices[0]), CHOOSE_MS);
}

function revealHint(io, roomId, idxs) {
  const g = games.get(roomId);
  if (!g || g.status !== "drawing") return;
  const hidden = idxs.filter((i) => !g.revealedIdx.has(i));
  if (hidden.length <= 1) return; // never reveal the last letter
  g.revealedIdx.add(hidden[Math.floor(Math.random() * hidden.length)]);
  broadcastState(io, roomId);
}

function beginDrawing(io, roomId, word) {
  const g = games.get(roomId);
  if (!g || g.status !== "choosing") return;
  clearTimers(g);
  g.word = word;
  g.status = "drawing";
  g.turnEndsAt = Date.now() + TURN_MS;
  io.to(roomKey(roomId)).emit("game:clear");
  broadcastState(io, roomId);
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
  broadcastState(io, roomId);
  io.to(roomKey(roomId)).emit("game:turnEnd", { word: g.word });
  g.timers.reveal = setTimeout(() => advance(io, roomId), REVEAL_MS);
}

function endGame(io, roomId) {
  const g = games.get(roomId);
  if (!g) return;
  clearTimers(g);
  g.status = "ended";
  broadcastState(io, roomId);
  io.to(roomKey(roomId)).emit("game:ended", { players: publicState(g).players });
}

async function advance(io, roomId) {
  const g = games.get(roomId);
  if (!g) return;
  const present = await presentPlayers(io, roomId);
  for (const [id, p] of present) if (!g.players.has(id)) g.players.set(id, { ...p, score: 0 });

  const candidates = [...present.keys()].filter((id) => !g.drawnThisRound.has(id));
  if (candidates.length === 0) {
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
  const present = await presentPlayers(io, roomId);
  const guessers = [...present.keys()].filter((id) => id !== g.drawerId);
  if (guessers.length > 0 && guessers.every((id) => g.guessed.has(id))) endTurn(io, roomId);
}

export function registerGameHandlers(io, socket) {
  socket.on("game:sync", ({ roomId } = {}, cb) => {
    const g = games.get(roomId);
    cb?.(g ? publicState(g) : { status: "idle", players: [] });
  });

  socket.on("game:start", async ({ roomId, rounds } = {}, cb) => {
    try {
      if (!(await canAccessRoom(socket.user, roomId))) return cb?.({ error: "Not allowed" });
      if (!socket.rooms.has(roomKey(roomId))) return cb?.({ error: "Join the room first" });
      const present = await presentPlayers(io, roomId);
      if (present.size < 2) return cb?.({ error: "Need at least 2 players in the room" });

      const existing = games.get(roomId);
      if (existing) clearTimers(existing);

      const g = {
        status: "idle",
        players: new Map(),
        drawnThisRound: new Set(),
        round: 1,
        maxRounds: Math.min(Math.max(Number(rounds) || 3, 1), 10),
        drawerId: null,
        word: null,
        wordChoices: [],
        revealedIdx: new Set(),
        guessed: new Set(),
        correctCount: 0,
        turnEndsAt: null,
        timers: { choose: null, turn: null, reveal: null, hints: [] },
      };
      for (const [id, p] of present) g.players.set(id, { ...p, score: 0 });
      games.set(roomId, g);
      advance(io, roomId);
      cb?.({ ok: true });
    } catch {
      cb?.({ error: "Could not start game" });
    }
  });

  socket.on("game:chooseWord", ({ roomId, word } = {}) => {
    const g = games.get(roomId);
    if (!g || g.status !== "choosing" || socket.user.id !== g.drawerId) return;
    if (!g.wordChoices.includes(word)) return;
    beginDrawing(io, roomId, word);
  });

  socket.on("game:draw", ({ roomId, stroke } = {}) => {
    const g = games.get(roomId);
    if (!g || g.status !== "drawing" || socket.user.id !== g.drawerId) return;
    socket.to(roomKey(roomId)).emit("game:draw", { stroke });
  });

  socket.on("game:clear", ({ roomId } = {}) => {
    const g = games.get(roomId);
    if (!g || socket.user.id !== g.drawerId) return;
    io.to(roomKey(roomId)).emit("game:clear");
  });

  socket.on("game:guess", ({ roomId, text } = {}) => {
    const g = games.get(roomId);
    if (!g || g.status !== "drawing") return;
    if (socket.user.id === g.drawerId || g.guessed.has(socket.user.id)) return;
    const guess = (text || "").trim().toLowerCase();
    if (!guess) return;

    if (guess === g.word.toLowerCase()) {
      g.guessed.add(socket.user.id);
      const timeLeft = Math.max(0, g.turnEndsAt - Date.now());
      const pts = Math.round(50 + 300 * (timeLeft / TURN_MS));
      const player = g.players.get(socket.user.id);
      if (player) player.score += pts;
      const drawer = g.players.get(g.drawerId);
      if (drawer) drawer.score += 40;
      io.to(roomKey(roomId)).emit("game:correct", { name: socket.user.name, userId: socket.user.id });
      broadcastState(io, roomId);
      checkAllGuessed(io, roomId);
    } else {
      // Wrong guesses show to the room like chat (part of the fun).
      io.to(roomKey(roomId)).emit("game:guessMessage", { name: socket.user.name, text });
    }
  });

  // If the current drawer drops, skip their turn.
  socket.on("disconnecting", () => {
    const rooms = [...socket.rooms].filter((k) => k.startsWith("room:")).map((k) => k.slice(5));
    setImmediate(async () => {
      for (const roomId of rooms) {
        const g = games.get(roomId);
        if (!g) continue;
        const present = await presentPlayers(io, roomId);
        if ((g.status === "choosing" || g.status === "drawing") && !present.has(g.drawerId)) {
          endTurn(io, roomId);
        } else {
          broadcastState(io, roomId);
        }
      }
    });
  });
}
