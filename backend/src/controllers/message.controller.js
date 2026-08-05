import mongoose from "mongoose";
import { Room } from "../models/Room.js";
import { Message } from "../models/Message.js";
import { isScopedGuest } from "../utils/roomAccess.js";
import { storageEnabled, uploadChatAttachment } from "../services/storage.service.js";

const notFound = () => {
  const error = new Error("Room not found");
  error.statusCode = 404;
  return error;
};

/**
 * GET /api/rooms/:id/messages?before=<ISO>&limit=30
 *
 * Durable chat history (live messages arrive over the socket). Membership-gated
 * exactly like GET /rooms/:id. "Keyset" pagination via `before`: pass the
 * oldest message's timestamp you already have to fetch the previous page —
 * cheaper and stable under new inserts, unlike offset/skip.
 */
export async function getRoomMessages(req, res, next) {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) throw notFound();

    const room = await Room.findById(id).select("members").lean();
    if (!room) throw notFound();
    const allowed =
      isScopedGuest(req.user, id) || room.members.some((m) => m.toString() === req.user.id);
    if (!allowed) {
      const error = new Error("You are not a member of this room");
      error.statusCode = 403;
      throw error;
    }

    const limit = Math.min(parseInt(req.query.limit, 10) || 30, 100);
    const filter = { room: id };
    if (req.query.before) {
      const before = new Date(req.query.before);
      if (!Number.isNaN(before.getTime())) filter.createdAt = { $lt: before };
    }

    // Fetch newest-first (uses the room+createdAt index), then reverse so the
    // client gets them oldest→newest and can simply append.
    const docs = await Message.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate("sender", "name avatarUrl")
      .lean();

    const messages = docs.reverse().map((d) => ({
      id: d._id,
      roomId: id,
      text: d.text,
      attachments: d.attachments || [],
      createdAt: d.createdAt,
      sender: d.sender
        ? { id: d.sender._id, name: d.sender.name, avatarUrl: d.sender.avatarUrl }
        : null,
    }));

    res.json({ success: true, data: { messages } });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/rooms/:id/attachments  (multipart, field name "files", up to 10)
 *
 * Uploads only — this does NOT create a message. The client uploads first,
 * gets attachment descriptors back, then sends ONE `message:send` carrying
 * them. Two reasons: the socket path stays small and JSON-only (no binary
 * frames), and a failed upload never leaves a half-message in the history.
 */
export async function uploadRoomAttachments(req, res, next) {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) throw notFound();

    if (!storageEnabled()) {
      const error = new Error("File storage is not configured");
      error.statusCode = 501;
      throw error;
    }

    // Same membership gate as reading history — a guest scoped to this room
    // may upload, anyone else may not.
    const room = await Room.findById(id).select("members banned").lean();
    if (!room) throw notFound();
    const banned = (room.banned || []).some((b) => b.user?.toString() === req.user.id);
    const allowed =
      !banned &&
      (isScopedGuest(req.user, id) || room.members.some((m) => m.toString() === req.user.id));
    if (!allowed) {
      const error = new Error("You are not a member of this room");
      error.statusCode = 403;
      throw error;
    }

    const files = req.files || [];
    if (!files.length) {
      const error = new Error("No files provided (field name: files)");
      error.statusCode = 400;
      throw error;
    }

    const attachments = await Promise.all(files.map((f) => uploadChatAttachment(id, f)));
    res.status(201).json({ success: true, data: { attachments } });
  } catch (error) {
    next(error);
  }
}
