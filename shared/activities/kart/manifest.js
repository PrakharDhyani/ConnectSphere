/**
 * Smash Karts — 3D real-time deathmatch, up to 10 karts.
 *
 * MIGRATION NOTE — THE HARDEST PLUGIN, MIGRATE LAST.
 * Bespoke (478 lines) and the only activity running its own server-side
 * simulation: a setInterval physics loop at TICK_HZ (kart.handlers.js:248).
 * Two lifecycle obligations no other plugin has:
 *   1. destroy() MUST clear that interval, or a leaked loop burns CPU for the
 *      life of the process. This is the reference test for lifecycle correctness.
 *   2. The client must pause rendering on sdk.lifecycle.onHidden() — the runtime
 *      keeps activities mounted-but-hidden across tab switches, and a hidden 3D
 *      game rendering at full rate is a battery drain nobody would attribute to
 *      switching tabs.
 *
 * Implementation today: backend/src/sockets/kart.handlers.js
 *                       frontend/src/components/KartPanel.jsx + KartArena3D.jsx
 */
export default {
  id: "kart",
  version: "1.0.0",
  name: "Smash Karts 3D",
  description: "3D kart deathmatch — grab weapons, wreck friends, up to 10 players.",
  icon: "🏎️",
  category: "games",
  surface: "game",

  recommendedFor: { fun: 1.0, experiment: 0.4 },

  permissions: ["room:read", "socket:namespaced", "storage:room", "presence:read"],

  configSchema: {
    // MAX_KARTS = 10 in kart.handlers.js — the arena is built for it.
    maxPlayers: { type: "number", label: "Max karts", default: 10, min: 2, max: 10, integer: true },
    allowBots: { type: "boolean", label: "Allow bots", default: true },
    // MIN_MATCH_S..MAX_MATCH_S in the handler; MAX_MATCH_S is 600.
    matchLength: {
      type: "select",
      label: "Match length",
      default: 180,
      options: [
        { value: 120, label: "2 minutes" },
        { value: 180, label: "3 minutes" },
        { value: 300, label: "5 minutes" },
        { value: 600, label: "10 minutes" },
      ],
    },
    // Ids and labels mirror MAPS in backend/src/games/kartMaps.js exactly —
    // a value here that is not a real map id would be a silently broken option.
    map: {
      type: "select",
      label: "Arena",
      default: "random",
      options: [
        { value: "random", label: "Random" },
        { value: "speedway", label: "Speedway" },
        { value: "forest", label: "Forest" },
        { value: "volcano", label: "Volcano" },
        { value: "circuit", label: "Grand Circuit" },
        { value: "canyon", label: "Canyon" },
      ],
    },
  },

  minPlayers: 2,
  maxPlayers: 10,
  singleton: true,
  requires: [],
};
