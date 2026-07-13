import { User } from "../models/User.js";
import { generateAccessToken, generateRefreshToken } from "../utils/token.js";

const REFRESH_COOKIE_NAME = "refreshToken";
const REFRESH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days, matches JWT_REFRESH_EXPIRES_IN

function setRefreshCookie(res, token) {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true, // inaccessible to JS in the browser — blocks XSS token theft
    // "lax" is enough here because frontend (:3000) and backend (:5000) share
    // the same registrable domain (localhost) — SameSite cares about the
    // site, not the port. A real cross-domain deployment would need
    // sameSite: "none" + secure: true instead.
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: REFRESH_COOKIE_MAX_AGE_MS,
  });
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

    const user = await User.create({ name, email, password });

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);
    setRefreshCookie(res, refreshToken);

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

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);
    setRefreshCookie(res, refreshToken);

    res.json({
      success: true,
      data: { user: toSafeUser(user), accessToken },
    });
  } catch (error) {
    next(error);
  }
}
