import mongoose from "mongoose";
import { Conversation, conversationKey } from "../models/Conversation.js";
import { Message } from "../models/Message.js";
import { User } from "../models/User.js";
import { redactForViewer } from "../sockets/chat.handlers.js";
import { io } from "../sockets/index.js";
import { storageEnabled, uploadChatAttachment } from "../services/storage.service.js";
import {
  canMessage,
  loadConversation,
  otherOf,
  asMap,
  notFoundError as notFound,
  forbiddenError as forbidden,
} from "../services/conversation.service.js";

/**
 * POST /api/conversations  { userId }
 *
 * Open (or reopen) the DM with one friend. Idempotent by design — "message
 * Alice" from three different places in the UI must land in the same thread.
 */
export async function openConversation(req, res, next) {
  try {
    const me = req.user.id;
    const { userId } = req.body;

    if (!mongoose.isValidObjectId(userId)) throw notFound();
    if (String(userId) === String(me)) throw forbidden("You cannot message yourself");

    const other = await User.findById(userId).select("name avatarUrl isGuest").lean();
    if (!other) throw notFound();
    // A guest is ephemeral and scoped to one room; a DM would outlive them.
    if (other.isGuest) throw forbidden("You can only message registered users");
    if (!(await canMessage(me, userId))) throw forbidden("You can only message friends");

    /**
     * UPSERT, not find-then-create.
     *
     * Two people can press "message" on each other at the same moment. A
     * find-then-create would race and produce two threads for one pair, after
     * which each person types into a thread the other never sees — and both
     * sides look correct in isolation, which is what makes it so hard to spot.
     * The unique index on `key` makes that outcome impossible; upsert lets the
     * database settle the race instead of the application pretending it cannot
     * happen.
     */
    const key = conversationKey(me, userId);
    const conversation = await Conversation.findOneAndUpdate(
      { key },
      { $setOnInsert: { key, participants: [me, userId] } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    res.status(201).json({
      success: true,
      data: { conversation: shapeConversation(conversation, me, other) },
    });
  } catch (error) {
    // A duplicate-key error here means the race above resolved in the other
    // request's favour — which is success, not failure. Return the winner.
    if (error?.code === 11000) {
      try {
        const conversation = await Conversation.findOne({
          key: conversationKey(req.user.id, req.body.userId),
        });
        const other = await User.findById(req.body.userId).select("name avatarUrl").lean();
        return res.status(200).json({
          success: true,
          data: { conversation: shapeConversation(conversation, req.user.id, other) },
        });
      } catch {
        /* fall through to the error handler */
      }
    }
    next(error);
  }
}

/** The wire shape of one conversation, from `me`'s point of view. */
function shapeConversation(conversation, me, otherUser, unread = 0) {
  const cleared = conversation.clearedAt?.get?.(String(me)) || null;
  const last = conversation.lastMessage;
  // A thread cleared AFTER its newest message shows no preview — the user asked
  // for it to be empty, and showing the last line back would ignore that.
  const showLast = last?.at && (!cleared || last.at > cleared);
  return {
    id: conversation._id,
    user: otherUser
      ? { id: otherUser._id || otherUser.id, name: otherUser.name, avatarUrl: otherUser.avatarUrl }
      : null,
    lastMessage: showLast
      ? { text: last.text, kind: last.kind, at: last.at, mine: String(last.sender) === String(me) }
      : null,
    unread,
    updatedAt: conversation.updatedAt,
  };
}

/**
 * GET /api/conversations
 *
 * The inbox: every thread I am in, most recently active first, each with its
 * preview and my unread count.
 */
export async function listConversations(req, res, next) {
  try {
    const me = req.user.id;
    const conversations = await Conversation.find({ participants: me })
      .sort({ "lastMessage.at": -1, updatedAt: -1 })
      .limit(100)
      .lean();

    if (!conversations.length) return res.json({ success: true, data: { conversations: [] } });

    // One query for every counterpart, rather than one per thread.
    const otherIds = conversations.map((c) => otherOf(c, me)).filter(Boolean);
    const users = await User.find({ _id: { $in: otherIds } }).select("name avatarUrl").lean();
    const byId = new Map(users.map((u) => [String(u._id), u]));

    /**
     * Unread counts in ONE aggregate rather than N countDocuments calls.
     *
     * This is the query that decides whether an inbox stays fast once someone
     * actually uses it: the per-thread version is the classic N+1 that only
     * hurts the users who have the most threads.
     */
    const unreadByConversation = await unreadCounts(conversations, me);

    const shaped = conversations.map((c) =>
      shapeConversation(
        // `.lean()` gives plain objects, so the Map accessors used by
        // shapeConversation are not available — normalise them here.
        { ...c, clearedAt: asMap(c.clearedAt) },
        me,
        byId.get(otherOf(c, me)),
        unreadByConversation.get(String(c._id)) || 0
      )
    );

    res.json({ success: true, data: { conversations: shaped } });
  } catch (error) {
    next(error);
  }
}

/**
 * Unread per conversation for one user, in a single aggregate.
 *
 * "Unread" = newer than my `lastReadAt` for that thread, not sent by me, and
 * not hidden from me. The read cutoffs differ per conversation, so they are
 * folded into one `$or` rather than looped.
 */
async function unreadCounts(conversations, me) {
  const clauses = conversations.map((c) => {
    const readAt = asMap(c.lastReadAt).get(String(me));
    const clause = { conversation: c._id };
    // A cleared thread also hides everything before the clear.
    const clearedAt = asMap(c.clearedAt).get(String(me));
    const floor = [readAt, clearedAt].filter(Boolean).sort((a, b) => b - a)[0];
    if (floor) clause.createdAt = { $gt: floor };
    return clause;
  });

  const rows = await Message.aggregate([
    {
      $match: {
        $or: clauses,
        sender: { $ne: new mongoose.Types.ObjectId(me) },
        deletedAt: { $exists: false },
        hiddenFor: { $ne: new mongoose.Types.ObjectId(me) },
      },
    },
    { $group: { _id: "$conversation", n: { $sum: 1 } } },
  ]);

  return new Map(rows.map((r) => [String(r._id), r.n]));
}

/**
 * GET /api/conversations/:id/messages?before=<ISO>&limit=30
 *
 * Same keyset pagination as room history, and deliberately the same response
 * shape — the client renders a DM with the identical message component.
 */
export async function getConversationMessages(req, res, next) {
  try {
    const me = req.user.id;
    const conversation = await loadConversation(req.params.id, me);

    const limit = Math.min(parseInt(req.query.limit, 10) || 30, 100);
    const filter = {
      conversation: conversation._id,
      hiddenFor: { $ne: me },
    };

    // "Clear conversation" is per-user: everything up to that moment is gone
    // for me and untouched for them.
    const clearedAt = conversation.clearedAt?.get(String(me));
    if (clearedAt) filter.createdAt = { $gt: clearedAt };

    if (req.query.before) {
      const before = new Date(req.query.before);
      if (!Number.isNaN(before.getTime())) {
        filter.createdAt = { ...(filter.createdAt || {}), $lt: before };
      }
    }

    const docs = await Message.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate("sender", "name avatarUrl")
      .lean();

    const messages = docs.reverse().map((d) => ({
      id: d._id,
      conversationId: String(conversation._id),
      text: d.text,
      attachments: d.deletedAt ? [] : redactForViewer(d, me),
      createdAt: d.createdAt,
      editedAt: d.editedAt,
      deletedAt: d.deletedAt,
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
 * POST /api/conversations/:id/read
 *
 * Marks the thread read up to now. Separate from fetching history because
 * opening a thread and *reading* it are different events — the client decides
 * when the messages were actually seen.
 */
export async function markConversationRead(req, res, next) {
  try {
    const me = req.user.id;
    const conversation = await loadConversation(req.params.id, me);
    conversation.lastReadAt.set(String(me), new Date());
    await conversation.save();

    // Tell my own other tabs, so a badge cleared on the phone clears on the
    // laptop too. `io` is undefined under some tests — hence the guard.
    io?.to(`user:${me}`).emit("dm:read", { conversationId: String(conversation._id) });
    res.json({ success: true, data: { conversationId: String(conversation._id) } });
  } catch (error) {
    next(error);
  }
}

/**
 * DELETE /api/conversations/:id
 *
 * Clears the thread FOR ME ONLY. Never destroys the other person's copy —
 * either side being able to erase a shared history unilaterally is a footgun,
 * not a feature. The thread reappears if they write again, which is what every
 * messenger does and what people expect.
 */
export async function clearConversation(req, res, next) {
  try {
    const me = req.user.id;
    const conversation = await loadConversation(req.params.id, me);
    conversation.clearedAt.set(String(me), new Date());
    await conversation.save();
    res.json({ success: true, data: { conversationId: String(conversation._id) } });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/conversations/:id/attachments  (multipart, "files", up to 10)
 *
 * Uploads only — it does not create a message, exactly like the room
 * equivalent. The client uploads, then sends one message carrying the results,
 * so a half-finished upload never leaves a broken bubble in the history.
 */
export async function uploadConversationAttachments(req, res, next) {
  try {
    const me = req.user.id;
    const conversation = await loadConversation(req.params.id, me);
    // Re-check on upload, not just on open: an unfriended person must not be
    // able to keep pushing files into a thread they can no longer write to.
    if (!(await canMessage(me, otherOf(conversation, me)))) {
      throw forbidden("You can only message friends");
    }

    if (!storageEnabled()) {
      const error = new Error("File uploads are not configured on this server");
      error.statusCode = 503;
      throw error;
    }
    const files = req.files || [];
    if (!files.length) {
      const error = new Error("No files uploaded");
      error.statusCode = 400;
      throw error;
    }

    const attachments = await Promise.all(
      files.map((f) => uploadChatAttachment(`dm/${conversation._id}`, f))
    );
    res.status(201).json({ success: true, data: { attachments } });
  } catch (error) {
    next(error);
  }
}
