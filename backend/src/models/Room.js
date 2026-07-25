import crypto from "crypto";
import mongoose from "mongoose";

const { Schema } = mongoose;

/**
 * A Room is where calls/collaboration happen. For now it's membership +
 * metadata; the mediasoup video layer attaches to it in Phase 3.
 *
 * `code` is the join secret: a short random string users share ("join my room:
 * a1b2c3"). Random enough not to be guessable by scanning, short enough to
 * read out loud. Unique-indexed so lookups are O(1) and collisions impossible.
 */
const roomSchema = new Schema(
  {
    name: {
      type: String,
      required: [true, "Room name is required"],
      trim: true,
      minlength: 2,
      maxlength: 100,
    },
    code: {
      type: String,
      unique: true,
      index: true,
    },
    owner: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true, // "rooms I own" queries
    },
    members: [
      {
        type: Schema.Types.ObjectId,
        ref: "User",
        index: true, // "rooms I'm in" queries
      },
    ],
  },
  { timestamps: true }
);

// 6 hex chars = 16^6 ≈ 16.7M combinations — plenty for invite codes, and the
// unique index turns the astronomically-rare collision into a retryable error
// rather than a silent bug (the controller retries).
roomSchema.statics.generateCode = function generateCode() {
  return crypto.randomBytes(3).toString("hex");
};

// The owner is always a member — set once at creation.
roomSchema.pre("validate", function ensureOwnerIsMember(next) {
  if (this.isNew) {
    if (!this.code) this.code = this.constructor.generateCode();
    const ownerId = this.owner?.toString();
    if (ownerId && !this.members.some((m) => m.toString() === ownerId)) {
      this.members.push(this.owner);
    }
  }
  next();
});

export const Room = mongoose.model("Room", roomSchema);
