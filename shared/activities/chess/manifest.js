/**
 * Chess — 1v1 with beatable bots.
 *
 * Migration note: a thin config over lobbyGame.js (210 lines), so conversion is
 * near-mechanical. Bounds mirror chess.handlers.js exactly.
 *
 * Implementation today: backend/src/sockets/chess.handlers.js
 *                       frontend/src/components/ChessPanel.jsx
 */
export default {
  id: "chess",
  version: "1.0.0",
  name: "Chess",
  description: "Classic 1v1 chess with bots at three strengths.",
  icon: "♞",
  category: "games",
  surface: "game",

  recommendedFor: { fun: 0.8, study: 0.4, experiment: 0.3 },

  permissions: ["room:read", "socket:namespaced", "storage:room", "presence:read"],

  configSchema: {
    allowBots: { type: "boolean", label: "Allow bots", default: true },
    botDifficulty: {
      type: "select",
      label: "Bot strength",
      default: "medium",
      options: [
        { value: "easy", label: "Easy" },
        { value: "medium", label: "Medium" },
        { value: "hard", label: "Hard" },
      ],
    },
    showLegalMoves: {
      type: "boolean",
      label: "Highlight legal moves",
      default: true,
      help: "Turn off for a tougher game.",
    },
  },

  minPlayers: 2,
  maxPlayers: 2,
  singleton: true,
  requires: [],
};
