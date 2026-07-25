/**
 * Socket.io authentication — the WebSocket equivalent of the `authenticate`
 * HTTP middleware.
 *
 * A socket is NOT an HTTP request, so there's no Authorization header per
 * message. Instead the client sends its access token once, in the connection
 * handshake (`auth: { token }`), and we verify it before the connection is
 * allowed. On success we load the user once and hang { id, name, avatarUrl }
 * on the socket, so every later event knows who's speaking without another
 * DB hit or token parse.
 */
import { verifyAccessToken } from "../utils/token.js";
import { User } from "../models/User.js";

export async function authenticateSocket(socket, next) {
  try {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error("UNAUTHENTICATED"));

    const decoded = verifyAccessToken(token); // throws on bad/expired token
    const user = await User.findById(decoded.sub).select("name avatarUrl role");
    if (!user) return next(new Error("UNAUTHENTICATED"));

    socket.user = {
      id: user._id.toString(),
      name: user.name,
      avatarUrl: user.avatarUrl,
      role: user.role,
    };
    next();
  } catch {
    // Same opaque error for every failure — the client just knows to refresh
    // its token and reconnect.
    next(new Error("UNAUTHENTICATED"));
  }
}
