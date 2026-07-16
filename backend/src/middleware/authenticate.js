import { verifyAccessToken } from "../utils/token.js";

// Protects a route: requires a valid "Authorization: Bearer <token>" header.
// On success, attaches { id, role } to req.user for downstream handlers.
export function authenticate(req, res, next) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    const error = new Error("Missing or malformed Authorization header");
    error.statusCode = 401;
    return next(error);
  }

  const token = header.slice("Bearer ".length);

  try {
    const decoded = verifyAccessToken(token);
    req.user = { id: decoded.sub, role: decoded.role };
    next();
  } catch {
    // Covers both expired tokens and bad signatures — same generic message,
    // since the client's fix is identical either way ("log in again").
    const error = new Error("Invalid or expired access token");
    error.statusCode = 401;
    next(error);
  }
}
