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
    status: { type: String, enum: ["pending", "accepted"], default: "pending", index: true },
  },
  { timestamps: true }
);

friendshipSchema.index({ requester: 1, recipient: 1 }, { unique: true });

export const Friendship = mongoose.model("Friendship", friendshipSchema);
