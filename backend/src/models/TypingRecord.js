import mongoose from "mongoose";

const { Schema } = mongoose;

/**
 * One row per USER: their personal best from the 60-second timed typing test.
 * Records only come from timed mode — a fixed duration is what makes WPM
 * numbers comparable (race passages vary in length and difficulty).
 *
 * The global top-10 is `find().sort({ wpm: -1 }).limit(10)` — covered by the
 * wpm index. Best-per-user (not per-run) keeps one grinder from filling all
 * ten slots with near-identical runs.
 */
const typingRecordSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    name: { type: String, required: true }, // denormalized for cheap leaderboards
    wpm: { type: Number, required: true, index: true },
    accuracy: { type: Number, default: 100 }, // percent
    achievedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

/**
 * Record `wpm` for a user if it beats their existing best.
 * Returns true when a new personal best was stored.
 */
typingRecordSchema.statics.submit = async function submit({ userId, name, wpm, accuracy }) {
  const res = await this.findOneAndUpdate(
    { user: userId, wpm: { $lt: wpm } },
    { $set: { name, wpm, accuracy, achievedAt: new Date() } },
    { new: true }
  );
  if (res) return true;
  // No row beaten — either no row exists (insert) or the old best stands.
  try {
    await this.create({ user: userId, name, wpm, accuracy });
    return true;
  } catch (err) {
    if (err.code === 11000) return false; // existing best is higher
    throw err;
  }
};

typingRecordSchema.statics.topTen = function topTen() {
  return this.find().sort({ wpm: -1, achievedAt: 1 }).limit(10)
    .select("name wpm accuracy achievedAt user").lean();
};

export const TypingRecord = mongoose.model("TypingRecord", typingRecordSchema);
