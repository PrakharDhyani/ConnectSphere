/**
 * Whiteboard — the first activity migrated to the plugin system.
 *
 * Compare with sockets/whiteboard.handlers.js (127 lines): everything that
 * file does by hand — canAccessRoom on join, socket.rooms membership checks on
 * every update, allow() rate limiting repeated four times, a scenes Map, a 3s
 * debounce, a final flush when the last viewer leaves, socket.io room names —
 * is now the host's and the SDK's job. What remains here is only the part that
 * is actually about whiteboards.
 *
 * PERSISTENCE: still the existing `Whiteboard` model, NOT the generic
 * ActivityState collection. Two reasons: the migration stays behaviour-
 * preserving (same data, same shape, instantly revertible), and existing boards
 * keep working with no data migration. Moving that data is a separate decision,
 * not something to smuggle into a refactor.
 */
import { Whiteboard } from "../../models/Whiteboard.js";
import { BUS_EVENTS } from "../eventBus.js";

// roomId -> { elements, saveTimer }
const scenes = new Map();
const SAVE_DEBOUNCE_MS = 3000;

async function loadScene(roomId, maxElements) {
  let scene = scenes.get(roomId);
  if (!scene) {
    const doc = await Whiteboard.findOne({ room: roomId }).lean();
    scene = { elements: doc?.elements || [], saveTimer: null, maxElements };
    scenes.set(roomId, scene);
  }
  return scene;
}

async function persist(roomId) {
  const scene = scenes.get(roomId);
  if (!scene) return;
  await Whiteboard.findOneAndUpdate({ room: roomId }, { elements: scene.elements }, { upsert: true });
}

function schedulePersist(sdk, roomId) {
  const scene = scenes.get(roomId);
  if (!scene) return;
  if (scene.saveTimer) clearTimeout(scene.saveTimer);
  scene.saveTimer = setTimeout(() => {
    persist(roomId).catch((err) => sdk.log.error("persist failed:", err));
  }, SAVE_DEBOUNCE_MS);
}

export default {
  /** Late joiners get the current scene; the ack becomes the client's state. */
  async onJoin(sdk) {
    const scene = await loadScene(sdk.room.id, sdk.meta.config.maxElements);
    return { elements: scene.elements };
  },

  async onLeave(sdk) {
    sdk.socket.toOthers("pointerLeft", { socketId: sdk.user.socketId });
  },

  rates: {
    update: { max: 40, windowMs: 1000 },   // ≤40 scene updates/sec
    pointer: { max: 40, windowMs: 1000 },  // ≤40 cursor moves/sec
  },

  events: {
    /**
     * Whole-scene sync. Excalidraw hands us the full element array rather than
     * a diff, so this is a replace, not a merge.
     */
    update(sdk, { elements } = {}) {
      if (!Array.isArray(elements)) return;
      // Guardrail from the original handler: reject absurd scenes so one client
      // cannot pin the server's memory. Now configurable per room.
      const cap = sdk.meta.config.maxElements || 50_000;
      if (elements.length > cap) return;

      const scene = scenes.get(sdk.room.id);
      if (!scene) return;
      scene.elements = elements;
      sdk.socket.toOthers("update", { elements });
      schedulePersist(sdk, sdk.room.id);
    },

    /** Live cursors. Deliberately not persisted — ephemeral by nature. */
    pointer(sdk, { pointer } = {}) {
      if (!sdk.meta.config.cursorSharing) return;
      sdk.socket.toOthers("pointer", {
        socketId: sdk.user.socketId,
        userId: sdk.user.id,
        name: sdk.user.name,
        pointer,
      });
    },

    /** Explicit save — flush now and tell the room, so AI/summary plugins can react. */
    async save(sdk, _payload, ack) {
      await persist(sdk.room.id);
      const count = scenes.get(sdk.room.id)?.elements.length ?? 0;
      sdk.events.emit(BUS_EVENTS.SAVED, { elementCount: count });
      ack?.({ ok: true, elementCount: count });
    },
  },

  /**
   * Last participant left: persist a final copy and free the in-memory scene.
   * The host calls this — the plugin does not have to detect emptiness itself,
   * which is the part the original handler had to implement by hand.
   */
  async destroy(roomId) {
    const scene = scenes.get(roomId);
    if (!scene) return;
    clearTimeout(scene.saveTimer);
    await persist(roomId);
    scenes.delete(roomId);
  },
};

export function __sceneCount() {
  return scenes.size;
}
