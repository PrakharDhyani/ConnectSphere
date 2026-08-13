import mongoose from "mongoose";

const { Schema } = mongoose;

/**
 * One attachment on a message: an uploaded file (image/video/audio/doc) living
 * in object storage, an animated sticker (a registry key — the art is vector
 * code on the client, so nothing is stored), or a GIF (a remote URL from the
 * GIF search provider; we never re-host someone else's CDN content).
 */
const attachmentSchema = new Schema(
  {
    kind: {
      type: String,
      enum: ["image", "video", "audio", "file", "gif", "sticker"],
      required: true,
    },
    url: { type: String, maxlength: 2000 },   // storage/CDN url (not for stickers)
    name: { type: String, maxlength: 300 },   // original filename, for "file"
    mime: { type: String, maxlength: 150 },
    size: { type: Number, min: 0 },           // bytes
    width: { type: Number, min: 0 },          // gifs: intrinsic size for layout
    height: { type: Number, min: 0 },
    stickerId: { type: String, maxlength: 40 }, // key into the client sticker registry
    gifId: { type: String, maxlength: 40 },     // key into the built-in reaction registry (no url)

    // Voice notes: `kind: "audio"` plus these. The waveform is captured while
    // recording and carried in the document so a bubble can draw the real
    // shape without downloading and decoding the audio first.
    // An uploaded image that is a custom STICKER, not a photo — rendered
    // small and transparent-background rather than in the photo grid.
    isSticker: { type: Boolean },

    voice: { type: Boolean },                   // true = recorded here, not an uploaded file
    durationMs: { type: Number, min: 0 },
    waveform: {
      type: [Number],
      default: undefined,
      validate: {
        validator: (w) => !w || w.length <= 64,
        message: "Waveform too long",
      },
    },

    // View-once ("permanent: false"): the media may be opened once per viewer,
    // then the server stops serving its url. Enforced server-side — a flag the
    // client could ignore would be theatre, not a feature.
    viewOnce: { type: Boolean },
    // Who has already opened it. Kept on the attachment so a multi-photo
    // message tracks each item separately.
    viewedBy: {
      type: [{ type: Schema.Types.ObjectId, ref: "User" }],
      default: undefined,
    },
  },
  { _id: false }
);

/**
 * A chat message inside a room. Kept deliberately small — the real-time
 * delivery happens over Socket.io; Mongo is the durable history so a user who
 * joins later (or reloads) can scroll back.
 *
 * `text` is optional now: a message may be attachment-only (a photo, a GIF, a
 * sticker). A pre-validate hook enforces "at least one of text/attachments"
 * so an entirely empty message can never be stored.
 */
const messageSchema = new Schema(
  {
    /**
     * A message has exactly ONE parent: a room, or a 1:1 conversation.
     *
     * `room` was `required: true` until DMs landed. Making it optional is the
     * only schema change DMs needed — everything else about a message (text,
     * attachments, voice notes, edits, tombstones, forwarding) is identical
     * whether it was sent to nine people or one, and duplicating all of it into
     * a parallel DirectMessage collection would have meant maintaining every
     * future chat feature twice.
     *
     * The XOR is enforced in a pre-validate hook below, because "optional" on
     * both fields would otherwise permit a parentless message — a row nothing
     * can ever query and nobody can ever see or delete.
     */
    room: {
      type: Schema.Types.ObjectId,
      ref: "Room",
    },
    conversation: {
      type: Schema.Types.ObjectId,
      ref: "Conversation",
    },
    sender: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    text: {
      type: String,
      default: "",
      trim: true,
      maxlength: 2000,
    },
    attachments: {
      type: [attachmentSchema],
      default: undefined, // keep plain text messages free of an empty array
      validate: {
        validator: (a) => !a || a.length <= 10,
        message: "Too many attachments (max 10)",
      },
    },

    // ── Message actions ────────────────────────────────────────────────────
    // Edited text keeps the original id/timestamp so replies and pins survive.
    editedAt: { type: Date },

    // Pinned messages surface in a room-wide bar. Who pinned it is kept so the
    // UI can say "pinned by X" and so an unpin can be attributed.
    pinnedAt: { type: Date },
    pinnedBy: { type: Schema.Types.ObjectId, ref: "User" },

    // "Delete for everyone" is a TOMBSTONE, not a document removal: the row
    // stays so the conversation keeps its shape (and so a deleted message
    // can't be silently re-inserted), but text/attachments are wiped.
    deletedAt: { type: Date },
    deletedBy: { type: Schema.Types.ObjectId, ref: "User" },

    // "Delete for me" is per-user and never affects anyone else's view.
    hiddenFor: {
      type: [{ type: Schema.Types.ObjectId, ref: "User" }],
      default: undefined,
    },

    // Forwarding keeps a breadcrumb so a screenshot-worthy message can't be
    // laundered into looking original.
    forwardedFrom: {
      roomId: { type: Schema.Types.ObjectId, ref: "Room" },
      roomName: { type: String, maxlength: 100 },
      senderName: { type: String, maxlength: 100 },
    },
  },
  { timestamps: true }
);

/**
 * Exactly one parent: a room, or a conversation. Never both, never neither.
 *
 * "Neither" would be a message no query can reach — invisible, undeletable
 * garbage. "Both" is worse than useless: it is ambiguous, and the two readers
 * (room history and DM history) would each show a message the other thought it
 * owned, with a delete from one side leaving the other intact.
 */
messageSchema.pre("validate", function ensureOneParent(next) {
  const hasRoom = Boolean(this.room);
  const hasConversation = Boolean(this.conversation);
  if (hasRoom === hasConversation) {
    return next(new Error("A message must belong to exactly one of room or conversation"));
  }
  next();
});

messageSchema.pre("validate", function ensureContent(next) {
  // A tombstone legitimately has neither text nor attachments.
  if (this.deletedAt) return next();
  if (!this.text && !(this.attachments?.length > 0)) {
    return next(new Error("A message needs text or an attachment"));
  }
  next();
});

// The pinned-messages bar queries "pinned in THIS room, newest first".
// Sparse: the vast majority of messages are never pinned.
messageSchema.index({ room: 1, pinnedAt: -1 }, { sparse: true });

// History is always "latest N in THIS room" — a compound index on
// (room, createdAt desc) makes that query hit the index instead of scanning.
messageSchema.index({ room: 1, createdAt: -1 });

// The same query for the other kind of parent. Sparse on both sides: a message
// has exactly one parent, so each index only ever covers half the collection.
messageSchema.index({ conversation: 1, createdAt: -1 }, { sparse: true });

export const Message = mongoose.model("Message", messageSchema);
