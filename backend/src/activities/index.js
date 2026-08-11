/**
 * Registers every activity's SERVER module with the host.
 *
 * This is the one file that lists server implementations — the host itself must
 * not know which plugins exist, or adding one would edit the dispatcher.
 *
 * ── ADDING A PLUGIN (server side) ────────────────────────────────────────────
 *   1. backend/src/activities/<id>/server.js
 *   2. two lines here (import + register)
 * Nothing else. Not sockets/index.js, not the host, not RoomPage.
 *
 * ── THE MIGRATION FLAG IS GONE (§56) ─────────────────────────────────────────
 * `ACTIVITY_PLUGINS` was a per-plugin rollback: anything not listed kept its
 * original `sockets/*.handlers.js` registration, so old and new ran side by
 * side and a migration reverted with an env var instead of a deploy. It did
 * exactly that job through eight migrations.
 *
 * It is gone because the thing it fell back TO is gone. With every activity a
 * plugin (§54), "off" no longer meant "run the old handler" — it meant the
 * activity was silently dead, which is the precise failure NATIVE_PLUGIN_IDS
 * was invented to prevent. A rollback switch whose fallback no longer exists is
 * not a safety feature; it is a loaded gun pointed at production.
 *
 * Every server module is therefore served unconditionally. Rollback is now what
 * it is for the rest of the codebase: deploy the previous commit.
 */
import { registerActivityModule } from "./host.js";
import { logger } from "../utils/logger.js";

import whiteboardServer from "./whiteboard/server.js";
import stickyNotesServer from "./sticky-notes/server.js";
import skribblServer from "./skribbl/server.js";
import ludoServer from "./ludo/server.js";
import kartServer from "./kart/server.js";
import { chessServer, unoServer, typingServer, bingoServer } from "./framework-games/server.js";

// pluginId -> server module. Every entry is served; see the header.
const SERVER_MODULES = {
  whiteboard: whiteboardServer,
  "sticky-notes": stickyNotesServer,
  // Bespoke, not framework-derived: draw-guess predates lobbyGame.js and owns
  // its own lobby, timers and scoring. See skribbl/server.js.
  skribbl: skribblServer,
  // Also bespoke: Ludo GREW the seat/bot/AFK logic that later became
  // lobbyGame.js but was never moved onto it, and its seats are colour-keyed
  // rather than a flat list. See ludo/server.js.
  ludo: ludoServer,
  // The only activity running its own server-side simulation: a 30Hz
  // setInterval physics loop whose destroy() is the reference lifecycle test.
  // See kart/server.js.
  kart: kartServer,
  // All four come from ONE adapter over the existing lobbyGame framework —
  // no per-game server code. See framework-games/server.js.
  chess: chessServer,
  uno: unoServer,
  typing: typingServer,
  bingo: bingoServer,
};

/** Every plugin with a server module — which, since §54, is every plugin. */
export function enabledPluginIds() {
  return Object.keys(SERVER_MODULES);
}

let registered = null;

/** Register every server module with the host. Idempotent. */
export function registerActivityServerModules() {
  if (registered) return registered;
  const ids = enabledPluginIds();
  for (const id of ids) registerActivityModule(id, SERVER_MODULES[id]);
  registered = ids;
  if (ids.length) logger.info(`✅ activity host serving: ${ids.join(", ")}`);
  return ids;
}

export function __resetRegistration() {
  registered = null;
}

export { SERVER_MODULES };
