/**
 * Bingo — socket wiring. The framework ticker is the CALLER: a ball every
 * 3.5s, broadcast as its own event so the client can animate the ball drop.
 * Cards are private-ish (each player only receives their own via the private
 * channel); daubs and BINGO claims are validated server-side.
 */
import { createLobbyGame } from "./lobbyGame.js";
import * as B from "../games/bingoGame.js";

const ids = (g) => g.players.map((p) => p.id);
const pickerId = (g) => ids(g)[g.bingo.turnIdx % g.players.length];

// After a call in turn-pick mode: did anyone complete 5 lines?
function settleTurnsWin(ctx) {
  const { g } = ctx;
  const counts = B.lineCounts(g.bingo, ids(g));
  const winners = g.players.filter((p) => counts[p.id] >= B.LINES_TO_WIN);
  if (winners.length === 0) return false;
  g.winnerId = winners[0].id;
  ctx.notice(
    winners.length > 1
      ? `🎉 BINGO! ${winners.map((w) => w.name).join(" & ")} hit 5 lines on the same call — ${winners[0].name} takes it by turn order!`
      : `🎉 BINGO! ${winners[0].name} completes 5 lines!`
  );
  ctx.endGame();
  return true;
}

const bingo = createLobbyGame({
  prefix: "bingo",
  minPlayers: 1,
  maxPlayers: 10,
  allowBots: true,

  init: () => ({ bingo: null, winnerId: null, winningLine: null, bingoMode: "classic" }),

  onReset(old, fresh) {
    fresh.bingoMode = old.bingoMode;
  },

  lobbyEvents: {
    setMode(ctx, { mode }, cb) {
      if (mode !== "classic" && mode !== "turns") return cb?.({ error: "Unknown mode" });
      ctx.g.bingoMode = mode;
      ctx.broadcast();
      cb?.({ ok: true });
    },
  },

  start(g) {
    g.bingo = g.bingoMode === "turns"
      ? B.setupTurns(g.players.map((p) => p.id))
      : B.setup(g.players.map((p) => p.id));
    g.winnerId = null;
    g.winningLine = null;
  },

  publicState(g) {
    if (!g.bingo) return { bingoMode: g.bingoMode };
    if (g.bingo.variant === "turns") {
      return {
        bingoMode: "turns",
        called: g.bingo.called,
        last: g.bingo.called[g.bingo.called.length - 1] ?? null,
        pickerId: g.status === "playing" ? pickerId(g) : null,
        lineCounts: B.lineCounts(g.bingo, ids(g)),
        linesToWin: B.LINES_TO_WIN,
        winnerId: g.winnerId,
      };
    }
    return {
      bingoMode: "classic",
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
    if (g.bingo.variant === "turns") return { card: g.bingo.cards[playerId] };
    return { card: g.bingo.cards[playerId], daubs: g.bingo.daubs[playerId] };
  },

  events: {
    daub(ctx, { playerId, n }, cb) {
      if (ctx.g.bingo.variant === "turns") return cb?.({ error: "Numbers daub themselves in turn-pick" });
      const ok = B.daub(ctx.g.bingo, playerId, Number(n));
      if (ok) ctx.broadcast();
      cb?.(ok ? { ok: true } : { error: "Can't daub that" });
    },

    bingo(ctx, { playerId }, cb) {
      const { g } = ctx;
      if (g.bingo.variant === "turns") return cb?.({ error: "Turn-pick wins are automatic at 5 lines" });
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

    // Turn-pick: the player whose turn it is calls any uncalled 1–25 number.
    pick(ctx, { playerId, n }, cb) {
      const { g } = ctx;
      if (g.bingo.variant !== "turns") return cb?.({ error: "Only in turn-pick mode" });
      if (pickerId(g) !== playerId) return cb?.({ error: "Not your turn to call" });
      if (!B.callNumber(g.bingo, Number(n))) return cb?.({ error: "That number can't be called" });
      ctx.emit("ball", { n: Number(n), letter: null, by: g.players.find((p) => p.id === playerId)?.name });
      if (settleTurnsWin(ctx)) return cb?.({ ok: true });
      g.bingo.turnIdx += 1;
      ctx.broadcast();
      cb?.({ ok: true });
    },
  },

  // Turn-pick pacing: humans get 20s to call before the server calls for them.
  afkDeadline(g) {
    if (g.bingo?.variant !== "turns") return null;
    const seat = g.players.find((p) => p.id === pickerId(g));
    if (!seat || seat.isBot) return null;
    return Date.now() + 20_000;
  },
  onAfkTimeout(ctx) {
    const { g } = ctx;
    const id = pickerId(g);
    const n = B.bestPick(g.bingo, id, "easy");
    if (n === null) return;
    ctx.notice(`⏰ Auto-calling ${n} for ${g.players.find((p) => p.id === id)?.name}`);
    B.callNumber(g.bingo, n);
    ctx.emit("ball", { n, letter: null });
    if (settleTurnsWin(ctx)) return;
    g.bingo.turnIdx += 1;
    ctx.broadcast();
  },

  // Bots take their calling turns in turn-pick mode.
  botTurn(g) {
    if (g.bingo?.variant !== "turns") return false;
    return Boolean(g.players.find((p) => p.id === pickerId(g))?.isBot);
  },
  botDelayMs(g) {
    const d = g.players.find((p) => p.id === pickerId(g))?.difficulty;
    return d === "hard" ? 1100 : d === "easy" ? 2200 : 1600;
  },
  botAct(ctx) {
    const { g } = ctx;
    const id = pickerId(g);
    const seat = g.players.find((p) => p.id === id);
    const n = B.bestPick(g.bingo, id, seat?.difficulty);
    if (n === null) return;
    B.callNumber(g.bingo, n);
    ctx.emit("ball", { n, letter: null, by: seat?.name });
    if (settleTurnsWin(ctx)) return;
    g.bingo.turnIdx += 1;
    ctx.broadcast();
  },

  tick: {
    ms: 3500,
    onTick(ctx) {
      const { g } = ctx;
      if (g.bingo.variant === "turns") return; // no auto-caller in turn-pick
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

/**
 * The game DEFINITION, hosted by the activity host through
 * `activities/lobbyGameAdapter.js`. The legacy `registerBingoHandlers` is gone
 * (§56) — every activity is a plugin now, so its socket registration was dead
 * code. This file is the rules, and only the rules.
 */
export { bingo };
