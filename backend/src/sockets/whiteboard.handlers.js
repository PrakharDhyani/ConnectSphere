/**
 * Collaborative whiteboard sync over Socket.io.
 *
 * The heavy lifting (the actual drawing surface, tools, undo, export, etc.) is
 * the Excalidraw React component on the client. Our job here is the *group*
 * part: broadcast scene changes + live cursors to everyone viewing the board,
 * hand the current scene to late joiners, and persist it (debounced).
 *
 * Events (client → server):
 *   whiteboard:join   (roomId)                → membership-checked; ack returns current elements
 *   whiteboard:leave  (roomId)
 *   whiteboard:update ({roomId, elements})    → store + broadcast to others
 *   whiteboard:pointer({roomId, pointer})     → relay live cursor to others
 * Events (server → client):
 *   whiteboard:update ({elements})   whiteboard:pointer ({socketId,userId,name,pointer})
 *   whiteboard:pointerLeft ({socketId})
 */
import { Whiteboard } from "../models/Whiteboard.js";
import { canAccessRoom } from "../utils/roomAccess.js";
import { allow } from "../utils/socketRate.js";
import { logger } from "../utils/logger.js";

const wbKey = (roomId) => `wb:${roomId}`;

// roomId -> { elements, saveTimer }
const scenes = new Map();
const SAVE_DEBOUNCE_MS = 3000;
// Guardrail: reject absurd scenes so one client can't pin the server's memory.
const MAX_ELEMENTS = 50_000;

async function loadScene(roomId) {
  let scene = scenes.get(roomId);
  if (!scene) {
    const doc = await Whiteboard.findOne({ room: roomId }).lean();
    scene = { elements: doc?.elements || [], saveTimer: null };
    scenes.set(roomId, scene);
  }
  return scene;
}

// Free a room's in-memory scene once nobody's viewing the board — persist a
// final copy first. Prevents the scenes Map from growing forever.
async function cleanupIfEmpty(io, roomId) {
  const sockets = await io.in(wbKey(roomId)).fetchSockets();
  if (sockets.length > 0) return;
  const scene = scenes.get(roomId);
  if (!scene) return;
  clearTimeout(scene.saveTimer);
  try {
    await Whiteboard.findOneAndUpdate({ room: roomId }, { elements: scene.elements }, { upsert: true });
  } catch (err) {
    logger.error("whiteboard final persist failed:", err);
  }
  scenes.delete(roomId);
}

function schedulePersist(roomId) {
  const scene = scenes.get(roomId);
  if (!scene) return;
  if (scene.saveTimer) clearTimeout(scene.saveTimer);
  scene.saveTimer = setTimeout(async () => {
    try {
      await Whiteboard.findOneAndUpdate(
        { room: roomId },
        { elements: scene.elements },
        { upsert: true }
      );
    } catch (err) {
      logger.error("whiteboard persist failed:", err);
    }
  }, SAVE_DEBOUNCE_MS);
}

export function registerWhiteboardHandlers(io, socket) {
  socket.on("whiteboard:join", async (roomId, cb) => {
    try {
      if (!(await canAccessRoom(socket.user, roomId))) return cb?.({ error: "Not allowed" });
      socket.join(wbKey(roomId));
      const scene = await loadScene(roomId);
      cb?.({ elements: scene.elements });
    } catch (err) {
      logger.error("whiteboard:join failed:", err);
      cb?.({ error: "Could not open whiteboard" });
    }
  });

  socket.on("whiteboard:leave", (roomId) => {
    socket.leave(wbKey(roomId));
    socket.to(wbKey(roomId)).emit("whiteboard:pointerLeft", { socketId: socket.id });
    cleanupIfEmpty(io, roomId).catch(() => {});
  });

  socket.on("whiteboard:update", ({ roomId, elements } = {}) => {
    // Cheap auth: only sockets that joined the wb room (access-checked there)
    // may broadcast — avoids a DB hit on every stroke.
    if (!roomId || !socket.rooms.has(wbKey(roomId)) || !Array.isArray(elements)) return;
    if (elements.length > MAX_ELEMENTS) return; // reject absurd payloads
    if (!allow(socket, "wb:update", 40, 1000)) return; // ≤40 updates/sec
    const scene = scenes.get(roomId);
    if (!scene) return;
    scene.elements = elements;
    socket.to(wbKey(roomId)).emit("whiteboard:update", { elements });
    schedulePersist(roomId);
  });

  socket.on("whiteboard:pointer", ({ roomId, pointer } = {}) => {
    if (!roomId || !socket.rooms.has(wbKey(roomId))) return;
    if (!allow(socket, "wb:pointer", 40, 1000)) return;
    socket.to(wbKey(roomId)).emit("whiteboard:pointer", {
      socketId: socket.id,
      userId: socket.user.id,
      name: socket.user.name,
      pointer,
    });
  });

  socket.on("disconnecting", () => {
    const wbRooms = [...socket.rooms].filter((k) => k.startsWith("wb:"));
    for (const key of wbRooms) {
      socket.to(key).emit("whiteboard:pointerLeft", { socketId: socket.id });
    }
    // After this socket has actually left, free any now-empty scenes.
    setImmediate(() => {
      for (const key of wbRooms) cleanupIfEmpty(io, key.slice(3)).catch(() => {});
    });
  });
}
