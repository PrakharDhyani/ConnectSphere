/**
 * Draw & Guess — server module.
 *
 * The first BESPOKE plugin to migrate. The four framework games cost one line
 * each because `lobbyGame.js` already was an SDK; this one predates it entirely
 * and owns its own lobby, timers, scoring and word masking — 311 lines with no
 * framework underneath. So there is no adapter to lean on: the game logic moves
 * across as-is and only its *transport* changes.
 *
 * WHAT CHANGED, AND WHAT DELIBERATELY DID NOT
 * The rules are untouched — same scoring curve, same hint schedule, same
 * spectator policy, same host-election-on-leave. Copying the logic verbatim is
 * the point: a behaviour-preserving migration is reviewable by diffing against
 * game.handlers.js, whereas a rewrite hides regressions inside "improvements".
 *
 * What changed is every line that named the transport:
 *   io.to(roomKey(roomId)).emit("game:x")  →  bus.broadcast("x")
 *   io.to(`user:${id}`).emit("game:x")     →  bus.toUser(id, "x")
 *   canAccessRoom / socket.rooms / allow() →  deleted; the host does all three
 *
 * WHY `detached()` IS THE WHOLE STORY HERE
 * Every state transition in this game fires from a TIMER, not from a request:
 * the choose clock, the turn clock, two hint reveals, the reveal→advance gap.
 * Request-scoped `sdk.socket` is dead the moment its event returns, so a timer
 * holding one would either emit into the void or pin the socket for 75 seconds.
 * `sdk.socket.detached()` — built for poll's auto-close in §49 — is exactly the
 * broadcaster a turn clock needs, and this plugin is its heaviest user: the
 * whole game is a chain of timers. It is stored per-room at start, not captured
 * per-event, so the chain survives the drawer disconnecting mid-turn.
 *
 * PRIVATE-CHANNEL NOTE (why this plugin migrated after the framework games)
 * The drawer must learn the real word while guessers see only a mask. That is
 * `sdk.socket.toUser(drawerId, …)` — the per-user room the SDK exposes without
 * handing the plugin `io`. The migration plan scheduled draw-guess after the
 * framework games precisely so this capability existed first.
 *
 * STATE IS AN IN-PROCESS Map, NOT sdk.storage — ON PURPOSE
 * Sticky Notes routes through `sdk.storage` because a board should outlive a
 * restart. A draw-guess round should NOT: it is 75-second turns with live
 * timers, and a half-finished turn restored after a crash would resume with a
 * word nobody is drawing and a clock that already expired. Games are ephemeral
 * by nature, which is the same reason the framework games keep their tables in
 * memory. `destroy()` is therefore the only cleanup that matters, and the host
 * calls it when the last participant leaves.
 */
import { pickWords, maskWord, letterIndices } from "../../games/words.js";

// A drawing segment is normalized 0..1 coords + small style — reject anything
// else. Kept identical to game.handlers.js: the client sends fractions so a
// phone and a 4K monitor draw the same picture.
const num01 = (n) => typeof n === "number" && n >= -0.1 && n <= 1.1;
const validStroke = (s) =>
  s && num01(s.x0) && num01(s.y0) && num01(s.x1) && num01(s.y1) &&
  typeof s.color === "string" && s.color.length <= 16 &&
  typeof s.size === "number" && s.size >= 0 && s.size <= 64;

const DEFAULT_TURN_MS = 75_000;
const CHOOSE_MS = 15_000;
const REVEAL_MS = 5_000;

/** roomId -> game. Ephemeral by design (see header). */
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
    turnMs: DEFAULT_TURN_MS,
    hintsEnabled: true,
    drawerId: null,
    word: null,
    wordChoices: [],
    revealedIdx: new Set(),
    guessed: new Set(),
    turnEndsAt: null,
    timers: { choose: null, turn: null, reveal: null, hints: [] },
    /**
     * The detached broadcaster, captured once per room.
     *
     * Refreshed on every join so a game whose original starter left still has a
     * live channel: the object only closes over the activity key, so any
     * member's is equivalent — but one built from a socket that has since
     * disconnected is not guaranteed to outlive it.
     */
    bus: null,
  };
}

function clearTimers(g) {
  clearTimeout(g.timers.choose);
  clearTimeout(g.timers.turn);
  clearTimeout(g.timers.reveal);
  (g.timers.hints || []).forEach(clearTimeout);
  g.timers.hints = [];
}

/**
 * Who is actually here, as user ids.
 *
 * The activity channel, not the room channel — the same correction §49 made for
 * UNO's private hands. A player who opened the game is in `act:skribbl:<room>`;
 * someone sitting in chat is not, and must not keep a finished game alive or
 * count as a guesser who has yet to guess.
 */
async function presentIds(g) {
  if (!g.bus) return new Set();
  const members = await g.bus.members();
  return new Set(members.map((m) => m.userId));
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
    // The word is only public once it can no longer be guessed for points.
    word: g.status === "reveal" || g.status === "ended" ? g.word : null,
  };
}

function broadcast(roomId) {
  const g = games.get(roomId);
  if (g?.bus) g.bus.broadcast("state", publicState(g));
}

function startChoosing(roomId, drawerId) {
  const g = games.get(roomId);
  if (!g) return;
  g.status = "choosing";
  g.drawerId = drawerId;
  g.word = null;
  g.wordChoices = pickWords(3);
  g.revealedIdx = new Set();
  g.guessed = new Set();
  clearTimers(g);
  broadcast(roomId);
  // Only the drawer sees the candidate words.
  g.bus?.toUser(drawerId, "choices", { choices: g.wordChoices });
  // Dawdling picks for you, so one idle drawer cannot stall the table.
  g.timers.choose = setTimeout(() => beginDrawing(roomId, g.wordChoices[0]), CHOOSE_MS);
}

function revealHint(roomId, idxs) {
  const g = games.get(roomId);
  if (!g || g.status !== "drawing") return;
  const hidden = idxs.filter((i) => !g.revealedIdx.has(i));
  // Never reveal the last hidden letter — that would hand over the answer.
  if (hidden.length <= 1) return;
  g.revealedIdx.add(hidden[Math.floor(Math.random() * hidden.length)]);
  broadcast(roomId);
}

function beginDrawing(roomId, word) {
  const g = games.get(roomId);
  if (!g || g.status !== "choosing") return;
  clearTimers(g);
  g.word = word;
  g.status = "drawing";
  g.turnEndsAt = Date.now() + g.turnMs;
  g.bus?.broadcast("clear");
  broadcast(roomId);
  // The real word goes to the drawer alone; everyone else has `masked`.
  g.bus?.toUser(g.drawerId, "drawerWord", { word });
  const idxs = letterIndices(word);
  g.timers.turn = setTimeout(() => endTurn(roomId), g.turnMs);
  if (g.hintsEnabled) {
    g.timers.hints = [
      setTimeout(() => revealHint(roomId, idxs), g.turnMs * 0.5),
      setTimeout(() => revealHint(roomId, idxs), g.turnMs * 0.75),
    ];
  }
}

function endTurn(roomId) {
  const g = games.get(roomId);
  if (!g || g.status === "reveal") return;
  clearTimers(g);
  g.status = "reveal";
  broadcast(roomId);
  g.bus?.broadcast("turnEnd", { word: g.word });
  g.timers.reveal = setTimeout(() => advance(roomId), REVEAL_MS);
}

function endGame(roomId) {
  const g = games.get(roomId);
  if (!g) return;
  clearTimers(g);
  g.status = "ended";
  g.drawerId = null;
  // Reset ready flags so the group can ready-up for another game.
  for (const p of g.lobby.values()) p.ready = false;
  broadcast(roomId);
  g.bus?.broadcast("ended", { players: publicState(g).players });
}

async function advance(roomId) {
  const g = games.get(roomId);
  if (!g) return;
  const present = await presentIds(g);
  const candidates = g.order.filter((id) => !g.drawnThisRound.has(id) && present.has(id));
  if (candidates.length === 0) {
    // Everyone who could still draw this round has drawn — or left.
    const anyPresent = g.order.some((id) => present.has(id));
    if (!anyPresent) return endGame(roomId);
    g.round += 1;
    g.drawnThisRound.clear();
    if (g.round > g.maxRounds) return endGame(roomId);
    return advance(roomId);
  }
  const drawerId = candidates[0];
  g.drawnThisRound.add(drawerId);
  startChoosing(roomId, drawerId);
}

async function checkAllGuessed(roomId) {
  const g = games.get(roomId);
  if (!g || g.status !== "drawing") return;
  const present = await presentIds(g);
  const guessers = g.order.filter((id) => id !== g.drawerId && present.has(id));
  // End early once nobody is left to guess — waiting out the clock is dead air.
  if (guessers.length > 0 && guessers.every((id) => g.guessed.has(id))) endTurn(roomId);
}

/** The lobby seat + host election shared by leave and disconnect. */
function releaseSeat(g, uid) {
  g.lobby.delete(uid);
  if (g.hostId === uid) g.hostId = [...g.lobby.keys()][0] || null;
}

export default {
  /**
   * Opening the game means taking a lobby seat — or spectating a live round.
   *
   * Returns the state directly, so a late joiner is caught up by the join ack
   * and needs no separate sync round-trip (`game:sync` in the legacy handler).
   */
  async onJoin(sdk) {
    const roomId = sdk.room.id;
    const uid = sdk.user.id;
    let g = games.get(roomId);
    if (!g) {
      g = newGame(uid);
      games.set(roomId, g);
    }
    // Refresh the detached bus on every join (see the `bus` field note).
    g.bus = sdk.socket.detached();

    // Config is per-room and read at join, so a room configured for 5 rounds
    // shows that in its lobby before anyone presses start.
    g.maxRounds = Math.min(Math.max(Number(sdk.meta.config.maxRounds) || 3, 1), 10);
    g.turnMs = (Number(sdk.meta.config.turnSeconds) || 75) * 1000;
    g.hintsEnabled = sdk.meta.config.hints !== false;

    // A round in progress is closed to newcomers — they spectate (they still
    // see state and the canvas; they are not scored and may not guess) and take
    // a seat when the game returns to the lobby.
    const midRound = g.status !== "lobby" && g.status !== "ended";
    if (!g.lobby.has(uid) && midRound) {
      return { ...publicState(g), spectate: true };
    }
    if (!g.lobby.has(uid)) g.lobby.set(uid, { id: uid, name: sdk.user.name, ready: false });
    if (!g.hostId || !g.lobby.has(g.hostId)) g.hostId = [...g.lobby.keys()][0];
    broadcast(roomId);
    return publicState(g);
  },

  /** Closing the tab and pressing leave must free the same seat. */
  async onLeave(sdk) {
    const g = games.get(sdk.room.id);
    if (!g) return;
    releaseSeat(g, sdk.user.id);
    // A drawer who leaves mid-turn ends the turn rather than freezing the game
    // on a canvas nobody can draw on.
    if ((g.status === "choosing" || g.status === "drawing") && g.drawerId === sdk.user.id) {
      endTurn(sdk.room.id);
    } else {
      broadcast(sdk.room.id);
    }
  },

  rates: {
    // Matches the legacy limits exactly: drawing is a stream, guessing is not.
    draw: { max: 80, windowMs: 1000 },
    guess: { max: 12, windowMs: 5000 },
  },

  events: {
    ready(sdk, { ready } = {}) {
      const g = games.get(sdk.room.id);
      const p = g?.lobby.get(sdk.user.id);
      if (!p) return;
      p.ready = Boolean(ready);
      broadcast(sdk.room.id);
    },

    async start(sdk, { rounds } = {}, ack) {
      const roomId = sdk.room.id;
      const g = games.get(roomId);
      if (!g) return ack({ error: "No game" });
      if (g.hostId !== sdk.user.id) return ack({ error: "Only the host can start" });
      if (g.status !== "lobby" && g.status !== "ended") return ack({ error: "Game already running" });
      const members = [...g.lobby.values()];
      if (members.length < 2) return ack({ error: "Need at least 2 players" });
      if (!members.every((p) => p.ready)) return ack({ error: "Everyone must be ready" });

      // An explicit round count from the host overrides the room default.
      if (rounds !== undefined) g.maxRounds = Math.min(Math.max(Number(rounds) || 3, 1), 10);
      g.players = new Map(members.map((p) => [p.id, { id: p.id, name: p.name, avatarUrl: null, score: 0 }]));
      g.order = [...g.players.keys()];
      g.drawnThisRound = new Set();
      g.round = 1;
      g.guessed = new Set();
      ack({ ok: true });
      await advance(roomId);
    },

    chooseWord(sdk, { word } = {}) {
      const g = games.get(sdk.room.id);
      if (!g || g.status !== "choosing" || sdk.user.id !== g.drawerId) return;
      // Only one of the three offered words — not any word the client invents.
      if (!g.wordChoices.includes(word)) return;
      beginDrawing(sdk.room.id, word);
    },

    draw(sdk, { stroke } = {}) {
      const g = games.get(sdk.room.id);
      if (!g || g.status !== "drawing" || sdk.user.id !== g.drawerId) return;
      if (!validStroke(stroke)) return;
      // toOthers: the drawer already painted this stroke locally.
      sdk.socket.toOthers("draw", { stroke });
    },

    clear(sdk) {
      const g = games.get(sdk.room.id);
      if (!g || sdk.user.id !== g.drawerId) return;
      sdk.socket.broadcast("clear");
    },

    async guess(sdk, { text } = {}) {
      const roomId = sdk.room.id;
      const uid = sdk.user.id;
      const g = games.get(roomId);
      if (!g || g.status !== "drawing" || !g.players.has(uid)) return;
      // The drawer knows the word, and a correct guess is scored once.
      if (uid === g.drawerId || g.guessed.has(uid)) return;
      const guess = (text || "").trim().toLowerCase();
      if (!guess || guess.length > 100) return;

      if (guess === g.word.toLowerCase()) {
        g.guessed.add(uid);
        // Faster guess, more points — 350 down to 50 across the turn.
        const timeLeft = Math.max(0, g.turnEndsAt - Date.now());
        const pts = Math.round(50 + 300 * (timeLeft / g.turnMs));
        const player = g.players.get(uid);
        if (player) player.score += pts;
        // The drawer is paid per correct guesser, so drawing well is rewarded.
        const drawer = g.players.get(g.drawerId);
        if (drawer) drawer.score += 40;
        sdk.socket.broadcast("correct", { name: sdk.user.name, userId: uid });
        broadcast(roomId);
        await checkAllGuessed(roomId);
      } else {
        // A wrong guess is just chat — and must never echo the real word.
        sdk.socket.broadcast("guessMessage", { name: sdk.user.name, text });
      }
    },
  },

  /**
   * Called by the host when the last participant leaves.
   *
   * Clearing the timers is the part that matters: a turn clock left running
   * would fire into a room with nobody in it and resurrect a finished game.
   */
  destroy(roomId) {
    const g = games.get(roomId);
    if (!g) return;
    clearTimers(g);
    games.delete(roomId);
  },
};

/** Test seam — lets a suite assert that destroy() actually freed the room. */
export const __games = games;
