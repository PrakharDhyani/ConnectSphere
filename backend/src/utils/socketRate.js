/**
 * Tiny per-socket rate limiter for Socket.io events.
 *
 * WHY: the HTTP layer has express-rate-limit, but socket events had none — a
 * client could flood `game:draw` / `whiteboard:update` / `game:guess` and pin
 * the server. This is a fixed-window counter kept on `socket.data`, so each
 * socket gets its own independent budget per named bucket.
 *
 * Usage inside a handler:
 *   if (!allow(socket, "draw", 80, 1000)) return;   // ≤80 draws per second
 */
export function allow(socket, key, max, windowMs) {
  const buckets = (socket.data.__rl ||= {});
  const now = Date.now();
  const b = (buckets[key] ||= { count: 0, reset: now + windowMs });
  if (now > b.reset) {
    b.count = 0;
    b.reset = now + windowMs;
  }
  b.count += 1;
  return b.count <= max;
}
