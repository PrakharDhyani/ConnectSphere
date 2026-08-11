/**
 * Conversation rules shared by the REST controller and the socket handlers.
 *
 * WHY A SERVICE AND NOT JUST THE CONTROLLER
 * The socket handlers need `canMessage` and `loadConversation`, and importing
 * them from `conversation.controller.js` would close a cycle:
 *
 *   sockets/index.js → dm.handlers.js → conversation.controller.js → sockets/index.js
 *                                                    (for `io`)
 *
 * ESM tolerates that cycle, which is exactly what makes it dangerous — nothing
 * crashes, but `io` is read while `sockets/index.js` is still initialising and
 * lands as `undefined`. The failure surfaces much later as "DM notifications
 * silently do not send", with a stack trace pointing nowhere near the import
 * graph. Putting the shared rules in a leaf module that imports no sockets
 * removes the cycle rather than tiptoeing around it.
 */
import mongoose from "mongoose";
import { Conversation } from "../models/Conversation.js";
import { Friendship } from "../models/Friendship.js";

export const notFoundError = () => {
  const error = new Error("Conversation not found");
  error.statusCode = 404;
  return error;
};

export const forbiddenError = (message = "Not allowed") => {
  const error = new Error(message);
  error.statusCode = 403;
  return error;
};

/**
 * Are these two allowed to message each other?
 *
 * FRIENDSHIP IS THE GATE, and it is re-checked on every send rather than only
 * when the thread is opened. Checking once at open would leave a conversation
 * writable forever, so "unfriend" would remove someone from your list while
 * their messages kept arriving — an unread badge from a person you just removed
 * is precisely what removing them was meant to stop.
 *
 * A `blocked` friendship is not `accepted`, so this one check enforces both
 * rules and they cannot drift apart.
 */
export async function canMessage(userA, userB) {
  if (!userB) return false;
  const link = await Friendship.findOne({
    $or: [
      { requester: userA, recipient: userB },
      { requester: userB, recipient: userA },
    ],
  }).lean();
  return Boolean(link && link.status === "accepted");
}

/** The other participant's id, as a string. */
export const otherOf = (conversation, userId) =>
  conversation.participants.map(String).find((p) => p !== String(userId));

/**
 * Load a conversation and assert the caller is a participant.
 *
 * Participation is checked against the stored document, never against a client
 * claim: the id in the URL says WHICH thread, not who may read it.
 *
 * Throws 404 rather than 403 for a thread you are not in — confirming that a
 * particular conversation exists would leak that two specific people are
 * talking to each other.
 */
export async function loadConversation(conversationId, userId) {
  if (!mongoose.isValidObjectId(conversationId)) throw notFoundError();
  const conversation = await Conversation.findById(conversationId);
  if (!conversation) throw notFoundError();
  if (!conversation.participants.some((p) => String(p) === String(userId))) throw notFoundError();
  return conversation;
}

/** Mongo returns a Map field from `.lean()` as a plain object. */
export const asMap = (v) => (v instanceof Map ? v : new Map(Object.entries(v || {})));
