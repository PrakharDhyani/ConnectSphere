import mongoose from "mongoose";

const { Schema } = mongoose;

/**
 * Generic persisted state for one activity plugin in one room.
 *
 * WHY GENERIC: today every persistent activity would need its own collection
 * and model (Whiteboard already has one). That means adding a plugin requires
 * adding a model — exactly the "adding a plugin edits existing files" coupling
 * the plugin system exists to remove. One collection keyed by
 * (room, activity) means a new plugin gets persistence with no schema work.
 *
 * `data` is Mixed and opaque to us, the same call Whiteboard.elements already
 * makes: the plugin owns its own shape, and the platform must not need to know
 * it. The cost is no schema validation on plugin state — acceptable, because
 * the plugin is the only reader and writer.
 *
 * NOTE: the existing `whiteboards` collection is deliberately NOT migrated.
 * The whiteboard plugin keeps reading and writing its own model so the
 * migration stays behaviour-preserving and reversible; moving that data is a
 * separate, later decision.
 */
const activityStateSchema = new Schema(
  {
    room: {
      type: Schema.Types.ObjectId,
      ref: "Room",
      required: true,
      index: true,
    },
    // Manifest id (e.g. "ludo"). A plain string, not an enum: an unknown id
    // must degrade to an "unavailable" placeholder, never make the document
    // unreadable — a room can outlive a plugin, or reference one this build
    // does not ship.
    activity: {
      type: String,
      required: true,
    },
    data: {
      type: Schema.Types.Mixed,
      default: null,
    },
  },
  // minimize: false — an empty object is a meaningful state ("initialised, no
  // content"), and Mongoose would otherwise strip it and make it look unset.
  { timestamps: true, minimize: false }
);

// One state document per (room, activity). Unique so a concurrent upsert race
// can't create two rows that then silently diverge.
activityStateSchema.index({ room: 1, activity: 1 }, { unique: true });

export const ActivityState = mongoose.model("ActivityState", activityStateSchema);
