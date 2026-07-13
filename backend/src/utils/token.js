import jwt from "jsonwebtoken";

// Keep the JWT payload minimal — just enough to identify the user on
// subsequent requests. Never put sensitive data in a JWT payload: it's
// base64-encoded, not encrypted, and readable by anyone holding the token.
function buildPayload(user) {
  return { sub: user._id.toString(), role: user.role };
}

export function generateAccessToken(user) {
  return jwt.sign(buildPayload(user), process.env.JWT_ACCESS_SECRET, {
    expiresIn: process.env.JWT_ACCESS_EXPIRES_IN,
  });
}

export function generateRefreshToken(user) {
  return jwt.sign(buildPayload(user), process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN,
  });
}

export function verifyAccessToken(token) {
  return jwt.verify(token, process.env.JWT_ACCESS_SECRET);
}

export function verifyRefreshToken(token) {
  return jwt.verify(token, process.env.JWT_REFRESH_SECRET);
}
