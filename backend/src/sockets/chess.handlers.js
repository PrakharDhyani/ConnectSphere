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

const MOVE_MS = 75_000; // per-move clock; expiry = resignation

function applyResult(g, result) {
  g.result = result.type;
  g.winnerColor = result.winner; // "w" | "b" | null
  g.winnerId = result.winner ? (result.winner === "w" ? g.whiteId : g.blackId) : null;
}

function doMove(ctx, san) {
  const { g } = ctx;
  const move = g._chess.move(san);
  if (!move) return null;
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
  }),

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
    // Bots move on their own timer; only arm the clock for human turns.
    const turnId = g._chess?.turn() === "w" ? g.whiteId : g.blackId;
    const seat = g.players.find((p) => p.id === turnId);
    if (!seat || seat.isBot) return null;
    return Date.now() + MOVE_MS;
  },

  onAfkTimeout(ctx) {
    const { g } = ctx;
    const loser = g._chess.turn();
    applyResult(g, { type: "timeout", winner: loser === "w" ? "b" : "w" });
    const name = g.players.find((p) => p.id === (loser === "w" ? g.whiteId : g.blackId))?.name;
    ctx.notice(`⏰ ${name} ran out of time`);
    ctx.endGame();
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
