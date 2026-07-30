/**
 * Bingo — socket wiring. The framework ticker is the CALLER: a ball every
 * 3.5s, broadcast as its own event so the client can animate the ball drop.
 * Cards are private-ish (each player only receives their own via the private
 * channel); daubs and BINGO claims are validated server-side.
 */
import { createLobbyGame } from "./lobbyGame.js";
import * as B from "../games/bingoGame.js";

const bingo = createLobbyGame({
  prefix: "bingo",
  minPlayers: 1,
  maxPlayers: 10,
  allowBots: true,

  init: () => ({ bingo: null, winnerId: null, winningLine: null }),

  start(g) {
    g.bingo = B.setup(g.players.map((p) => p.id));
    g.winnerId = null;
    g.winningLine = null;
  },

  publicState(g) {
    if (!g.bingo) return {};
    return {
      drawn: g.bingo.drawn,
      last: g.bingo.drawn[g.bingo.drawn.length - 1] ?? null,
      remaining: g.bingo.balls.length,
      // Everyone sees everyone's daub COUNT (the race pressure), not the cards.
      daubCounts: Object.fromEntries(
        Object.entries(g.bingo.daubs).map(([id, d]) => [id, d.flat().filter(Boolean).length])
      ),
      winnerId: g.winnerId,
      winningLine: g.winningLine,
    };
  },

  privateState(g, playerId) {
    if (!g.bingo?.cards[playerId]) return null;
    return { card: g.bingo.cards[playerId], daubs: g.bingo.daubs[playerId] };
  },

  events: {
    daub(ctx, { playerId, n }, cb) {
      const ok = B.daub(ctx.g.bingo, playerId, Number(n));
      if (ok) ctx.broadcast();
      cb?.(ok ? { ok: true } : { error: "Can't daub that" });
    },

    bingo(ctx, { playerId }, cb) {
      const { g } = ctx;
      const line = B.findLine(g.bingo, playerId);
      const name = g.players.find((p) => p.id === playerId)?.name;
      if (!line) {
        ctx.notice(`🔕 ${name} called a false BINGO!`);
        return cb?.({ error: "That's not a bingo" });
      }
      g.winnerId = playerId;
      g.winningLine = line;
      ctx.notice(`🎉 BINGO! ${name} wins!`);
      ctx.endGame();
      cb?.({ ok: true });
    },
  },

  tick: {
    ms: 3500,
    onTick(ctx) {
      const { g } = ctx;
      const n = B.drawBall(g.bingo);
      if (n === null) {
        ctx.notice("📭 All 75 balls called — nobody hit bingo. House wins!");
        ctx.endGame();
        return;
      }
      ctx.emit("ball", { n, letter: B.letterFor(n) });

      // Bots daub called numbers (lazier at lower difficulty) and claim
      // wins with a difficulty-based reaction delay.
      for (const bot of g.players.filter((p) => p.isBot)) {
        B.botDaub(g.bingo, bot.id, bot.difficulty);
        const line = B.findLine(g.bingo, bot.id);
        if (line) {
          const delay = { easy: 2600, medium: 1400, hard: 400 }[bot.difficulty] ?? 1400;
          setTimeout(() => {
            const cur = ctx.games.get(ctx.roomId);
            if (!cur || cur.status !== "playing" || cur.winnerId) return;
            const stillLine = B.findLine(cur.bingo, bot.id);
            if (!stillLine) return;
            cur.winnerId = bot.id;
            cur.winningLine = stillLine;
            ctx.notice(`🎉 BINGO! ${bot.name} wins!`);
            cur.status = "ended";
            ctx.broadcast();
          }, delay);
          break;
        }
      }
      ctx.broadcast();
    },
  },
});

export function registerBingoHandlers(io, socket) {
  bingo.register(io, socket);
}
