/**
 * Polls — quick 2–6 option votes inside the room.
 *
 * Surface is "overlay", not "tab": PollPanel renders inline in the Room tab
 * (RoomPage.jsx:760) rather than taking over the screen. It is the one activity
 * that lives alongside chat instead of replacing it — which makes it the
 * reference case for a plugin the runtime composes into an existing surface.
 *
 * Implementation today: backend/src/sockets/poll.handlers.js
 *                       frontend/src/components/PollPanel.jsx
 */
export default {
  id: "poll",
  version: "1.0.0",
  name: "Polls",
  description: "Ask a quick question and see live results.",
  icon: "📊",
  category: "productivity",
  surface: "overlay",

  recommendedFor: { meeting: 1.0, team: 0.9, brainstorm: 0.7, study: 0.5, fun: 0.4, experiment: 0.3 },

  // No storage:room — polls are in-memory and deliberately ephemeral.
  permissions: ["room:read", "socket:namespaced", "presence:read"],

  configSchema: {
    // MAX_OPTIONS = 6 in poll.handlers.js:27 — the hard server-side ceiling.
    maxOptions: { type: "number", label: "Max options", default: 6, min: 2, max: 6, integer: true },
    defaultDuration: {
      type: "select",
      label: "Default poll duration",
      default: 60,
      options: [
        { value: 30, label: "30 seconds" },
        { value: 60, label: "1 minute" },
        { value: 300, label: "5 minutes" },
        { value: 0, label: "Until closed manually" },
      ],
    },
    anyoneCanCreate: {
      type: "boolean",
      label: "Anyone can start a poll",
      default: true,
      help: "Turn off to limit polls to the room owner.",
    },
  },

  singleton: true,
  requires: [],
};
