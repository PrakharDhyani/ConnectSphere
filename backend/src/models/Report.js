import mongoose from "mongoose";

const { Schema } = mongoose;

/**
 * A user report — the paper trail moderation needs before public rooms meet
 * real strangers. No admin UI yet; reports are stored and queryable
 * (`db.reports.find()`), which is enough to act on abuse.
 */
const reportSchema = new Schema(
  {
    room: { type: Schema.Types.ObjectId, ref: "Room", required: true, index: true },
    reporter: { type: Schema.Types.ObjectId, ref: "User", required: true },
    reported: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    reportedName: String, // denormalized — reports outlive accounts
    reason: { type: String, trim: true, maxlength: 500, default: "" },
  },
  { timestamps: true }
);

// One report per (reporter → reported) per room per hour keeps spam down;
// checked in the controller via this compound index.
reportSchema.index({ room: 1, reporter: 1, reported: 1, createdAt: -1 });

export const Report = mongoose.model("Report", reportSchema);
