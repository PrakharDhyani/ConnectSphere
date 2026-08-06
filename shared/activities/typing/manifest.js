/**
 * Typing Race — up to 8 players, solo practice supported.
 *
 * Migration note: thin lobbyGame.js config (149 lines) — the smallest of the
 * framework games, and therefore the best first game to convert in Phase 2.
 * minPlayers is 1 because solo speed-testing is a first-class use.
 *
 * Implementation today: backend/src/sockets/typing.handlers.js
 *                       frontend/src/components/TypingPanel.jsx
 */
export default {
  id: "typing",
  version: "1.0.0",
  name: "Typing Race",
  description: "Fastest fingers win — race up to 8 players through a passage.",
  icon: "⌨️",
  category: "games",
  surface: "game",

  // Genuinely useful for a study room, unlike most of the games.
  recommendedFor: { fun: 0.8, study: 0.5, experiment: 0.3 },

  permissions: ["room:read", "socket:namespaced", "storage:room", "presence:read"],

  configSchema: {
    maxPlayers: { type: "number", label: "Max players", default: 8, min: 1, max: 8, integer: true },
    allowBots: { type: "boolean", label: "Allow bots", default: true },
    // The two modes the game actually implements (typing.handlers.js:7-8).
    mode: {
      type: "select",
      label: "Mode",
      default: "race",
      options: [
        { value: "race", label: "Race — first to finish the passage" },
        { value: "timed", label: "Timed — 60 seconds of endless words" },
      ],
      help: "Timed mode sets your global WPM record.",
    },
    botDifficulty: {
      type: "select",
      label: "Bot difficulty",
      default: "medium",
      options: [
        { value: "easy", label: "Easy" },
        { value: "medium", label: "Medium" },
        { value: "hard", label: "Hard" },
      ],
    },
  },

  minPlayers: 1,
  maxPlayers: 8,
  singleton: true,
  requires: [],
};
