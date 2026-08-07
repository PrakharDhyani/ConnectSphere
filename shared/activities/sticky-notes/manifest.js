/**
 * Sticky Notes — a shared board of draggable coloured notes.
 *
 * THE POINT OF THIS PLUGIN IS THE CONSTRAINT, NOT THE FEATURE.
 *
 * It is the first activity built AFTER the plugin system, so it is the honest
 * test of guarantee #1: adding a plugin must edit no existing file beyond two
 * registration lines per side. Anything it needed that the platform did not
 * already provide was a platform defect, and got fixed as platform work rather
 * than worked around here — which is exactly what happened with the client SDK
 * and the hardcoded tab body (see PROJECT_NOTES §46).
 *
 * It is deliberately small: a wrong plugin API shows up in a day rather than a
 * fortnight. It exercises sdk.socket (realtime sync), sdk.storage (persistence
 * across restarts), sdk.presence (who else is here) and the config grammar.
 *
 * `surface: "tab"` — its own tab, named from this manifest. Notably NOT
 * "board": the board surface is a single slot that whiteboard occupies, and
 * a second board plugin used to be silently dropped.
 */
export default {
  id: "sticky-notes",
  version: "1.0.0",
  name: "Sticky Notes",
  description: "A shared wall of colourful notes — jot ideas, drag them around, group them together.",
  icon: "📝",
  category: "productivity",
  surface: "tab",

  recommendedFor: {
    brainstorm: 1.0,
    team: 0.95,
    meeting: 0.85,
    study: 0.7,
    creativity: 0.65,
    coding: 0.4,
    experiment: 0.4,
  },

  // storage:room — notes survive a server restart and an empty room.
  // presence:read — show who else has the board open.
  permissions: ["room:read", "socket:namespaced", "storage:room", "presence:read"],

  configSchema: {
    maxNotes: {
      type: "number",
      label: "Maximum notes",
      default: 100,
      min: 10,
      max: 500,
      integer: true,
      help: "A guardrail so one person cannot fill the board for everyone.",
    },
    allowDelete: {
      type: "select",
      label: "Who can delete a note",
      default: "author",
      options: [
        { value: "author", label: "Only whoever wrote it" },
        { value: "anyone", label: "Anyone in the room" },
        { value: "owner", label: "Only the room owner" },
      ],
      help: "Deleting is the one destructive action here, so it is configurable.",
    },
    showAuthors: { type: "boolean", label: "Show who wrote each note", default: true },
  },

  singleton: true,
  requires: [],
};
