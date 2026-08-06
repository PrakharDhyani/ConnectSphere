/**
 * Whiteboard — collaborative Excalidraw canvas.
 *
 * The first plugin to be migrated in Phase 2: bespoke (so it exercises the SDK
 * rather than the lobbyGame framework) but small and self-contained, with the
 * cleanest boundary of anything in the codebase.
 *
 * Implementation today: backend/src/sockets/whiteboard.handlers.js
 *                       frontend/src/components/WhiteboardPanel.jsx
 */
export default {
  id: "whiteboard",
  version: "1.0.0",
  name: "Whiteboard",
  description: "Infinite collaborative canvas — sketch, diagram and annotate together.",
  icon: "🖊️",
  category: "creativity",
  surface: "board",

  recommendedFor: {
    creativity: 1.0,
    brainstorm: 1.0,
    study: 0.9,
    team: 0.8,
    coding: 0.7,
    meeting: 0.6,
    experiment: 0.5,
  },

  // storage:room — scenes persist to the Whiteboard collection.
  // presence:read — live collaborator cursors.
  permissions: ["room:read", "socket:namespaced", "storage:room", "presence:read"],

  configSchema: {
    infiniteCanvas: { type: "boolean", label: "Infinite canvas", default: true },
    darkTheme: { type: "boolean", label: "Dark theme", default: true },
    cursorSharing: { type: "boolean", label: "Show collaborator cursors", default: true },
    // Mirrors MAX_ELEMENTS in the existing handler — a guardrail so one client
    // cannot pin the server's memory with an absurd scene.
    maxElements: {
      type: "select",
      label: "Scene size limit",
      default: 50000,
      options: [
        { value: 10000, label: "Small (10k elements)" },
        { value: 50000, label: "Standard (50k)" },
        { value: 100000, label: "Large (100k)" },
      ],
      help: "Higher limits use more memory for everyone in the room.",
    },
  },

  singleton: true,
  requires: [],
};
