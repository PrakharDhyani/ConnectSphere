/**
 * Backward compatibility for rooms created before plugins existed.
 *
 * THE DECISION: a resolver, not a migration.
 *
 * Every existing room has no `activities` field. The obvious move — a backfill
 * script — has to be re-run for every deploy and every row created by an older
 * server, is a deploy-ordering hazard, and is hard to undo. Instead, ABSENCE
 * MEANS "everything", resolved at read time:
 *
 *   - old rooms behave exactly as they do today, with no data touched
 *   - no batch job, no deploy step, no downtime
 *   - a room upgrades itself the first time someone edits its activities
 *   - fully reversible: drop the field and the app is where it started
 *
 * A backfill can still run later, purely as cleanup. It is never a prerequisite.
 */
import { getPlugin, getAllPlugins } from "./registry.js";
import { defaultsFor } from "./config-schema.js";

/**
 * What a pre-plugin room implicitly had: everything that existed at the time.
 * Frozen and explicit rather than computed from the registry, because it is a
 * historical fact about old rooms. If it were `getAllPlugins()`, then adding a
 * plugin in 2027 would retroactively install it into every legacy room — which
 * is precisely the kind of surprise this file exists to prevent.
 */
export const LEGACY_ACTIVITY_IDS = Object.freeze([
  "whiteboard", "skribbl", "ludo", "chess", "uno", "typing", "bingo", "kart", "poll",
]);

/**
 * The installed-activity list for a room, legacy or modern.
 *
 * @param {object} room  a Room document or lean object
 * @returns {Array<{id, config, enabled, legacy?}>}
 */
export function resolveInstalled(room) {
  const installed = room?.activities?.installed;

  /**
   * `installed: []` is AMBIGUOUS on its own — it means both "never configured"
   * (Mongoose materialises a missing array as empty) and "the owner removed
   * everything". Treating both as legacy meant removing every activity handed
   * all nine back, which is the opposite of what the owner asked for.
   *
   * `configured` disambiguates: it is set the first time someone edits the
   * room's activities, so an empty list after that is a deliberate choice —
   * a chat-only room — and is respected.
   */
  if (room?.activities?.configured) {
    return (Array.isArray(installed) ? installed : []).map((entry) => ({
      id: entry.id,
      config: entry.config || {},
      enabled: entry.enabled !== false,
      version: entry.version,
    }));
  }

  if (Array.isArray(installed) && installed.length > 0) {
    return installed.map((entry) => ({
      id: entry.id,
      config: entry.config || {},
      enabled: entry.enabled !== false,
      version: entry.version,
    }));
  }
  // Legacy room: everything, at defaults. `legacy: true` lets callers tell
  // "never configured" apart from "deliberately installed all of them" —
  // the management UI wants to say "using defaults" rather than pretend
  // someone chose this.
  return LEGACY_ACTIVITY_IDS.map((id) => ({
    id,
    config: defaultsFor(getPlugin(id)?.configSchema),
    enabled: true,
    legacy: true,
  }));
}

/** Is this activity available in this room right now? */
export function isActivityEnabled(room, activityId) {
  return resolveInstalled(room).some((a) => a.id === activityId && a.enabled);
}

/** A room's config for one plugin, falling back to the plugin's defaults. */
export function getActivityConfig(room, activityId) {
  const entry = resolveInstalled(room).find((a) => a.id === activityId);
  const defaults = defaultsFor(getPlugin(activityId)?.configSchema);
  return { ...defaults, ...(entry?.config || {}) };
}

/**
 * Installed activities joined to their manifests, ready to render.
 *
 * Entries whose manifest is missing come back with `manifest: null` and
 * `unavailable: true` rather than being dropped. That is deliberate: once
 * plugins can be added and removed (and eventually installed from a
 * marketplace), a room WILL sometimes reference a plugin this build does not
 * have. Silently dropping it makes the tab vanish with no explanation;
 * surfacing it lets the UI say "Whiteboard is unavailable on this server".
 * Dropping the entry is also how you get an activity that cannot be
 * uninstalled, because the management UI can no longer see it.
 */
export function resolveActivities(room) {
  return resolveInstalled(room).map((entry) => {
    const manifest = getPlugin(entry.id);
    return {
      ...entry,
      manifest,
      unavailable: !manifest,
      config: manifest ? { ...defaultsFor(manifest.configSchema), ...entry.config } : entry.config,
    };
  });
}

/**
 * The activity a room should open on.
 *
 * Falls back rather than trusting the stored value: `active` may name a plugin
 * that has since been uninstalled, disabled, or removed from the build, and
 * opening a room must never fail because of a stale pointer.
 */
export function resolveActiveActivity(room) {
  const available = resolveActivities(room).filter((a) => a.enabled && !a.unavailable);
  const stored = room?.activities?.active;
  if (stored && available.some((a) => a.id === stored)) return stored;
  return null; // null = the room's own chat surface, which is always present
}

/**
 * Turn a legacy room's implicit set into an explicit one, so it can be edited.
 * Called on first modification — not on read, and never in bulk.
 */
export function materializeLegacy(room) {
  if (room?.activities?.installed?.length) return room.activities.installed;
  return resolveInstalled(room).map(({ id, config, enabled }) => ({
    id,
    version: getPlugin(id)?.version,
    config,
    enabled,
  }));
}

/** Sanity check for tests and boot: every legacy id must be a real plugin. */
export function assertLegacyIdsRegistered() {
  const known = new Set(getAllPlugins().map((p) => p.id));
  const missing = LEGACY_ACTIVITY_IDS.filter((id) => !known.has(id));
  if (missing.length) {
    throw new Error(`LEGACY_ACTIVITY_IDS references unregistered plugin(s): ${missing.join(", ")}`);
  }
  return true;
}
