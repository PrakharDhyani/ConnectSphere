import mongoose from "mongoose";

const { Schema } = mongoose;

/**
 * A chat message inside a room. Kept deliberately small — the real-time
 * delivery happens over Socket.io; Mongo is the durable history so a user who
 * joins later (or reloads) can scroll back.
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
      required: true,
      trim: true,
      maxlength: 2000,
    },
  },
  { timestamps: true }
);

// History is always "latest N in THIS room" — a compound index on
// (room, createdAt desc) makes that query hit the index instead of scanning.
messageSchema.index({ room: 1, createdAt: -1 });

export const Message = mongoose.model("Message", messageSchema);
