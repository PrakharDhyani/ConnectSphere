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
import { logger } from "../utils/logger.js";

// The Socket.io room name for an app room. Exported so REST controllers can
// broadcast to the same group (e.g. "room:closed" when a room is deleted).
export const roomKey = (roomId) => `room:${roomId}`;

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
      ack?.({ ok: true });
    } catch (err) {
      logger.error("room:join failed:", err);
      ack?.({ ok: false, error: "Could not join room" });
    }
  });

  socket.on("room:leave", async (roomId, ack) => {
    socket.leave(roomKey(roomId));
    await broadcastPresence(io, roomId);
    ack?.({ ok: true });
  });

  socket.on("message:send", async (payload, ack) => {
    try {
      const roomId = payload?.roomId;
      const text = (payload?.text || "").trim();
      if (!roomId || !text) return ack?.({ ok: false, error: "Message cannot be empty" });
      if (text.length > 2000) return ack?.({ ok: false, error: "Message is too long (max 2000)" });

      // Re-check membership on every send — the socket could have been kicked,
      // or is replaying a stale roomId. Never trust the client's claim.
      if (!(await canAccessRoom(socket.user, roomId))) {
        return ack?.({ ok: false, error: "You are not a member of this room" });
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
    if (!roomId || !socket.rooms.has(roomKey(roomId)) || !activity) return;
    socket.to(roomKey(roomId)).emit("room:notify", {
      activity, // "call" | "board" | "skribbl" | "ludo"
      name: socket.user.name,
      userId: socket.user.id,
    });
  });

  // Transient — never stored. `socket.to` = everyone in the room EXCEPT sender.
  socket.on("typing", (roomId) => {
    if (!roomId) return;
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
        broadcastPresence(io, key.slice("room:".length)).catch(() => {});
      }
    });
  });
}
