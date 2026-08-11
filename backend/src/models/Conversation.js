import mongoose from "mongoose";

const { Schema } = mongoose;

/**
 * A 1:1 direct-message conversation between exactly two users.
 *
 * WHY NOT A HIDDEN ROOM
 * A DM is *almost* a two-person room, and reusing `Room` would have inherited
 * chat, attachments, voice notes and moderation for free. It was rejected
 * because the inheritance runs the wrong way: a Room carries an owner, a join
 * code, visibility, activities, bans, a waiting room and a member list that can
 * grow — and every one of those is either meaningless or actively wrong for a
 * DM. "Who owns this conversation?" and "who may I kick?" have no answer
 * between two people. Worse, `listMyRooms()` is `Room.find({members: userId})`,
 * so every DM would appear in the dashboard's room list until something
 * remembered to filter it out — a leak that fails OPEN and would look exactly
 * like a room the user forgot they were in.
 *
 * So: a small, purpose-built collection. The cost is that `Message` had to
 * learn a second kind of parent; that change is contained in one pre-validate
 * hook and one index.
 *
 * PAIR UNIQUENESS IS ENFORCED BY THE DATABASE, NOT BY A CHECK
 * Two people can open a DM with each other simultaneously — A clicks "message
 * B" at the same moment B clicks "message A". A find-then-create would race and
 * produce two conversations for one pair, and from then on each person would be
 * typing into a thread the other never sees: the worst kind of bug, because
 * both sides look fine in isolation.
 *
 * `key` is the two user ids sorted and joined, so the pair (A,B) and the pair
 * (B,A) produce the SAME string, and a unique index on it makes a duplicate
 * physically impossible. The open handler upserts on this key rather than
 * checking first — the race resolves in the database, where it can actually be
 * resolved.
 */
export function conversationKey(a, b) {
  return [String(a), String(b)].sort().join("_");
}

const conversationSchema = new Schema(
  {
    /** Exactly two, and the model refuses anything else (see the hook below). */
    participants: {
      type: [{ type: Schema.Types.ObjectId, ref: "User", required: true }],
      required: true,
      index: true,
    },

    /** `sorted(idA, idB).join("_")` — see the header. */
    key: { type: String, required: true, unique: true },

    /**
     * Denormalised preview of the newest message.
     *
     * The conversation LIST needs "who, what, when" for every thread, and
     * doing that with one Message query per conversation is the N+1 that makes
     * an inbox slow at exactly the moment it becomes useful (lots of threads).
     * Kept deliberately tiny — a preview, not a copy — and rewritten on every
     * send, edit and delete so it cannot drift into showing text that has since
     * been removed.
     */
    lastMessage: {
      text: { type: String, maxlength: 200 },
      sender: { type: Schema.Types.ObjectId, ref: "User" },
      at: { type: Date },
      /** Set when the newest message is attachment-only, so the list can say "📷 Photo". */
      kind: { type: String, maxlength: 20 },
    },

    /**
     * Per-participant read state: userId -> the time they last opened this
     * thread. Unread counts are "messages newer than this, not sent by me".
     *
     * A Map rather than a subdocument array because the only access pattern is
     * "mine", and a Map makes that a key lookup instead of a scan. Two entries
     * maximum, so the storage argument is irrelevant — the readability one is
     * not.
     */
    lastReadAt: {
      type: Map,
      of: Date,
      default: () => new Map(),
    },

    /**
     * Per-participant soft delete: userId -> when they cleared the thread.
     *
     * "Delete conversation" must not destroy the other person's copy — that
     * would let either side unilaterally erase a shared history. Instead it
     * hides everything up to that moment for that user only; the thread
     * reappears if the other person writes again, which is what every
     * messenger does and what people expect.
     */
    clearedAt: {
      type: Map,
      of: Date,
      default: () => new Map(),
    },
  },
  { timestamps: true }
);

/**
 * Exactly two DISTINCT participants.
 *
 * Guarded in the model rather than only in the controller because this is the
 * invariant the whole design rests on: `key` is built from two ids, so a
 * one-participant or three-participant document would produce a key that lies
 * about who the conversation is between.
 */
conversationSchema.pre("validate", function ensurePair(next) {
  const ids = (this.participants || []).map(String);
  if (ids.length !== 2) return next(new Error("A conversation needs exactly two participants"));
  if (ids[0] === ids[1]) return next(new Error("Cannot open a conversation with yourself"));
  if (this.key !== conversationKey(ids[0], ids[1])) {
    return next(new Error("Conversation key does not match its participants"));
  }
  next();
});

/** The inbox query: my threads, most recently active first. */
conversationSchema.index({ participants: 1, "lastMessage.at": -1 });

export const Conversation = mongoose.model("Conversation", conversationSchema);
