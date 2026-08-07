/**
 * Registers every built-in activity manifest. Import once at boot:
 *
 *   backend:  import "../../shared/activities/index.js"   (src/index.js)
 *   frontend: import "@shared/activities/index.js"        (main.jsx)
 *
 * Importing is idempotent — ESM caches the module — so a second import from a
 * different entrypoint is a no-op rather than a duplicate-id crash.
 *
 * ── ADDING A PLUGIN ──────────────────────────────────────────────────────────
 * 1. shared/activities/<id>/manifest.js
 * 2. add two lines here (the import and the register call)
 * 3. implementation in frontend/src/activities/<id>/ and/or
 *    backend/src/activities/<id>/
 *
 * That is the complete list. If adding a plugin ever requires touching
 * sockets/index.js, RoomPage.jsx or GamesHub.jsx, the architecture has
 * regressed and that is a bug to fix before building anything else on it.
 */
import { registerPlugin, validateDependencies, getAllPlugins } from "./registry.js";
import { assertLegacyIdsRegistered } from "./compat.js";

import whiteboard from "./whiteboard/manifest.js";
import skribbl from "./skribbl/manifest.js";
import ludo from "./ludo/manifest.js";
import chess from "./chess/manifest.js";
import uno from "./uno/manifest.js";
import typing from "./typing/manifest.js";
import bingo from "./bingo/manifest.js";
import kart from "./kart/manifest.js";
import poll from "./poll/manifest.js";
import stickyNotes from "./sticky-notes/manifest.js";

const BUILT_IN = [whiteboard, skribbl, ludo, chess, uno, typing, bingo, kart, poll, stickyNotes];

let registered = false;

/**
 * Registers the built-ins. Safe to call more than once.
 *
 * Anything malformed throws HERE — at boot, naming the plugin and field —
 * rather than producing a blank tab for one user in production later.
 */
export function registerBuiltInActivities() {
  if (registered) return getAllPlugins();
  for (const manifest of BUILT_IN) registerPlugin(manifest);
  // Deferred until every manifest is in: a plugin may legitimately be
  // registered before something it requires.
  validateDependencies();
  // Guards a subtle footgun — renaming a plugin id without updating the legacy
  // list would silently strip that activity from every pre-plugin room.
  assertLegacyIdsRegistered();
  registered = true;
  return getAllPlugins();
}

// Auto-register on import: the point of this module is that importing it makes
// the catalogue available. An explicit call is still exported for tests that
// reset the registry.
registerBuiltInActivities();

export { BUILT_IN };
export * from "./registry.js";
export * from "./compat.js";
export * from "./purposes.js";
export { validateManifest, CAPABILITIES, CATEGORIES, SURFACES } from "./manifest.js";
export { validateConfigSchema, coerceConfig, defaultsFor, FIELD_TYPES } from "./config-schema.js";
