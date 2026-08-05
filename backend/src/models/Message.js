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
    room: {
      type: Schema.Types.ObjectId,
      ref: "Room",
      required: true,
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
  },
  { timestamps: true }
);

messageSchema.pre("validate", function ensureContent(next) {
  if (!this.text && !(this.attachments?.length > 0)) {
    return next(new Error("A message needs text or an attachment"));
  }
  next();
});

// History is always "latest N in THIS room" — a compound index on
// (room, createdAt desc) makes that query hit the index instead of scanning.
messageSchema.index({ room: 1, createdAt: -1 });

export const Message = mongoose.model("Message", messageSchema);
