import Joi from "joi";

export const registerSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100).required(),
  email: Joi.string().trim().lowercase().email().required(),
  // Require upper, lower, number, and a minimum length — a floor, not a
  // full strength meter; the bcrypt cost factor is the real defense.
  password: Joi.string()
    .min(8)
    .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/)
    .required()
    .messages({
      "string.pattern.base":
        "Password must include an uppercase letter, a lowercase letter, and a number",
    }),
});

export const loginSchema = Joi.object({
  email: Joi.string().trim().lowercase().email().required(),
  // No strength pattern here — we're checking the password against an
  // existing hash, not enforcing rules on a new one.
  password: Joi.string().required(),
});
