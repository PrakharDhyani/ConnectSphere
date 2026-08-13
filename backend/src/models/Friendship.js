import mongoose from "mongoose";

const { Schema } = mongoose;

/**
 * One document per friendship (or pending request) between two users.
 * `requester` sent it, `recipient` received it. status goes pending → accepted.
 *
 * We store a single directed row and always look "either direction" when asking
 * "are A and B friends?" — the unique (requester, recipient) index stops the
 * same person sending two requests, and the controller checks the reverse
 * direction before creating one so A→B and B→A can't both exist.
 */
const friendshipSchema = new Schema(
  {
    requester: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    recipient: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    /**
     * `blocked` is a THIRD state on the same row, not a separate collection.
     *
     * The alternative — a `Block` collection — would mean two sources of truth
     * for "may these two interact?", and every check would have to consult both
     * and agree. Here the one row is the answer: a blocked pair is not
     * `accepted`, so every existing friendship check refuses them for free,
     * including the DM gate.
     *
     * It also gives blocking the property that matters most: it SURVIVES. An
     * unfriend deletes the row, so the other person can immediately re-request.
     * A block keeps the row, so they cannot — and because the row is unique per
     * pair, they cannot create a fresh one either.
     */
    status: {
      type: String,
      enum: ["pending", "accepted", "blocked"],
      default: "pending",
      index: true,
    },
    /**
     * Who pressed block. Required to make it one-directional: the blocker can
     * lift it, the blocked person cannot, and neither can silently become the
     * other's friend again. Without this, `status: "blocked"` on a symmetric
     * row would not say whose decision it was.
     */
    blockedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

/**
 * A blocked row must record who blocked, and only a blocked row may.
 *
 * Enforced in the model because this is the field the "can they interact?"
 * checks read; a blocked row without a blocker would be an unliftable block,
 * and a `blockedBy` on an accepted row would be a friendship that some code
 * paths read as hostile.
 */
friendshipSchema.pre("validate", function ensureBlockAttribution(next) {
  if (this.status === "blocked" && !this.blockedBy) {
    return next(new Error("A blocked friendship must record who blocked"));
  }
  if (this.status !== "blocked" && this.blockedBy) {
    return next(new Error("Only a blocked friendship may record a blocker"));
  }
  next();
});

friendshipSchema.index({ requester: 1, recipient: 1 }, { unique: true });

export const Friendship = mongoose.model("Friendship", friendshipSchema);
