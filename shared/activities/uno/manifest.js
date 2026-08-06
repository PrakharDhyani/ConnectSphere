/**
 * UNO — 2–6 player card game.
 *
 * Migration note: thin lobbyGame.js config (237 lines). Notable as the plugin
 * that uses `privateState` — each player sees only their own hand — so it is
 * the reference case for per-seat secrets in the SDK.
 *
 * Implementation today: backend/src/sockets/uno.handlers.js
 *                       frontend/src/components/UnoPanel.jsx
 */
export default {
  id: "uno",
  version: "1.0.0",
  name: "UNO",
  description: "Card chaos for 2–6 players — stacking, skips and reverses.",
  icon: "🃏",
  category: "games",
  surface: "game",

  recommendedFor: { fun: 1.0, team: 0.3 },

  permissions: ["room:read", "socket:namespaced", "storage:room", "presence:read"],

  configSchema: {
    maxPlayers: { type: "number", label: "Max players", default: 6, min: 2, max: 6, integer: true },
    allowBots: { type: "boolean", label: "Allow bots", default: true },
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
    stacking: {
      type: "boolean",
      label: "Allow +2 stacking",
      default: true,
      help: "House rule: answer a +2 with your own instead of drawing.",
    },
  },

  minPlayers: 2,
  maxPlayers: 6,
  singleton: true,
  requires: [],
};
