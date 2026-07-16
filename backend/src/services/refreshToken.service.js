import { redisClient } from "../config/redis.js";
import { REFRESH_TOKEN_TTL_SECONDS } from "../utils/token.js";

const keyFor = (jti) => `refresh:${jti}`;
const userSessionsKey = (userId) => `user_sessions:${userId}`;

// Called when a refresh token is issued (register/login/rotation) — records
// that this jti is valid for this user, with a TTL matching the JWT's own
// expiry so Redis self-cleans. Also adds the jti to a per-user set so we can
// revoke ALL of a user's tokens at once (e.g. on password reset). The set
// gets the same TTL, refreshed on each new token, so it can't grow unbounded.
export async function storeRefreshToken(jti, userId) {
  const uid = userId.toString();
  await redisClient.set(keyFor(jti), uid, { EX: REFRESH_TOKEN_TTL_SECONDS });
  await redisClient.sAdd(userSessionsKey(uid), jti);
  await redisClient.expire(userSessionsKey(uid), REFRESH_TOKEN_TTL_SECONDS);
}

// Returns the userId this jti was issued to, or null if unknown (never issued,
// already rotated out, or revoked).
export async function getRefreshTokenOwner(jti) {
  return redisClient.get(keyFor(jti));
}

// Revoke a single token. getDel is atomic (no read-then-delete race); the
// key's value is the userId, which we use to also drop it from the user set.
export async function revokeRefreshToken(jti) {
  const uid = await redisClient.getDel(keyFor(jti));
  if (uid) await redisClient.sRem(userSessionsKey(uid), jti);
  return uid;
}

// Revoke every refresh token for a user — used on password reset so all
// existing sessions die immediately. Stale jtis whose keys already expired
// are harmless (deleting a missing key is a no-op).
export async function revokeAllUserSessions(userId) {
  const uid = userId.toString();
  const jtis = await redisClient.sMembers(userSessionsKey(uid));
  if (jtis.length) await redisClient.del(jtis.map(keyFor));
  await redisClient.del(userSessionsKey(uid));
}
