/**
 * Bingo — up to 10 players, auto-calling.
 *
 * Migration note: thin lobbyGame.js config (212 lines). Uses the framework's
 * `tick` hook for the number caller, so it is the reference case for a plugin
 * with a server-side heartbeat — a smaller rehearsal for Kart's physics loop.
 *
 * Implementation today: backend/src/sockets/bingo.handlers.js
 *                       frontend/src/components/BingoPanel.jsx
 */
export default {
  id: "bingo",
  version: "1.0.0",
  name: "Bingo",
  description: "Daub and shout — up to 10 players, numbers called automatically.",
  icon: "🎱",
  category: "games",
  surface: "game",

  recommendedFor: { fun: 0.9, team: 0.4, meeting: 0.2 },

  permissions: ["room:read", "socket:namespaced", "storage:room", "presence:read"],

  configSchema: {
    maxPlayers: { type: "number", label: "Max players", default: 10, min: 1, max: 10, integer: true },
    allowBots: { type: "boolean", label: "Allow bots", default: true },
    // Default mirrors the framework ticker in bingo.handlers.js (ms: 3500).
    callSpeedMs: {
      type: "select",
      label: "Call speed",
      default: 3500,
      options: [
        { value: 2000, label: "Fast (2s)" },
        { value: 3500, label: "Normal (3.5s)" },
        { value: 6000, label: "Relaxed (6s)" },
      ],
    },
  },

  minPlayers: 1,
  maxPlayers: 10,
  singleton: true,
  requires: [],
};
