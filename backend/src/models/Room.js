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
    // public     — discoverable in the public list, joinable without a code
    // private    — invite-code only (the original behaviour, still the default)
    // inviteOnly — not discoverable, and eventually the code alone will not be
    //              enough: you must have been invited.
    //
    // NOTE (Phase 1): `inviteOnly` is accepted and stored, and already behaves
    // strictly wherever visibility is read — every existing check tests
    // `=== "public"`, so it fails closed: excluded from discovery, rejected by
    // join-public. What is NOT yet enforced is the part that distinguishes it
    // from `private`: joinRoom() does not consult visibility, so a code still
    // works. That lands with the invite mechanism in Phase 4. Until then the
    // value is safe but no stricter than private — do not advertise it in the
    // UI as "invite required" before then.
    visibility: {
      type: String,
      enum: ["public", "private", "inviteOnly"],
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
    // Moderation: banned users can never (re)join; name is denormalized so the
    // owner's ban list stays readable after the user is gone from members.
    banned: [
      {
        user: { type: Schema.Types.ObjectId, ref: "User" },
        name: String,
        // Why they were banned — usually the house rule they broke. Shown to
        // the owner in the ban list and to the user when they are removed, so
        // moderation is explainable rather than arbitrary.
        reason: { type: String, maxlength: 300 },
        at: { type: Date, default: Date.now },
      },
    ],
    // Slow-mode: non-owner members may send at most one chat message per this
    // many seconds (0 = off). Enforced in the socket chat handler.
    slowModeSec: {
      type: Number,
      default: 0,
      min: 0,
      max: 120,
    },

    /**
     * House rules the owner writes. Shown to every member, and quoted back
     * when someone is kicked or banned ("rule 3: no spoilers") so moderation
     * is explainable rather than arbitrary.
     *
     * `updatedAt` drives the "rules changed — please re-read" prompt: a client
     * stores the version it last acknowledged, so editing the rules re-prompts
     * everyone without needing per-user rows in the database.
     */
    rules: {
      items: {
        type: [{ type: String, trim: true, maxlength: 200 }],
        default: undefined,
        validate: {
          validator: (r) => !r || r.length <= 20,
          message: "At most 20 rules",
        },
      },
      updatedAt: { type: Date },
      updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
    },

    /**
     * Activity plugins — which are installed in this room, and which is open.
     *
     * The room stores only ids, config and state. It knows nothing about what
     * an activity *is*: the manifest (shared/activities/<id>/manifest.js) owns
     * the name, icon, permissions and settings grammar. That separation is what
     * lets a plugin be added without touching the room, the model, or any
     * existing file.
     *
     * ABSENT MEANS "EVERYTHING". Rooms created before this field existed have
     * no `activities`, and resolveInstalled() in shared/activities/compat.js
     * maps that to the full legacy set — so old rooms behave exactly as they
     * do today with no migration, no batch job and nothing to undo. A room
     * materialises an explicit list the first time someone edits it.
     */
    activities: {
      installed: [
        {
          // Matches a manifest id. Deliberately NOT enum-validated here: an
          // unknown id must degrade to an "unavailable" placeholder, not make
          // the whole room document unreadable. Validation happens at the API
          // boundary, where a bad id can be reported to the caller.
          id: { type: String, required: true },
          // Pinned at install time so a future plugin update can be an opt-in
          // migration rather than a silent behaviour change mid-session.
          version: { type: String },
          // Validated + clamped against the plugin's configSchema before it
          // ever reaches here (coerceConfig) — client input is untrusted.
          config: { type: Schema.Types.Mixed, default: () => ({}) },
          enabled: { type: Boolean, default: true },
          addedBy: { type: Schema.Types.ObjectId, ref: "User" },
          addedAt: { type: Date, default: Date.now },
          _id: false,
        },
      ],
      // The foregrounded activity; null = the room's own chat surface.
      // Never trusted directly on read — resolveActiveActivity() falls back if
      // it names something since uninstalled, disabled or missing from a build.
      active: { type: String, default: null },
    },

    /**
     * What the room is for — drives activity recommendations at creation and,
     * later, analytics. `kind` is one of PURPOSE_IDS (shared/activities/
     * purposes.js); `text` carries the free-text answer and is only meaningful
     * when kind === "custom".
     *
     * Not enum-validated at the schema level for the same reason as activity
     * ids: the taxonomy lives in shared/ and may gain entries, and a room
     * document should never become unreadable because a purpose was renamed.
     */
    purpose: {
      kind: { type: String, default: null },
      text: { type: String, maxlength: 200, trim: true },
    },
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
