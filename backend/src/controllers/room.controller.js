import mongoose from "mongoose";
import { Room } from "../models/Room.js";
import { Message } from "../models/Message.js";
import { io } from "../sockets/index.js";
import { roomKey } from "../sockets/chat.handlers.js";
import { isScopedGuest } from "../utils/roomAccess.js";

// Lightweight shape for lists/create/join — one place decides what a room looks
// like to clients.
function toSafeRoom(room) {
  return {
    id: room._id,
    name: room.name,
    code: room.code,
    owner: room.owner,
    visibility: room.visibility || "private",
    memberCount: room.members.length,
    createdAt: room.createdAt,
  };
}

// What a NON-member may see about a public room — note: no invite `code`
// (discovery must not leak the private-style door key).
function toPublicRoom(room) {
  return {
    id: room._id,
    name: room.name,
    visibility: "public",
    memberCount: room.members.length,
    createdAt: room.createdAt,
  };
}

// Detailed shape for the room page — includes the full member list (populated)
// and whether the caller owns it, so the UI can show owner-only actions.
function toRoomDetail(room, userId) {
  const ownerId = room.owner.toString();
  return {
    id: room._id,
    name: room.name,
    code: room.code,
    owner: ownerId,
    isOwner: ownerId === userId,
    createdAt: room.createdAt,
    memberCount: room.members.length,
    members: room.members.map((m) => ({
      id: m._id,
      name: m.name,
      avatarUrl: m.avatarUrl,
      isOwner: m._id.toString() === ownerId,
    })),
  };
}

const notFound = () => {
  const error = new Error("Room not found");
  error.statusCode = 404;
  return error;
};

const forbidden = (message) => {
  const error = new Error(message);
  error.statusCode = 403;
  return error;
};

// Load a room by :id or throw the right error (404 for missing/malformed id).
async function loadRoom(id, { populateMembers = false } = {}) {
  if (!mongoose.isValidObjectId(id)) throw notFound();
  const query = Room.findById(id);
  if (populateMembers) query.populate("members", "name avatarUrl");
  const room = await query;
  if (!room) throw notFound();
  return room;
}

export async function createRoom(req, res, next) {
  try {
    const { name, visibility } = req.body;

    // The 6-char code has a ~1-in-16M collision chance; the unique index
    // catches it (E11000). Retry with a fresh code instead of failing the
    // user's request over cosmic bad luck. A duplicate NAME is also E11000 —
    // but that one is the user's to fix, so it maps to a 409, not a retry.
    let room;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        room = await Room.create({ name, visibility, owner: req.user.id });
        break;
      } catch (err) {
        if (err.code === 11000 && err.keyPattern?.nameLower) {
          const dup = new Error("A room with this name already exists — pick another");
          dup.statusCode = 409;
          throw dup;
        }
        if (err.code !== 11000 || attempt === 2) throw err;
      }
    }

    res.status(201).json({ success: true, data: { room: toSafeRoom(room) } });
  } catch (error) {
    next(error);
  }
}

// Rooms the caller belongs to (owner is always a member — model invariant).
export async function listMyRooms(req, res, next) {
  try {
    const rooms = await Room.find({ members: req.user.id }).sort({ createdAt: -1 });
    res.json({ success: true, data: { rooms: rooms.map(toSafeRoom) } });
  } catch (error) {
    next(error);
  }
}

// Discovery: newest public rooms (capped), safe shape — no invite codes.
export async function listPublicRooms(req, res, next) {
  try {
    const rooms = await Room.find({ visibility: "public" }).sort({ createdAt: -1 }).limit(30);
    res.json({ success: true, data: { rooms: rooms.map(toPublicRoom) } });
  } catch (error) {
    next(error);
  }
}

// POST /:id/join-public — walk into a PUBLIC room without a code. Private
// rooms 404 here (not 403): don't confirm a hidden room exists.
export async function joinPublicRoom(req, res, next) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) throw notFound();
    const room = await Room.findOneAndUpdate(
      { _id: req.params.id, visibility: "public" },
      { $addToSet: { members: req.user.id } },
      { new: true }
    );
    if (!room) throw notFound();

    io?.to(roomKey(room._id)).emit("room:members-changed", { roomId: room._id.toString() });
    res.json({ success: true, data: { room: toSafeRoom(room) } });
  } catch (error) {
    next(error);
  }
}

export async function getRoom(req, res, next) {
  try {
    const room = await loadRoom(req.params.id, { populateMembers: true });

    // Membership gate. 403, not 404: the room exists, you're just not in it —
    // and the join-by-code flow is the door. Scoped guests are let in too.
    const allowed =
      isScopedGuest(req.user, req.params.id) ||
      room.members.some((m) => m._id.toString() === req.user.id);
    if (!allowed) throw forbidden("You are not a member of this room");

    res.json({ success: true, data: { room: toRoomDetail(room, req.user.id) } });
  } catch (error) {
    next(error);
  }
}

// Join by invite code. Idempotent: joining a room you're already in just
// returns it — the end state ("I'm a member") is what matters.
export async function joinRoom(req, res, next) {
  try {
    const { code } = req.body;

    // $addToSet = add only if absent (no duplicate memberships), atomically.
    const room = await Room.findOneAndUpdate(
      { code },
      { $addToSet: { members: req.user.id } },
      { new: true }
    );
    if (!room) throw notFound();

    res.json({ success: true, data: { room: toSafeRoom(room) } });
  } catch (error) {
    next(error);
  }
}

// PATCH /:id — owner renames the room. Broadcasts so members currently in the
// room see the new name live.
export async function renameRoom(req, res, next) {
  try {
    const room = await loadRoom(req.params.id);
    if (room.owner.toString() !== req.user.id) {
      throw forbidden("Only the room owner can rename it");
    }

    room.name = req.body.name;
    try {
      await room.save();
    } catch (err) {
      if (err.code === 11000 && err.keyPattern?.nameLower) {
        const dup = new Error("A room with this name already exists — pick another");
        dup.statusCode = 409;
        throw dup;
      }
      throw err;
    }

    io?.to(roomKey(room._id)).emit("room:updated", {
      roomId: room._id.toString(),
      name: room.name,
    });

    res.json({ success: true, data: { room: toSafeRoom(room) } });
  } catch (error) {
    next(error);
  }
}

// POST /:id/leave — a member removes themselves. The owner can't leave (they'd
// orphan the room); they must delete it. Idempotent: leaving a room you're not
// in still ends in the same state, so it succeeds.
export async function leaveRoom(req, res, next) {
  try {
    const room = await loadRoom(req.params.id);
    if (room.owner.toString() === req.user.id) {
      const error = new Error("The owner can't leave — delete the room instead");
      error.statusCode = 400;
      throw error;
    }

    room.members = room.members.filter((m) => m.toString() !== req.user.id);
    await room.save();

    // Hint anyone still in the room to refresh their member list.
    io?.to(roomKey(room._id)).emit("room:members-changed", {
      roomId: room._id.toString(),
    });

    res.json({ success: true, message: "You have left the room" });
  } catch (error) {
    next(error);
  }
}

// DELETE /:id — owner deletes the room and all its messages, and tells any
// connected members the room is gone so their UI can bounce them out.
export async function deleteRoom(req, res, next) {
  try {
    const room = await loadRoom(req.params.id);
    if (room.owner.toString() !== req.user.id) {
      throw forbidden("Only the room owner can delete it");
    }

    await Message.deleteMany({ room: room._id });
    await room.deleteOne();

    io?.to(roomKey(room._id)).emit("room:closed", { roomId: room._id.toString() });

    res.json({ success: true, message: "Room deleted" });
  } catch (error) {
    next(error);
  }
}
