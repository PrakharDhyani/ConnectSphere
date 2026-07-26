import mongoose from "mongoose";

const { Schema } = mongoose;

/**
 * One persisted whiteboard per room. `elements` is the raw Excalidraw element
 * array (opaque to us — Mongoose stores it as-is via Schema.Types.Mixed). We
 * keep the live scene in memory for real-time sync and persist here debounced,
 * so a board survives a server restart and late joiners get the current state.
 */
const whiteboardSchema = new Schema(
  {
    room: {
      type: Schema.Types.ObjectId,
      ref: "Room",
      required: true,
      unique: true,
      index: true,
    },
    elements: {
      type: [Schema.Types.Mixed],
      default: [],
    },
  },
  { timestamps: true, minimize: false }
);

export const Whiteboard = mongoose.model("Whiteboard", whiteboardSchema);
