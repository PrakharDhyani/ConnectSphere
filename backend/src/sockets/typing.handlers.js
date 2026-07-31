/**
 * Typing race — socket wiring. The framework's ticker (500ms) advances bots,
 * streams progress and ends the race; humans report progress at their own
 * pace (client throttles to ~4Hz) and the engine clamps liars.
 *
 * Modes:
 *   race  — passage sprint, first finisher ends it
 *   timed — 60 seconds of endless words; final WPM sets GLOBAL records
 *           (TypingRecord, best per user, top-10 leaderboard)
 */
import { createLobbyGame } from "./lobbyGame.js";
import * as T from "../games/typingRace.js";
import { TypingRecord } from "../models/TypingRecord.js";
import { logger } from "../utils/logger.js";

// A timed run just ended: persist every HUMAN's final WPM (bots don't hold
// records), then end the game — awaited so the "ended" broadcast reaches
// clients only after the leaderboard reflects the new scores.
async function finishTimedRace(ctx) {
  const { g } = ctx;
  const results = [];
  for (const p of g.players) {
    if (p.isBot) continue;
    const prog = g.race.progress[p.id];
    if (!prog || prog.chars < 25) continue; // don't record idle keyboards
    const wpm = Math.round(prog.chars / 5 / (T.TIMED_MS / 60000));
    const accuracy = Math.max(0, Math.round(100 * (prog.chars / (prog.chars + prog.errors || 1))));
    results.push({ userId: p.id, name: p.name, wpm, accuracy });
  }
  try {
    const newBests = [];
    for (const r of results) {
      if (await TypingRecord.submit(r)) newBests.push(r);
    }
    for (const r of newBests) ctx.notice(`🏆 New personal best: ${r.name} — ${r.wpm} wpm!`);
  } catch (err) {
    logger.error("typing record submit failed:", err);
  }
  const top = T.standings(g.race, g.players.map((p) => p.id))[0];
  const topProg = g.race.progress[top];
  if (top && topProg) {
    ctx.notice(`⏱️ Time! ${g.players.find((p) => p.id === top)?.name} tops the board at ${topProg.wpm} wpm`);
  }
  ctx.endGame();
}

function maybeEnd(ctx) {
  const { g } = ctx;
  if (!T.raceOver(g.race, g.players.map((p) => p.id), Date.now(), g.raceMode)) return false;
  if (g.raceMode === "timed") {
    // The record write is async; the ticker can fire again before endGame()
    // lands — the synchronous flag stops a double submit/notice.
    if (!g._finishing) {
      g._finishing = true;
      finishTimedRace(ctx);
    }
  } else {
    ctx.endGame();
  }
  return true;
}

const typing = createLobbyGame({
  prefix: "typing",
  minPlayers: 1, // solo speed-testing is a first-class use
  maxPlayers: 8,
  allowBots: true,

  init: () => ({ race: null, raceMode: "race" }),

  // Rematches keep the chosen mode.
  onReset(old, fresh) {
    fresh.raceMode = old.raceMode;
  },

  lobbyEvents: {
    setMode(ctx, { mode }, cb) {
      if (mode !== "race" && mode !== "timed") return cb?.({ error: "Unknown mode" });
      ctx.g.raceMode = mode;
      ctx.broadcast();
      cb?.({ ok: true });
    },
  },

  start(g) {
    g.race = T.setup(g.players.map((p) => p.id), Math.random, g.raceMode);
  },

  publicState(g) {
    if (!g.race) return { raceMode: g.raceMode };
    return {
      raceMode: g.raceMode,
      text: g.race.text,
      startAt: g.race.startAt,
      endAt: g.race.endAt,
      progress: g.race.progress,
      finishOrder: g.race.finishOrder,
      // Full ranking (finishers first, then by distance) for the podium —
      // a race ends the moment someone wins, so most racers WON'T finish.
      standings: T.standings(g.race, g.players.map((p) => p.id)),
    };
  },

  events: {
    progress(ctx, { playerId, chars, errors }, cb) {
      const { g } = ctx;
      const finished = T.applyProgress(g.race, playerId, Number(chars) || 0, Number(errors) || 0);
      if (finished) {
        const place = g.race.finishOrder.indexOf(playerId) + 1;
        ctx.notice(place === 1
          ? `🏁 ${g.players.find((p) => p.id === playerId)?.name} wins the race!`
          : `🏁 ${g.players.find((p) => p.id === playerId)?.name} finishes #${place}`);
        ctx.broadcast();
        maybeEnd(ctx);
      }
      cb?.({ ok: true });
    },
  },

  tick: {
    ms: 500,
    onTick(ctx) {
      const { g } = ctx;
      const finished = T.tickBots(g.race, g.players.filter((p) => p.isBot));
      for (const id of finished) {
        const place = g.race.finishOrder.indexOf(id) + 1;
        ctx.notice(place === 1
          ? `🏁 ${g.players.find((p) => p.id === id)?.name} wins the race!`
          : `🏁 ${g.players.find((p) => p.id === id)?.name} finishes #${place}`);
      }
      if (!maybeEnd(ctx)) ctx.broadcast();
    },
  },
});

export function registerTypingHandlers(io, socket) {
  typing.register(io, socket);

  // Global top-10 speed records (from the 60s timed mode). Public to any
  // authenticated socket — it's a leaderboard, not a secret.
  socket.on("typing:leaderboard", async (_payload, cb) => {
    try {
      const top = await TypingRecord.topTen();
      cb?.({ ok: true, top });
    } catch {
      cb?.({ error: "Leaderboard unavailable" });
    }
  });
}
