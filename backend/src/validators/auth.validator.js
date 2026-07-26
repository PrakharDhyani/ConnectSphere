import Joi from "joi";

// Shared password policy — a floor (upper + lower + digit, min 8), not a full
// strength meter; the bcrypt cost factor is the real defense. Reused by
// register and password reset so the rule can't drift between them.
const passwordRule = Joi.string()
  .min(8)
  .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/)
  .required()
  .messages({
    "string.pattern.base":
      "Password must include an uppercase letter, a lowercase letter, and a number",
  });

export const registerSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100).required(),
  email: Joi.string().trim().lowercase().email().required(),
  password: passwordRule,
});

export const loginSchema = Joi.object({
  email: Joi.string().trim().lowercase().email().required(),
  // No strength pattern here — we're checking against an existing hash, not
  // enforcing rules on a new password.
  password: Joi.string().required(),
});

// Used by both forgot-password and resend-verification.
export const emailSchema = Joi.object({
  email: Joi.string().trim().lowercase().email().required(),
});

export const resetPasswordSchema = Joi.object({
  token: Joi.string().required(),
  password: passwordRule,
});

// Guest join: a display name + the room's 6-char invite code (case-normalized).
export const guestSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100).required(),
  code: Joi.string().trim().lowercase().length(6).hex().required(),
});
