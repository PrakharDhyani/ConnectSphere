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
    // Shadow of `name` lowercased, unique-indexed. This is how "no duplicate
    // room names" survives a race: two simultaneous creates both pass any
    // find() pre-check, but only one can win the index. (A collated unique
    // index on `name` would also work, but an explicit field is easier to
    // reason about and query.)
    nameLower: {
      type: String,
      unique: true,
      // sparse: legacy rooms created before this field exist without it —
      // a non-sparse unique index would refuse to build over N missing values.
      sparse: true,
      index: true,
    },
    // public rooms are discoverable and joinable without an invite code;
    // private rooms are invite-code only (the original behavior).
    visibility: {
      type: String,
      enum: ["public", "private"],
      default: "private",
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
  // Keep the uniqueness shadow in lockstep with the display name (covers
  // renames too, not just creation).
  if (this.isModified("name")) this.nameLower = this.name.toLowerCase();
  next();
});

export const Room = mongoose.model("Room", roomSchema);
