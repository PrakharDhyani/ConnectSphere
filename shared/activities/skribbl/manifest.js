/**
 * Draw & Guess — Skribbl-style drawing game.
 *
 * Migration note: bespoke (311 lines) and predates lobbyGame.js entirely. The
 * server is authoritative — it owns the timers, the word and the scoring, and
 * sends guessers only a MASKED word while the drawer gets the real one via
 * their per-user socket room. That per-user private channel is the reason this
 * one migrates AFTER the framework games: the SDK needs to express "send only
 * to this player" cleanly.
 *
 * The id stays "skribbl" rather than "draw-guess": it is already baked into
 * socket event names and the sessionStorage key GamesHub uses to restore the
 * open game. Renaming it would break in-flight sessions for zero benefit.
 *
 * Implementation today: backend/src/sockets/game.handlers.js
 *                       frontend/src/components/GamePanel.jsx
 */
export default {
  id: "skribbl",
  version: "1.0.0",
  name: "Draw & Guess",
  description: "One player draws, everyone else races to guess the word.",
  icon: "🎨",
  category: "games",
  surface: "game",

  recommendedFor: { fun: 1.0, creativity: 0.7, team: 0.5, experiment: 0.3 },

  permissions: ["room:read", "socket:namespaced", "storage:room", "presence:read"],

  configSchema: {
    // maxRounds defaults to 3 in game.handlers.js:41.
    maxRounds: { type: "number", label: "Rounds each", default: 3, min: 1, max: 10, integer: true },
    // TURN_MS is 75_000 in game.handlers.js:26.
    turnSeconds: {
      type: "select",
      label: "Time to draw",
      default: 75,
      options: [
        { value: 45, label: "45 seconds" },
        { value: 75, label: "75 seconds" },
        { value: 120, label: "2 minutes" },
      ],
    },
    hints: {
      type: "boolean",
      label: "Reveal hint letters",
      default: true,
      help: "Letters appear one by one as the timer runs down.",
    },
  },

  minPlayers: 2,
  maxPlayers: 12,
  singleton: true,
  requires: [],
};
