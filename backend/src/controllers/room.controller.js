import mongoose from "mongoose";
import { Room } from "../models/Room.js";

// Response whitelist — one place decides what a room looks like to clients.
function toSafeRoom(room) {
  return {
    id: room._id,
    name: room.name,
    code: room.code,
    owner: room.owner,
    memberCount: room.members.length,
    createdAt: room.createdAt,
  };
}

const notFound = () => {
  const error = new Error("Room not found");
  error.statusCode = 404;
  return error;
};

export async function createRoom(req, res, next) {
  try {
    const { name } = req.body;

    // The 6-char code has a ~1-in-16M collision chance; the unique index
    // catches it (E11000). Retry with a fresh code instead of failing the
    // user's request over cosmic bad luck.
    let room;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        room = await Room.create({ name, owner: req.user.id });
        break;
      } catch (err) {
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

export async function getRoom(req, res, next) {
  try {
    // A malformed id would make findById throw a CastError (→ 500); treat
    // "not even a valid id" as the same 404 a missing room gets.
    if (!mongoose.isValidObjectId(req.params.id)) throw notFound();

    const room = await Room.findById(req.params.id);
    if (!room) throw notFound();

    // Membership gate. 403, not 404: the room exists, you're just not in it —
    // and the join-by-code flow is the door.
    const isMember = room.members.some((m) => m.toString() === req.user.id);
    if (!isMember) {
      const error = new Error("You are not a member of this room");
      error.statusCode = 403;
      throw error;
    }

    res.json({ success: true, data: { room: toSafeRoom(room) } });
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
