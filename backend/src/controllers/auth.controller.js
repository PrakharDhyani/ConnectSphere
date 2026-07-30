import { User } from "../models/User.js";
import { Room } from "../models/Room.js";
import {
  generateAccessToken,
  generateRefreshToken,
  generateGuestToken,
  verifyRefreshToken,
  REFRESH_TOKEN_TTL_SECONDS,
} from "../utils/token.js";
import {
  storeRefreshToken,
  getRefreshTokenOwner,
  revokeRefreshToken,
  revokeAllUserSessions,
} from "../services/refreshToken.service.js";
import {
  createVerificationToken,
  consumeVerificationToken,
  createPasswordResetToken,
  consumePasswordResetToken,
} from "../services/authToken.service.js";
import {
  sendVerificationEmail,
  sendPasswordResetEmail,
} from "../services/email.service.js";
import { logger } from "../utils/logger.js";

const REFRESH_COOKIE_NAME = "refreshToken";
const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true, // inaccessible to JS in the browser — blocks XSS token theft
  // "lax" is enough here because frontend (:3000) and backend (:5000) share
  // the same registrable domain (localhost) — SameSite cares about the
  // site, not the port. A real cross-domain deployment would need
  // sameSite: "none" + secure: true instead.
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
};

function setRefreshCookie(res, token) {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    ...REFRESH_COOKIE_OPTIONS,
    maxAge: REFRESH_TOKEN_TTL_SECONDS * 1000,
  });
}

function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE_NAME, REFRESH_COOKIE_OPTIONS);
}

// Issues a fresh access+refresh pair for a user, records the new refresh
// token's jti in Redis, and sets the cookie. Shared by register/login/refresh
// so all three issue tokens identically.
async function issueTokens(res, user) {
  const accessToken = generateAccessToken(user);
  const { token: refreshToken, jti } = generateRefreshToken(user);
  await storeRefreshToken(jti, user._id);
  setRefreshCookie(res, refreshToken);
  return accessToken;
}

// Creates a verification token and emails the link. Isolated + best-effort:
// callers wrap it so a mail hiccup never fails the request it's attached to
// (the user can always trigger /resend-verification).
async function dispatchVerificationEmail(user) {
  const token = await createVerificationToken(user._id);
  const verifyUrl = `${process.env.SERVER_URL}/api/auth/verify-email?token=${token}`;
  await sendVerificationEmail(user.email, verifyUrl);
}

// Shape returned to the client — never the password hash, even implicitly.
function toSafeUser(user) {
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl,
    role: user.role,
    emailVerified: user.emailVerified,
    isGuest: Boolean(user.isGuest),
  };
}

export async function register(req, res, next) {
  try {
    const { name, email, password } = req.body;

    const existing = await User.findOne({ email });
    if (existing) {
      const error = new Error("An account with this email already exists");
      error.statusCode = 409;
      throw error;
    }

    // Usernames must be unique (case-insensitive) among real accounts. Guests
    // are ephemeral display names, so they don't reserve a username.
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const nameTaken = await User.findOne({
      name: new RegExp(`^${escaped}$`, "i"),
      isGuest: { $ne: true },
    });
    if (nameTaken) {
      const error = new Error("That username is already taken");
      error.statusCode = 409;
      throw error;
    }

    const user = await User.create({ name, email, password });
    const accessToken = await issueTokens(res, user);

    // Best-effort: don't fail registration if email sending hiccups.
    try {
      await dispatchVerificationEmail(user);
    } catch (mailError) {
      logger.error("Failed to send verification email:", mailError);
    }

    res.status(201).json({
      success: true,
      data: { user: toSafeUser(user), accessToken },
    });
  } catch (error) {
    next(error);
  }
}

export async function login(req, res, next) {
  try {
    const { email, password } = req.body;

    // +password overrides the schema's select: false for this query only —
    // we need the hash here to compare against.
    const user = await User.findOne({ email }).select("+password");

    // Same generic error whether the email doesn't exist, the account has
    // no password (Google-only signup), or the password is wrong — never
    // let a caller distinguish these, or login becomes an email-enumeration
    // oracle.
    const invalidCredentials = () => {
      const error = new Error("Invalid email or password");
      error.statusCode = 401;
      return error;
    };

    if (!user || !user.password) throw invalidCredentials();

    const passwordMatches = await user.comparePassword(password);
    if (!passwordMatches) throw invalidCredentials();

    const accessToken = await issueTokens(res, user);

    res.json({
      success: true,
      data: { user: toSafeUser(user), accessToken },
    });
  } catch (error) {
    next(error);
  }
}

export async function refresh(req, res, next) {
  try {
    const token = req.cookies?.[REFRESH_COOKIE_NAME];

    const invalidRefreshToken = () => {
      clearRefreshCookie(res);
      const error = new Error("Invalid or expired refresh token");
      error.statusCode = 401;
      return error;
    };

    if (!token) throw invalidRefreshToken();

    let decoded;
    try {
      decoded = verifyRefreshToken(token);
    } catch {
      throw invalidRefreshToken();
    }

    // The jti must still be the current, un-rotated one in Redis for this
    // user. If it's missing, it was already rotated out or revoked (logout)
    // — reject rather than silently trusting the JWT's own signature alone,
    // since that's exactly what lets us detect a stolen-and-replayed token.
    const owner = await getRefreshTokenOwner(decoded.jti);
    if (owner !== decoded.sub) throw invalidRefreshToken();

    // Rotate: the old jti is single-use, so invalidate it before issuing the
    // replacement — even if something below fails, it can't be reused.
    await revokeRefreshToken(decoded.jti);

    const user = await User.findById(decoded.sub);
    if (!user) throw invalidRefreshToken();

    const accessToken = await issueTokens(res, user);

    res.json({ success: true, data: { accessToken } });
  } catch (error) {
    next(error);
  }
}

// Runs after passport has exchanged the Google code and our verify callback
// resolved a user (attached as req.user). Unlike register/login this is a
// full-page redirect, not a fetch — so the access token can't go in a JSON
// body, and putting it in the redirect URL would leak it into browser
// history and logs. Instead: set only the refresh cookie, redirect to the
// frontend, and let the SPA call /refresh to obtain its access token.
export async function googleCallback(req, res, next) {
  try {
    await issueTokens(res, req.user);
    res.redirect(`${process.env.CLIENT_URL}/auth/callback`);
  } catch (error) {
    next(error);
  }
}

// GET /verify-email?token=... — a link click, so it's a GET and redirects to
// the frontend with a status rather than returning JSON.
export async function verifyEmail(req, res, next) {
  try {
    const userId = await consumeVerificationToken(req.query.token);
    if (!userId) {
      return res.redirect(`${process.env.CLIENT_URL}/email-verified?status=invalid`);
    }
    await User.findByIdAndUpdate(userId, { emailVerified: true });
    return res.redirect(`${process.env.CLIENT_URL}/email-verified?status=success`);
  } catch (error) {
    next(error);
  }
}

export async function resendVerification(req, res, next) {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });

    // Only actually send for an existing, still-unverified account — but
    // always return the same generic response, so this can't be used to probe
    // which emails exist or which are already verified.
    if (user && !user.emailVerified) {
      try {
        await dispatchVerificationEmail(user);
      } catch (mailError) {
        logger.error("Failed to resend verification email:", mailError);
      }
    }

    res.json({
      success: true,
      message: "If that account exists and is unverified, a new link has been sent.",
    });
  } catch (error) {
    next(error);
  }
}

export async function forgotPassword(req, res, next) {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });

    if (user) {
      try {
        const token = await createPasswordResetToken(user._id);
        const resetUrl = `${process.env.CLIENT_URL}/reset-password?token=${token}`;
        await sendPasswordResetEmail(user.email, resetUrl);
      } catch (mailError) {
        logger.error("Failed to send password reset email:", mailError);
      }
    }

    // Identical response whether or not the email is registered — no oracle.
    res.json({
      success: true,
      message: "If an account exists for that email, a reset link has been sent.",
    });
  } catch (error) {
    next(error);
  }
}

export async function resetPassword(req, res, next) {
  try {
    const { token, password } = req.body;

    const invalidResetToken = () => {
      const error = new Error("Invalid or expired reset token");
      error.statusCode = 400;
      return error;
    };

    const userId = await consumePasswordResetToken(token);
    if (!userId) throw invalidResetToken();

    const user = await User.findById(userId);
    if (!user) throw invalidResetToken();

    user.password = password; // pre-save hook hashes it
    user.emailVerified = true; // clicking the emailed link proves ownership
    await user.save();

    // Kill every existing session — if the reset was prompted by a compromise,
    // old refresh tokens must not outlive it.
    await revokeAllUserSessions(user._id);

    res.json({ success: true, message: "Password has been reset. Please log in." });
  } catch (error) {
    next(error);
  }
}

export async function logout(req, res, next) {
  try {
    const token = req.cookies?.[REFRESH_COOKIE_NAME];

    if (token) {
      try {
        const decoded = verifyRefreshToken(token);
        await revokeRefreshToken(decoded.jti);
      } catch {
        // Token was already invalid/expired — nothing to revoke, and logout
        // should succeed regardless since the end state (logged out) is the
        // same either way.
      }
    }

    clearRefreshCookie(res);
    res.json({ success: true, message: "Logged out" });
  } catch (error) {
    next(error);
  }
}

// POST /guest — join a meeting via its invite code with just a display name,
// no account. Creates an EPHEMERAL guest user (auto-expires via TTL) and issues
// a room-scoped guest token. No refresh cookie: a reload ends the guest session
// (they'd rejoin from the link), which is the point of "ephemeral".
export async function guestLogin(req, res, next) {
  try {
    const { name, code } = req.body;

    const room = await Room.findOne({ code });
    if (!room) {
      const error = new Error("No meeting found for that link");
      error.statusCode = 404;
      throw error;
    }

    const guest = await User.create({
      name,
      isGuest: true,
      // Clean the guest up automatically ~when its token expires (see TTL index).
      expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000),
    });

    const accessToken = generateGuestToken(guest, room._id);

    res.status(201).json({
      success: true,
      data: {
        user: toSafeUser(guest),
        accessToken,
        room: { id: room._id, name: room.name, code: room.code },
      },
    });
  } catch (error) {
    next(error);
  }
}
