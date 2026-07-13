import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { register, login } from "../controllers/auth.controller.js";
import { validate } from "../middleware/validate.js";
import { registerSchema, loginSchema } from "../validators/auth.validator.js";

const router = Router();

// Auth endpoints are brute-force targets — tighter than the global 300/15min
// limit set in app.js.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts, please try again later." },
});

router.post("/register", authLimiter, validate(registerSchema), register);

export default router;
