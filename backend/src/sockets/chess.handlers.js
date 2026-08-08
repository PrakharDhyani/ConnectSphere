/**
 * Chess — socket wiring on the shared lobby framework.
 *
 * Seats: exactly 2 (players[0] = white after start's coin flip). One bot max
 * in practice (the host adds it). The live Chess instance rides on the game
 * object (never serialized — publicState ships the FEN).
 */
import { Chess } from "chess.js";
import { createLobbyGame } from "./lobbyGame.js";
import { chooseBotMove, gameResult } from "../games/chessGame.js";

const MOVE_MS = 75_000; // per-move fallback when playing WITHOUT a clock
// Host-selectable time controls (minutes per player for the whole game; 0 = no clock).
const TIME_CONTROLS = [0, 1, 3, 5, 10, 15, 30];

const clockKey = (color) => (color === "w" ? "whiteMs" : "blackMs");

// Deduct the elapsed thinking time from the side to move. Returns true if
// their flag fell (caller must end the game).
function settleClock(g) {
  if (g.whiteMs == null) return false;
  const mover = g._chess.turn();
  const key = clockKey(mover);
  g[key] = Math.max(0, g[key] - (Date.now() - g.turnStartedAt));
  return g[key] <= 0;
}

function applyResult(g, result) {
  g.result = result.type;
  g.winnerColor = result.winner; // "w" | "b" | null
  g.winnerId = result.winner ? (result.winner === "w" ? g.whiteId : g.blackId) : null;
}

function timeoutLoss(ctx) {
  const { g } = ctx;
  const loser = g._chess.turn();
  applyResult(g, { type: "timeout", winner: loser === "w" ? "b" : "w" });
  const name = g.players.find((p) => p.id === (loser === "w" ? g.whiteId : g.blackId))?.name;
  ctx.notice(`⏰ ${name}'s flag fell — out of time!`);
  ctx.endGame();
}

function doMove(ctx, san) {
  const { g } = ctx;
  // Clock first: if this player's time ran out before the move landed, the
  // move doesn't count — their flag fell.
  if (settleClock(g)) {
    timeoutLoss(ctx);
    return null;
  }
  const move = g._chess.move(san);
  if (!move) return null;
  g.turnStartedAt = Date.now(); // opponent's clock starts now
  g.lastMove = { from: move.from, to: move.to, san: move.san, color: move.color };
  if (move.captured) {
    g.captured[move.color === "w" ? "w" : "b"].push(move.captured);
  }
  const result = gameResult(g._chess);
  if (result) {
    applyResult(g, result);
    ctx.endGame();
  } else {
    ctx.broadcast();
  }
  return move;
}

const chess = createLobbyGame({
  prefix: "chess",
  minPlayers: 2,
  maxPlayers: 2,
  allowBots: true,

  init: () => ({
    _chess: null,
    whiteId: null,
    blackId: null,
    lastMove: null,
    captured: { w: [], b: [] },
    result: null,
    winnerColor: null,
    winnerId: null,
    timeCtrlMin: 10, // host-selectable; 0 = play without a clock
    whiteMs: null,
    blackMs: null,
    turnStartedAt: null,
  }),

  // "Play again" keeps the table's chosen time control.
  onReset(old, fresh) {
    fresh.timeCtrlMin = old.timeCtrlMin;
  },

  lobbyEvents: {
    setTime(ctx, { minutes }, cb) {
      const m = Number(minutes);
      if (!TIME_CONTROLS.includes(m)) return cb?.({ error: "Pick a listed time control" });
      ctx.g.timeCtrlMin = m;
      ctx.broadcast();
      cb?.({ ok: true });
    },
  },

  start(g) {
    // Coin flip for white — fair rematches instead of host always white.
    if (Math.random() < 0.5) g.players.reverse();
    g.whiteId = g.players[0].id;
    g.blackId = g.players[1].id;
    g._chess = new Chess();
    g.lastMove = null;
    g.captured = { w: [], b: [] };
    g.result = null;
    g.winnerColor = null;
    g.winnerId = null;
    // Same budget for both players; whoever's clock hits zero first loses.
    g.whiteMs = g.timeCtrlMin > 0 ? g.timeCtrlMin * 60_000 : null;
    g.blackMs = g.timeCtrlMin > 0 ? g.timeCtrlMin * 60_000 : null;
    g.turnStartedAt = Date.now();
  },

  publicState(g) {
    return {
      fen: g._chess ? g._chess.fen() : null,
      turn: g._chess ? g._chess.turn() : "w",
      check: g._chess ? g._chess.inCheck() : false,
      lastMove: g.lastMove,
      captured: g.captured,
      result: g.result,
      winnerColor: g.winnerColor,
      winnerId: g.winnerId,
      whiteId: g.whiteId,
      blackId: g.blackId,
      timeCtrlMin: g.timeCtrlMin,
      // Clock snapshot: values are exact as of turnStartedAt; the client
      // subtracts (now - turnStartedAt) from the side to move for display.
      whiteMs: g.whiteMs,
      blackMs: g.blackMs,
      turnStartedAt: g.turnStartedAt,
    };
  },

  events: {
    move(ctx, { playerId, from, to, promotion }, cb) {
      const { g } = ctx;
      const myColor = playerId === g.whiteId ? "w" : playerId === g.blackId ? "b" : null;
      if (!myColor || g._chess.turn() !== myColor) return cb?.({ error: "Not your turn" });
      let move = null;
      try {
        move = g._chess.move({ from, to, promotion: promotion || "q" });
      } catch {
        move = null;
      }
      if (!move) return cb?.({ error: "Illegal move" });
      g._chess.undo(); // doMove replays it so all bookkeeping lives in one place
      doMove(ctx, move.san);
      cb?.({ ok: true });
    },

    resign(ctx, { playerId }, cb) {
      const { g } = ctx;
      const myColor = playerId === g.whiteId ? "w" : playerId === g.blackId ? "b" : null;
      if (!myColor) return cb?.({ error: "Not playing" });
      applyResult(g, { type: "resignation", winner: myColor === "w" ? "b" : "w" });
      ctx.notice(`🏳️ ${g.players.find((p) => p.id === playerId)?.name} resigned`);
      ctx.endGame();
      cb?.({ ok: true });
    },
  },

  afkDeadline(g) {
    // With a real clock: the deadline IS the flag fall of the side to move
    // (applies to bots too — a bot on 0:00 loses like anyone else). Without
    // a clock: 75s-per-move anti-AFK for humans only.
    if (g.whiteMs != null && g._chess) {
      const remaining = g[clockKey(g._chess.turn())];
      return Date.now() + Math.max(50, remaining);
    }
    const turnId = g._chess?.turn() === "w" ? g.whiteId : g.blackId;
    const seat = g.players.find((p) => p.id === turnId);
    if (!seat || seat.isBot) return null;
    return Date.now() + MOVE_MS;
  },

  onAfkTimeout(ctx) {
    const { g } = ctx;
    if (g.whiteMs != null) settleClock(g); // zero out the loser's display
    timeoutLoss(ctx);
  },

  botTurn(g) {
    const turnId = g._chess?.turn() === "w" ? g.whiteId : g.blackId;
    return Boolean(g.players.find((p) => p.id === turnId)?.isBot);
  },
  botDelayMs(g) {
    const turnId = g._chess?.turn() === "w" ? g.whiteId : g.blackId;
    const d = g.players.find((p) => p.id === turnId)?.difficulty;
    return d === "hard" ? 1400 : d === "easy" ? 800 : 1100;
  },
  botAct(ctx) {
    const { g } = ctx;
    const turnId = g._chess.turn() === "w" ? g.whiteId : g.blackId;
    const seat = g.players.find((p) => p.id === turnId);
    const san = chooseBotMove(g._chess, seat?.difficulty);
    if (san) doMove(ctx, san);
  },
});

export function registerChessHandlers(io, socket) {
  chess.register(io, socket);
}

// Exported so the plugin adapter can host this game through the activity
// host (activities/lobbyGameAdapter.js). The legacy registration above stays
// until the flag flips, so both paths serve the same instance and the same
// table — never two copies of the game.
export { chess };
