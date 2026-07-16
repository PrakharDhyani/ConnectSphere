import crypto from "crypto";
import jwt from "jsonwebtoken";
import ms from "ms";

// Keep the JWT payload minimal — just enough to identify the user on
// subsequent requests. Never put sensitive data in a JWT payload: it's
// base64-encoded, not encrypted, and readable by anyone holding the token.
function buildPayload(user) {
  return { sub: user._id.toString(), role: user.role };
}

export const REFRESH_TOKEN_TTL_SECONDS =
  ms(process.env.JWT_REFRESH_EXPIRES_IN) / 1000;

export function generateAccessToken(user) {
  return jwt.sign(buildPayload(user), process.env.JWT_ACCESS_SECRET, {
    expiresIn: process.env.JWT_ACCESS_EXPIRES_IN,
  });
}

// Returns both the signed token and its jti (JWT ID) separately — the
// caller (register/login/refresh) stores the jti in Redis so this specific
// token can be looked up and revoked later without decoding the JWT again.
export function generateRefreshToken(user) {
  const jti = crypto.randomUUID();
  const token = jwt.sign({ ...buildPayload(user), jti }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN,
  });
  return { token, jti };
}

export function verifyAccessToken(token) {
  return jwt.verify(token, process.env.JWT_ACCESS_SECRET);
}

export function verifyRefreshToken(token) {
  return jwt.verify(token, process.env.JWT_REFRESH_SECRET);
}
