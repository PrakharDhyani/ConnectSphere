/**
 * Frontend activity registry — maps a plugin id to its React implementation.
 *
 * WHY THIS FILE IS SEPARATE FROM THE MANIFEST REGISTRY
 * `shared/activities` holds manifests: data, ~1 KB, always loaded, safe to
 * import anywhere. This file holds COMPONENTS, and every one of them is
 * `lazy()` — Excalidraw is ~1.8 MB, KartArena3D drags in a 3D renderer,
 * ChessPanel pulls chess.js. Importing them eagerly to build a registry would
 * undo the code splitting the app already has.
 *
 * So: the manifest says a plugin exists and what it needs; this says how to
 * load it, and only when it is actually opened.
 *
 * ── ADDING A PLUGIN (client side) ────────────────────────────────────────────
 *   1. frontend/src/activities/<id>/index.jsx  (or point at an existing panel)
 *   2. one line in CLIENT_MODULES below
 * Not RoomPage. Not the tab bar — that is generated from manifests.
 */
import { lazy } from "react";

/**
 * pluginId -> lazy component.
 *
 * The existing panels are reused as-is rather than rewritten: this phase moves
 * WHERE they are mounted, not what they do. A panel becomes a "real" plugin
 * (talking through the client SDK instead of importing socket.js directly)
 * when its server side migrates — one concern at a time.
 */
/**
 * The import thunks. Kept separate from the lazy components so a chunk can be
 * warmed without mounting anything — see preloadActivity(). Vite needs a
 * literal import() here to statically find each chunk, so this cannot be
 * built from a loop over ids.
 */
const LOADERS = {
  whiteboard: () => import("@/components/WhiteboardPanel.jsx"),
  skribbl: () => import("@/components/GamePanel.jsx"),
  ludo: () => import("@/components/LudoPanel.jsx"),
  kart: () => import("@/components/KartPanel.jsx"),
  chess: () => import("@/components/ChessPanel.jsx"),
  uno: () => import("@/components/UnoPanel.jsx"),
  typing: () => import("@/components/TypingPanel.jsx"),
  bingo: () => import("@/components/BingoPanel.jsx"),
  poll: () => import("@/components/PollPanel.jsx"),
};

export const CLIENT_MODULES = Object.fromEntries(
  Object.entries(LOADERS).map(([id, load]) => [id, lazy(load)])
);

export const hasClientModule = (id) => Boolean(LOADERS[id]);
export const getClientModule = (id) => CLIENT_MODULES[id] ?? null;

/**
 * Warm a plugin's chunk without mounting it — call on hover/intent so the
 * download overlaps the user's decision instead of following it. Calling the
 * same loader twice is free: the module registry caches it.
 *
 * Errors are swallowed on purpose. This is an optimisation; a genuine load
 * failure must surface at mount, through the error boundary, where the user
 * can actually be told — not as an unhandled rejection from a hover.
 */
export function preloadActivity(id) {
  LOADERS[id]?.().catch(() => {});
}
