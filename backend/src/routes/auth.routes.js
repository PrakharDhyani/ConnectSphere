import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import {
  register,
  login,
  refresh,
  logout,
  googleCallback,
  verifyEmail,
  resendVerification,
  forgotPassword,
  resetPassword,
} from "../controllers/auth.controller.js";
import { passport } from "../config/passport.js";
import { validate } from "../middleware/validate.js";
import {
  registerSchema,
  loginSchema,
  emailSchema,
  resetPasswordSchema,
} from "../validators/auth.validator.js";

const router = Router();

// Auth endpoints are brute-force targets — tighter than the global 300/15min
// limit set in app.js.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts, please try again later." },
  // See app.js globalLimiter — disabled under test so the shared loopback IP
  // doesn't accumulate hits across a suite and trip the 20/window cap.
  skip: () => process.env.NODE_ENV === "test",
});

router.post("/register", authLimiter, validate(registerSchema), register);
router.post("/login", authLimiter, validate(loginSchema), login);
router.post("/refresh", authLimiter, refresh);
router.post("/logout", logout);

// ── Email verification & password reset ──
router.get("/verify-email", verifyEmail);
router.post("/resend-verification", authLimiter, validate(emailSchema), resendVerification);
router.post("/forgot-password", authLimiter, validate(emailSchema), forgotPassword);
router.post("/reset-password", authLimiter, validate(resetPasswordSchema), resetPassword);

// ── Google OAuth ──
// If creds aren't configured, the strategy was never registered — return a
// clear 501 instead of letting passport throw an opaque "Unknown strategy".
const googleEnabled = () =>
  Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

function requireGoogleConfigured(req, res, next) {
  if (!googleEnabled()) {
    return res
      .status(501)
      .json({ success: false, error: { message: "Google OAuth is not configured" } });
  }
  next();
}

// Step 1: send the user to Google's consent screen
router.get(
  "/google",
  requireGoogleConfigured,
  (req, res, next) =>
    passport.authenticate("google", { session: false })(req, res, next)
);

// Step 2: Google redirects back here with a one-time code; passport exchanges
// it for the profile and runs our find-or-create, then googleCallback issues
// our own tokens and bounces the browser back to the frontend.
router.get(
  "/google/callback",
  requireGoogleConfigured,
  (req, res, next) =>
    passport.authenticate("google", {
      session: false,
      failureRedirect: `${process.env.CLIENT_URL}/login?error=oauth`,
    })(req, res, next),
  googleCallback
);

export default router;
