import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const { Schema } = mongoose;

const userSchema = new Schema(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
      maxlength: 100,
    },
    // Not required at the schema level: guest users have no email. Regular
    // signup still enforces it in the register validator. Uniqueness is a
    // PARTIAL index (declared below) rather than inline unique, so emailless
    // guests are excluded from it entirely.
    email: {
      type: String,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, "Invalid email format"],
    },
    // select: false — never returned by default queries; must opt in with
    // .select("+password") when we actually need to compare it at login.
    password: {
      type: String,
      // Not required at the schema level: Google-only users have no password.
      select: false,
    },
    googleId: {
      type: String,
      // sparse: true lets many documents omit this field without violating
      // the unique constraint (a plain unique index treats multiple
      // `null`/missing values as duplicates and rejects them).
      unique: true,
      sparse: true,
    },
    avatarUrl: {
      type: String,
      default: null,
    },
    role: {
      type: String,
      enum: ["user", "admin"],
      default: "user",
    },
    emailVerified: {
      type: Boolean,
      default: false,
    },
    // Ephemeral guest (joined a meeting via link, no account). Guests can't
    // create rooms, edit a profile, or see the dashboard.
    isGuest: {
      type: Boolean,
      default: false,
    },
    // When set (guests only), a TTL index deletes the doc at this time — so
    // guest identities clean themselves up with no cron. null for real users
    // (Mongo's TTL index ignores docs where the field is null/absent).
    expiresAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true } // adds createdAt / updatedAt automatically
);

// Unique email ONLY for real accounts. A partial index enforces uniqueness
// solely on documents whose email is a string, so multiple emailless guests
// never collide. (A plain sparse+unique index still collides on an explicit
// null; a partial index is the robust fix.)
userSchema.index(
  { email: 1 },
  { unique: true, partialFilterExpression: { email: { $type: "string" } } }
);

// TTL cleanup for ephemeral guests (expireAfterSeconds: 0 = delete once
// expiresAt is in the past).
userSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Runs automatically before every .save() — hashes the password if it was
// just set or changed, so no caller can ever accidentally save a plaintext
// password by forgetting to hash it themselves.
userSchema.pre("save", async function hashPassword(next) {
  if (!this.isModified("password") || !this.password) return next();

  const SALT_ROUNDS = 12;
  this.password = await bcrypt.hash(this.password, SALT_ROUNDS);
  next();
});

// Instance method: compares a plaintext candidate against the stored hash.
// Lives on the model so callers never handle bcrypt directly.
userSchema.methods.comparePassword = function comparePassword(candidate) {
  return bcrypt.compare(candidate, this.password);
};

export const User = mongoose.model("User", userSchema);
