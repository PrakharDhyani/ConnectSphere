import mongoose from "mongoose";
import { Room } from "../models/Room.js";
import { Message } from "../models/Message.js";
import { isScopedGuest } from "../utils/roomAccess.js";
import { storageEnabled, uploadChatAttachment } from "../services/storage.service.js";
import { redactForViewer } from "../sockets/chat.handlers.js";

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
      // View-once media is stripped per viewer — a spent link must never come
      // back out of the history endpoint.
      attachments: redactForViewer(d, req.user.id),
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

/**
 * POST /api/rooms/:id/messages/:messageId/view  { index }
 *
 * Open a view-once attachment. Returns its url exactly ONCE per viewer, then
 * records the view so every later read (history, or a second call) is
 * redacted. The enforcement has to live here rather than in the client,
 * otherwise "view once" is just a suggestion.
 *
 * The sender is exempt from consuming their own media — checking what you
 * sent should not burn the recipient's view — but they still cannot re-open
 * it after someone else has.
 */
export async function viewOnceAttachment(req, res, next) {
  try {
    const { id, messageId } = req.params;
    if (!mongoose.isValidObjectId(id) || !mongoose.isValidObjectId(messageId)) throw notFound();

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

    const index = Number(req.body?.index ?? 0);
    const message = await Message.findOne({ _id: messageId, room: id });
    if (!message) throw notFound();

    const attachment = message.attachments?.[index];
    if (!attachment || !attachment.viewOnce) {
      const error = new Error("That attachment is not view-once");
      error.statusCode = 400;
      throw error;
    }

    const viewed = (attachment.viewedBy || []).map(String);
    const isSender = message.sender.toString() === req.user.id;

    if (isSender ? viewed.length > 0 : viewed.includes(req.user.id)) {
      const error = new Error("This media has already been opened");
      error.statusCode = 410; // Gone — the resource is deliberately unavailable
      throw error;
    }

    const url = attachment.url;
    // The sender peeking does not consume the recipients' view.
    if (!isSender) {
      // $addToSet keeps this idempotent under a double-tap race.
      await Message.updateOne(
        { _id: messageId },
        { $addToSet: { [`attachments.${index}.viewedBy`]: req.user.id } }
      );
    }

    res.json({
      success: true,
      data: { url, mime: attachment.mime, kind: attachment.kind, name: attachment.name },
    });
  } catch (error) {
    next(error);
  }
}
