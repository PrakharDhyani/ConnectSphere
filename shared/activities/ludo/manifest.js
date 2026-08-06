/**
 * Ludo — 2–4 player board game with bots.
 *
 * Migration note: bespoke (536 lines) — it grew the seat/bot/AFK logic that
 * later BECAME lobbyGame.js, but was never moved onto it. Seats are colour-keyed
 * (red/green/yellow/blue), which is why maxPlayers is hard-capped at 4.
 *
 * Implementation today: backend/src/sockets/ludo.handlers.js
 *                       frontend/src/components/LudoPanel.jsx
 */
export default {
  id: "ludo",
  version: "1.0.0",
  name: "Ludo",
  description: "The classic race-home board game, with beatable bots.",
  icon: "🎲",
  category: "games",
  surface: "game",

  recommendedFor: { fun: 1.0, experiment: 0.3, team: 0.3 },

  permissions: ["room:read", "socket:namespaced", "storage:room", "presence:read"],

  configSchema: {
    // Four coloured seats is a property of the board, so this cannot exceed 4.
    maxPlayers: {
      type: "number",
      label: "Max players",
      default: 4,
      min: 2,
      max: 4,
      integer: true,
    },
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
    turnTimer: {
      type: "select",
      label: "Turn timer",
      default: 30,
      options: [
        { value: 15, label: "15 seconds" },
        { value: 30, label: "30 seconds" },
        { value: 60, label: "60 seconds" },
        { value: 0, label: "Off" },
      ],
      help: "Players who miss their turn are skipped.",
    },
  },

  minPlayers: 2,
  maxPlayers: 4,
  singleton: true,
  requires: [],
};
