/**
 * Typing race — socket wiring. The framework's ticker (500ms) advances bots,
 * streams progress and ends the race; humans report progress at their own
 * pace (client throttles to ~4Hz) and the engine clamps liars.
 */
import { createLobbyGame } from "./lobbyGame.js";
import * as T from "../games/typingRace.js";

const typing = createLobbyGame({
  prefix: "typing",
  minPlayers: 1, // solo practice against bots is legit
  maxPlayers: 8,
  allowBots: true,

  init: () => ({ race: null }),

  start(g) {
    g.race = T.setup(g.players.map((p) => p.id));
  },

  publicState(g) {
    if (!g.race) return {};
    return {
      text: g.race.text,
      startAt: g.race.startAt,
      endAt: g.race.endAt,
      progress: g.race.progress,
      finishOrder: g.race.finishOrder,
      // Full ranking (finishers first, then by distance) for the podium —
      // the race ends the moment someone wins, so most racers WON'T finish.
      standings: T.standings(g.race, g.players.map((p) => p.id)),
    };
  },

  events: {
    progress(ctx, { playerId, chars, errors }, cb) {
      const { g } = ctx;
      const finished = T.applyProgress(g.race, playerId, Number(chars) || 0, Number(errors) || 0);
      if (finished) {
        ctx.notice(`🏁 ${g.players.find((p) => p.id === playerId)?.name} wins the race!`);
        ctx.broadcast();
        if (T.raceOver(g.race, g.players.map((p) => p.id))) ctx.endGame();
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
        ctx.notice(`🏁 ${g.players.find((p) => p.id === id)?.name} wins the race!`);
      }
      if (T.raceOver(g.race, g.players.map((p) => p.id))) {
        ctx.endGame();
      } else {
        ctx.broadcast();
      }
    },
  },
});

export function registerTypingHandlers(io, socket) {
  typing.register(io, socket);
}
