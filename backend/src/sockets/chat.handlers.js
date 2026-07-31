/**
 * Chat event handlers for one connected socket.
 *
 * Socket.io "rooms" (a server-side grouping of sockets) map 1:1 to our app
 * rooms — we prefix the id (`room:<id>`) to avoid clashing with any other
 * grouping. Broadcasting to `room:<id>` reaches exactly the sockets that
 * joined it.
 *
 * Events (client → server), each with an optional ack callback:
 *   room:join   (roomId)          → membership-checked, joins + broadcasts presence
 *   room:leave  (roomId)          → leaves + broadcasts presence
 *   message:send({roomId,text})   → persists + broadcasts message:new
 *   typing      (roomId)          → relays a transient typing ping to others
 *
 * Events (server → client):
 *   message:new       (message)   presence:update ({roomId, users})   typing ({roomId, user})
 */
import { Message } from "../models/Message.js";
import { canAccessRoom } from "../utils/roomAccess.js";
import { allow } from "../utils/socketRate.js";
import { logger } from "../utils/logger.js";

const ANNOUNCE_ACTIVITIES = new Set(["call", "board", "skribbl", "ludo", "kart", "chess", "uno", "typing", "bingo"]);

// The Socket.io room name for an app room. Exported so REST controllers can
// broadcast to the same group (e.g. "room:closed" when a room is deleted).
export const roomKey = (roomId) => `room:${roomId}`;

// roomId:userId → last chat timestamp, for slow mode.
const slowModeLast = new Map();

// roomId → Map<userId, name> of members currently recording the call. The
// indicator is a TRANSPARENCY feature: everyone in the room must always know
// a recording is happening, so state changes broadcast to the whole room.
const recordersByRoom = new Map();

function recorderList(roomId) {
  const m = recordersByRoom.get(roomId);
  return m ? [...m.entries()].map(([id, name]) => ({ id, name })) : [];
}

function broadcastRecorders(io, roomId) {
  io.to(roomKey(roomId)).emit("recording:changed", {
    roomId,
    recorders: recorderList(roomId),
  });
}

// Everyone currently connected to a room, de-duplicated by user (one person
// can have several tabs = several sockets, but shows up once).
async function presenceList(io, roomId) {
  const sockets = await io.in(roomKey(roomId)).fetchSockets();
  const byUser = new Map();
  for (const s of sockets) {
    byUser.set(s.user.id, { id: s.user.id, name: s.user.name, avatarUrl: s.user.avatarUrl });
  }
  return [...byUser.values()];
}

async function broadcastPresence(io, roomId) {
  io.to(roomKey(roomId)).emit("presence:update", {
    roomId,
    users: await presenceList(io, roomId),
  });
}

export function registerChatHandlers(io, socket) {
  socket.on("room:join", async (roomId, ack) => {
    try {
      if (!(await canAccessRoom(socket.user, roomId))) {
        return ack?.({ ok: false, error: "You are not a member of this room" });
      }
      socket.join(roomKey(roomId));
      await broadcastPresence(io, roomId);
      // Late joiners must learn about in-progress recordings immediately.
      ack?.({ ok: true, recorders: recorderList(roomId) });
    } catch (err) {
      logger.error("room:join failed:", err);
      ack?.({ ok: false, error: "Could not join room" });
    }
  });

  socket.on("room:leave", async (roomId, ack) => {
    socket.leave(roomKey(roomId));
    const rec = recordersByRoom.get(roomId);
    if (rec?.delete(socket.user.id)) broadcastRecorders(io, roomId);
    await broadcastPresence(io, roomId);
    ack?.({ ok: true });
  });

  // Toggle my "recording" indicator for a room (client-side recorder).
  socket.on("recording:set", async ({ roomId, on } = {}, ack) => {
    if (!roomId || !socket.rooms.has(roomKey(roomId))) return ack?.({ ok: false });
    if (!(await canAccessRoom(socket.user, roomId))) return ack?.({ ok: false });
    let rec = recordersByRoom.get(roomId);
    if (!rec) {
      rec = new Map();
      recordersByRoom.set(roomId, rec);
    }
    if (on) rec.set(socket.user.id, socket.user.name);
    else rec.delete(socket.user.id);
    if (rec.size === 0) recordersByRoom.delete(roomId);
    broadcastRecorders(io, roomId);
    ack?.({ ok: true });
  });

  socket.on("message:send", async (payload, ack) => {
    try {
      const roomId = payload?.roomId;
      const text = (payload?.text || "").trim();
      if (!roomId || !text) return ack?.({ ok: false, error: "Message cannot be empty" });
      if (text.length > 2000) return ack?.({ ok: false, error: "Message is too long (max 2000)" });
      if (!allow(socket, "msg", 15, 10_000)) return ack?.({ ok: false, error: "Slow down a moment" });

      // Re-check membership on every send — the socket could have been kicked,
      // or is replaying a stale roomId. Never trust the client's claim.
      if (!(await canAccessRoom(socket.user, roomId))) {
        return ack?.({ ok: false, error: "You are not a member of this room" });
      }

      // Slow mode: non-owners get one message per slowModeSec. The clock is an
      // in-memory map — per-process is fine, this is friction not security.
      const roomDoc = await Message.db.model("Room").findById(roomId).select("slowModeSec owner").lean();
      if (roomDoc?.slowModeSec > 0 && roomDoc.owner.toString() !== socket.user.id) {
        const key = `${roomId}:${socket.user.id}`;
        const last = slowModeLast.get(key) || 0;
        const waitMs = roomDoc.slowModeSec * 1000 - (Date.now() - last);
        if (waitMs > 0) {
          return ack?.({ ok: false, error: `Slow mode — wait ${Math.ceil(waitMs / 1000)}s` });
        }
        slowModeLast.set(key, Date.now());
        if (slowModeLast.size > 5000) slowModeLast.clear(); // crude but bounded
      }

      const doc = await Message.create({ room: roomId, sender: socket.user.id, text });
      const message = {
        id: doc._id.toString(),
        roomId,
        text: doc.text,
        createdAt: doc.createdAt,
        sender: { id: socket.user.id, name: socket.user.name, avatarUrl: socket.user.avatarUrl },
      };

      io.to(roomKey(roomId)).emit("message:new", message);
      ack?.({ ok: true, message });
    } catch (err) {
      logger.error("message:send failed:", err);
      ack?.({ ok: false, error: "Could not send message" });
    }
  });

  // Activity announcements — "X started a Ludo game", "X opened the whiteboard",
  // "X started the call". Relayed to everyone in the room except the sender so
  // their UI can pop a toast. Purely a notification; carries no trust.
  socket.on("room:announce", ({ roomId, activity } = {}) => {
    if (!roomId || !socket.rooms.has(roomKey(roomId)) || !ANNOUNCE_ACTIVITIES.has(activity)) return;
    if (!allow(socket, "announce", 5, 10_000)) return;
    socket.to(roomKey(roomId)).emit("room:notify", {
      activity, // "call" | "board" | "skribbl" | "ludo"
      name: socket.user.name,
      userId: socket.user.id,
    });
  });

  // Transient — never stored. `socket.to` = everyone in the room EXCEPT sender.
  socket.on("typing", (roomId) => {
    if (!roomId || !allow(socket, "typing", 10, 5000)) return;
    socket.to(roomKey(roomId)).emit("typing", {
      roomId,
      user: { id: socket.user.id, name: socket.user.name },
    });
  });

  // `disconnecting` fires while socket.rooms still lists the rooms. We defer the
  // presence recompute to the next tick so the socket has actually left first,
  // otherwise it would still count itself as present.
  socket.on("disconnecting", () => {
    const rooms = [...socket.rooms].filter((k) => k.startsWith("room:"));
    setImmediate(() => {
      for (const key of rooms) {
        const roomId = key.slice("room:".length);
        // A recorder that vanishes must not leave a stuck 🔴 indicator.
        const rec = recordersByRoom.get(roomId);
        if (rec?.delete(socket.user.id)) {
          if (rec.size === 0) recordersByRoom.delete(roomId);
          broadcastRecorders(io, roomId);
        }
        broadcastPresence(io, roomId).catch(() => {});
      }
    });
  });
}
