/**
 * Per-room, per-plugin state storage.
 *
 * Two layers, matching how activities actually behave:
 *
 *   MEMORY  — the live scene / game state. Hot path: every stroke, every move.
 *   PERSIST — a debounced write-behind to Mongo, so a board survives a restart.
 *
 * This is the pattern whiteboard.handlers.js already implements by hand (a
 * `scenes` Map, a 3s debounce, a final flush when the last viewer leaves).
 * Lifting it into the SDK means the next plugin gets it for free instead of
 * reinventing it — and gets the cleanup right, which is the part that is easy
 * to miss.
 *
 * SCALING NOTE: state lives in this process, so it does not survive a restart
 * mid-session and does not work behind more than one server. That is
 * PRE-EXISTING — every current handler does the same. The point of routing it
 * through an interface now is that swapping in Redis later is a change to this
 * file, not to every plugin.
 */
import { ActivityState } from "../models/ActivityState.js";
import { logger } from "../utils/logger.js";

const SAVE_DEBOUNCE_MS = 3000;

// `${pluginId}:${roomId}` -> { data, dirty, timer, loaded }
const cells = new Map();

const cellKey = (pluginId, roomId) => `${pluginId}:${roomId}`;

async function flush(key) {
  const cell = cells.get(key);
  if (!cell || !cell.dirty) return;
  clearTimeout(cell.timer);
  cell.timer = null;
  cell.dirty = false;
  const [pluginId, roomId] = [cell.pluginId, cell.roomId];
  try {
    await ActivityState.findOneAndUpdate(
      { room: roomId, activity: pluginId },
      { data: cell.data },
      { upsert: true }
    );
  } catch (err) {
    // Re-mark dirty so the next write (or the final flush) retries rather than
    // silently losing the scene.
    cell.dirty = true;
    logger.error(`activity storage persist failed (${pluginId}/${roomId}):`, err);
  }
}

/**
 * Storage scoped to one plugin in one room. The plugin cannot name another
 * plugin's cell — the key is closed over, not passed in.
 */
export function createStorage(pluginId, roomId) {
  const key = cellKey(pluginId, roomId);

  const cell = () => {
    let c = cells.get(key);
    if (!c) {
      c = { pluginId, roomId, data: undefined, dirty: false, timer: null, loaded: false };
      cells.set(key, c);
    }
    return c;
  };

  return {
    /** Read state, loading from Mongo on first touch. */
    async get(fallback = null) {
      const c = cell();
      if (!c.loaded) {
        try {
          const doc = await ActivityState.findOne({ room: roomId, activity: pluginId }).lean();
          c.data = doc?.data;
        } catch (err) {
          logger.error(`activity storage load failed (${pluginId}/${roomId}):`, err);
        }
        c.loaded = true;
      }
      return c.data === undefined ? fallback : c.data;
    },

    /** Update in memory and schedule a debounced persist. */
    set(data) {
      const c = cell();
      c.data = data;
      c.loaded = true;
      c.dirty = true;
      if (!c.timer) c.timer = setTimeout(() => flush(key), SAVE_DEBOUNCE_MS);
      return data;
    },

    /** Force a write now — used when the last participant leaves. */
    async flush() {
      await flush(key);
    },

    /**
     * Persist and drop from memory. Called when a room's activity empties, so
     * the Map cannot grow without bound over the life of the process.
     */
    async release() {
      await flush(key);
      const c = cells.get(key);
      if (c?.timer) clearTimeout(c.timer);
      cells.delete(key);
    },

    async clear() {
      const c = cell();
      c.data = undefined;
      c.dirty = true;
      await flush(key);
    },
  };
}

/** Test/shutdown helper: flush everything and forget it. */
export async function flushAllStorage() {
  await Promise.all([...cells.keys()].map((k) => flush(k)));
}

export function __storageCellCount() {
  return cells.size;
}

export function __resetStorage() {
  for (const c of cells.values()) if (c.timer) clearTimeout(c.timer);
  cells.clear();
}
