/**
 * Direct messages over sockets — the live half of the DM feature.
 *
 * REST owns opening a thread, history and read state; this file owns delivery:
 * a message must appear on the other person's screen without a refresh, and a
 * typing indicator must not need one either.
 *
 *   dm:send    ({conversationId, text, attachments}) → dm:new to both people
 *   dm:edit    ({messageId, text})                   → dm:edited
 *   dm:delete  ({messageId, scope})                  → dm:deleted
 *   dm:typing  ({conversationId})                    → dm:typing to the other
 *
 * NO SOCKET.IO ROOM PER CONVERSATION.
 * Room chat groups sockets into `room:<id>` because a room has many members who
 * come and go. A DM has exactly two participants and both already sit in their
 * own personal room (`user:<id>`, joined at connect), so delivery is two
 * targeted emits. That avoids a join/leave lifecycle per thread — and, more
 * importantly, it means a DM arrives while the recipient is looking at
 * something else entirely, which is the whole point of an inbox. A per-thread
 * room would only deliver to people who had that thread open.
 *
 * AUTHORISATION IS RE-CHECKED ON EVERY EVENT, never cached from the open. See
 * `canMessage` — unfriending has to actually stop the messages.
 */
import { Message } from "../models/Message.js";
import { canMessage, loadConversation, otherOf } from "../services/conversation.service.js";
import { sanitizeAttachments, redactForViewer } from "./chat.handlers.js";
import { allow } from "../utils/socketRate.js";
import { logger } from "../utils/logger.js";

/** One person's personal room — every socket of theirs, on every device. */
const userKey = (userId) => `user:${userId}`;

/**
 * A one-line preview for the inbox, written on every send.
 *
 * Denormalised deliberately (see the Conversation model): the alternative is a
 * Message query per thread when listing, which is the N+1 that makes an inbox
 * slow exactly when it becomes useful.
 */
function previewOf(text, attachments) {
  if (text) return { text: text.slice(0, 200), kind: null };
  const first = attachments[0];
  if (!first) return { text: "", kind: null };
  const kind = first.voice ? "voice" : first.kind;
  return { text: "", kind };
}

export function registerDmHandlers(io, socket) {
  const me = socket.user.id;

  /**
   * Load a conversation, assert I am in it, and assert I may still write to it.
   * Returns null once it has already answered the ack.
   */
  async function writable(conversationId, ack) {
    let conversation;
    try {
      conversation = await loadConversation(conversationId, me);
    } catch {
      ack?.({ ok: false, error: "Conversation not found" });
      return null;
    }
    if (!(await canMessage(me, otherOf(conversation, me)))) {
      // Deliberately the same wording the REST layer uses, so a client cannot
      // distinguish "unfriended" from "blocked" by the error text.
      ack?.({ ok: false, error: "You can only message friends" });
      return null;
    }
    return conversation;
  }

  socket.on("dm:send", async (payload, ack) => {
    try {
      const text = (payload?.text || "").trim();
      const attachments = sanitizeAttachments(payload?.attachments);
      if (!payload?.conversationId || (!text && attachments.length === 0)) {
        return ack?.({ ok: false, error: "Message cannot be empty" });
      }
      if (text.length > 2000) return ack?.({ ok: false, error: "Message is too long (max 2000)" });
      // Same budget as room chat: friction against flooding, not security.
      if (!allow(socket, "dm", 15, 10_000)) return ack?.({ ok: false, error: "Slow down a moment" });

      const conversation = await writable(payload.conversationId, ack);
      if (!conversation) return;

      const doc = await Message.create({
        conversation: conversation._id,
        sender: me,
        text,
        ...(attachments.length ? { attachments } : {}),
      });

      /**
       * Writing to a thread the other person cleared makes it reappear FOR
       * THEM. That is the behaviour every messenger has: clearing is "I do not
       * want this history", not "never speak to me again" — which is what
       * blocking is for.
       */
      const preview = previewOf(text, attachments);
      conversation.lastMessage = { ...preview, sender: me, at: doc.createdAt };
      // The sender has by definition read their own message.
      conversation.lastReadAt.set(String(me), doc.createdAt);
      await conversation.save();

      const message = {
        id: doc._id.toString(),
        conversationId: String(conversation._id),
        text: doc.text,
        attachments: doc.attachments || [],
        createdAt: doc.createdAt,
        sender: { id: me, name: socket.user.name, avatarUrl: socket.user.avatarUrl },
      };

      /**
       * View-once media never rides the broadcast — the recipient fetches it
       * through the view endpoint, which is what actually spends the view.
       * Same rule as room chat; a url in the payload could be cached forever.
       */
      const hasViewOnce = (doc.attachments || []).some((a) => a.viewOnce);
      const forRecipient = hasViewOnce
        ? { ...message, attachments: redactForViewer(doc, otherOf(conversation, me)) }
        : message;

      io.to(userKey(otherOf(conversation, me))).emit("dm:new", forRecipient);
      // ...and to my OTHER devices, so a message sent on the phone appears on
      // the laptop. Not to this socket: it already has it from the ack.
      socket.to(userKey(me)).emit("dm:new", message);
      ack?.({ ok: true, message });
    } catch (err) {
      logger.error("dm:send failed:", err);
      ack?.({ ok: false, error: "Could not send message" });
    }
  });

  socket.on("dm:edit", async (payload, ack) => {
    try {
      const text = (payload?.text || "").trim();
      if (!text) return ack?.({ ok: false, error: "Message cannot be empty" });
      if (text.length > 2000) return ack?.({ ok: false, error: "Message is too long (max 2000)" });

      const doc = await Message.findById(payload?.messageId);
      // Only the author edits, and never a tombstone — editing a deleted
      // message would resurrect text the sender already withdrew.
      if (!doc || !doc.conversation || String(doc.sender) !== String(me) || doc.deletedAt) {
        return ack?.({ ok: false, error: "Not allowed" });
      }
      const conversation = await writable(String(doc.conversation), ack);
      if (!conversation) return;

      doc.text = text;
      doc.editedAt = new Date();
      await doc.save();

      // Keep the inbox preview honest: it must never show text that has since
      // been changed.
      if (String(conversation.lastMessage?.sender) === String(me) &&
          conversation.lastMessage?.at?.getTime() === doc.createdAt.getTime()) {
        conversation.lastMessage.text = text.slice(0, 200);
        await conversation.save();
      }

      const update = {
        id: String(doc._id),
        conversationId: String(doc.conversation),
        text: doc.text,
        editedAt: doc.editedAt,
      };
      io.to(userKey(otherOf(conversation, me))).emit("dm:edited", update);
      io.to(userKey(me)).emit("dm:edited", update);
      ack?.({ ok: true });
    } catch (err) {
      logger.error("dm:edit failed:", err);
      ack?.({ ok: false, error: "Could not edit message" });
    }
  });

  socket.on("dm:delete", async (payload, ack) => {
    try {
      const scope = payload?.scope === "everyone" ? "everyone" : "me";
      const doc = await Message.findById(payload?.messageId);
      if (!doc || !doc.conversation) return ack?.({ ok: false, error: "Not allowed" });

      let conversation;
      try {
        conversation = await loadConversation(String(doc.conversation), me);
      } catch {
        return ack?.({ ok: false, error: "Not allowed" });
      }

      if (scope === "me") {
        /**
         * "Delete for me" stays available even to someone who can no longer
         * write here — hiding a message from your own view is not messaging,
         * and an unfriended person must still be able to tidy their history.
         */
        if (!(doc.hiddenFor || []).some((u) => String(u) === String(me))) {
          doc.hiddenFor = [...(doc.hiddenFor || []), me];
          await doc.save();
        }
        io.to(userKey(me)).emit("dm:deleted", {
          id: String(doc._id),
          conversationId: String(doc.conversation),
          scope: "me",
        });
        return ack?.({ ok: true });
      }

      // "Delete for everyone" is the AUTHOR's right only. A room has an owner
      // who can moderate; a DM has no such authority — neither participant
      // outranks the other, so nobody may withdraw the other's words.
      if (String(doc.sender) !== String(me)) {
        return ack?.({ ok: false, error: "You can only delete your own messages" });
      }

      // A tombstone, not a removal: the row stays so the conversation keeps its
      // shape and a deleted message cannot be silently re-inserted.
      doc.deletedAt = new Date();
      doc.deletedBy = me;
      doc.text = "";
      doc.attachments = undefined;
      await doc.save();

      if (conversation.lastMessage?.at?.getTime() === doc.createdAt.getTime()) {
        conversation.lastMessage = { text: "", kind: "deleted", sender: me, at: doc.createdAt };
        await conversation.save();
      }

      const update = {
        id: String(doc._id),
        conversationId: String(doc.conversation),
        scope: "everyone",
        deletedAt: doc.deletedAt,
      };
      io.to(userKey(otherOf(conversation, me))).emit("dm:deleted", update);
      io.to(userKey(me)).emit("dm:deleted", update);
      ack?.({ ok: true });
    } catch (err) {
      logger.error("dm:delete failed:", err);
      ack?.({ ok: false, error: "Could not delete message" });
    }
  });

  /**
   * Typing indicator — transient, never stored.
   *
   * Rate limited but otherwise cheap, and it deliberately does NOT re-check
   * friendship: the cost of a stray "typing…" is a flicker, and the check is a
   * database round trip on an event that fires every few keystrokes. Delivery
   * is still limited to the one person in the thread.
   */
  socket.on("dm:typing", async (payload) => {
    try {
      if (!allow(socket, "dmTyping", 10, 5000)) return;
      const conversation = await loadConversation(payload?.conversationId, me).catch(() => null);
      if (!conversation) return;
      io.to(userKey(otherOf(conversation, me))).emit("dm:typing", {
        conversationId: String(conversation._id),
        user: { id: me, name: socket.user.name },
      });
    } catch {
      /* a typing indicator must never surface an error */
    }
  });
}
