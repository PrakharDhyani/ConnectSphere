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
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
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
  },
  { timestamps: true } // adds createdAt / updatedAt automatically
);

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
