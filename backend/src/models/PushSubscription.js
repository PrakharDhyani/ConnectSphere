import mongoose from "mongoose";

const { Schema } = mongoose;

/**
 * One Web Push subscription per browser profile a user enabled notifications
 * in (phone + laptop = two rows). The `endpoint` is the push service URL the
 * browser minted — globally unique, so it's the natural key: re-subscribing
 * from the same browser upserts rather than duplicating, and a 404/410 from
 * the push service means the browser revoked it → we delete the row.
 */
const pushSubscriptionSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    endpoint: { type: String, required: true, unique: true },
    keys: {
      p256dh: { type: String, required: true },
      auth: { type: String, required: true },
    },
    userAgent: { type: String, default: "" },
  },
  { timestamps: true }
);

export const PushSubscription = mongoose.model("PushSubscription", pushSubscriptionSchema);
