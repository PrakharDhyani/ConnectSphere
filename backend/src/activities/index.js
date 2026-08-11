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
 * ── MIGRATION FLAG ───────────────────────────────────────────────────────────
 * ACTIVITY_PLUGINS is a comma-separated list of plugin ids to serve through the
 * new host (or "all"/"none"). Anything NOT listed keeps its original
 * sockets/*.handlers.js registration, so old and new run side by side and a
 * migration can be reverted with an env var instead of a deploy.
 *
 * Default is "none": Phase 2 ships dark. The new path is opt-in until it has
 * been exercised, because "the old code still runs by default" is the only
 * rollback that cannot itself fail.
 *
 * ── THE FLAG IS PER-PLUGIN, AND SO IS THE MIGRATION ──────────────────────────
 * Enabling a plugin here switches the SERVER to the host. Its CLIENT must
 * already speak the plugin protocol (sdk.socket / activity:event) or the two
 * halves desynchronise: the server stops listening for the legacy events the
 * client is still emitting, and the activity dies silently with nothing in the
 * logs — the same failure mode NATIVE_PLUGIN_IDS exists to prevent.
 *
 * As of the poll migration: `poll` and `sticky-notes` have migrated clients.
 * `whiteboard`'s server module is done but WhiteboardPanel still imports
 * socket.js directly, so turning whiteboard on here WOULD break it. Migrate the
 * client first, then flip the flag.
 */
import { registerActivityModule } from "./host.js";
import { logger } from "../utils/logger.js";

import whiteboardServer from "./whiteboard/server.js";
import stickyNotesServer from "./sticky-notes/server.js";
import skribblServer from "./skribbl/server.js";
import ludoServer from "./ludo/server.js";
import { chessServer, unoServer, typingServer, bingoServer } from "./framework-games/server.js";

// pluginId -> server module. Only these can be enabled by the flag.
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
  // All four come from ONE adapter over the existing lobbyGame framework —
  // no per-game server code. See framework-games/server.js.
  chess: chessServer,
  uno: unoServer,
  typing: typingServer,
  bingo: bingoServer,
};

/**
 * Plugins that exist ONLY as plugins — no sockets/*.handlers.js to fall back to.
 *
 * The flag is a MIGRATION rollback: turning a plugin off means "run the old
 * handler instead". A plugin born after the plugin system has no old handler,
 * so "off" would not mean legacy behaviour, it would mean the activity is
 * silently dead — a tab that renders and never syncs, with nothing in the logs.
 *
 * These are therefore always served. The flag still governs everything being
 * migrated FROM something, which is the only case it was built for.
 */
const NATIVE_PLUGIN_IDS = Object.freeze(["sticky-notes"]);

/** Which plugins the new host should serve, parsed from the env flag. */
export function enabledPluginIds(raw = process.env.ACTIVITY_PLUGINS) {
  const value = String(raw ?? "none").trim().toLowerCase();
  // Native plugins are not opt-in: there is nothing else that could serve them.
  const native = NATIVE_PLUGIN_IDS.filter((id) => SERVER_MODULES[id]);
  const withNative = (ids) => [...new Set([...native, ...ids])];

  if (value === "none" || value === "") return withNative([]);
  if (value === "all") return withNative(Object.keys(SERVER_MODULES));
  return withNative(
    value
      .split(",")
      .map((s) => s.trim())
      .filter((id) => {
        if (!id) return false;
        if (!SERVER_MODULES[id]) {
          // Loud, because a typo here silently means "the old handler is still
          // running" — which looks exactly like success.
          logger.warn(`ACTIVITY_PLUGINS names "${id}", which has no server module — ignoring`);
          return false;
        }
        return true;
      })
  );
}

let registered = null;

/** Register the enabled modules with the host. Idempotent. */
export function registerActivityServerModules(raw) {
  if (registered) return registered;
  const ids = enabledPluginIds(raw);
  for (const id of ids) registerActivityModule(id, SERVER_MODULES[id]);
  registered = ids;
  if (ids.length) logger.info(`✅ activity host serving: ${ids.join(", ")}`);
  return ids;
}

/** True when the ORIGINAL handler for this plugin should still be registered. */
export function legacyHandlerEnabled(pluginId, raw) {
  return !enabledPluginIds(raw).includes(pluginId);
}

export function __resetRegistration() {
  registered = null;
}

export { SERVER_MODULES };
