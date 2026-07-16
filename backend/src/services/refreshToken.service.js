import { redisClient } from "../config/redis.js";
import { REFRESH_TOKEN_TTL_SECONDS } from "../utils/token.js";

const keyFor = (jti) => `refresh:${jti}`;

// Called when a refresh token is issued (register/login/rotation) — records
// that this jti is currently valid for this user. TTL matches the JWT's own
// expiry, so Redis cleans up stale entries automatically; we never need a
// separate expiry sweep job.
export async function storeRefreshToken(jti, userId) {
  await redisClient.set(keyFor(jti), userId.toString(), {
    EX: REFRESH_TOKEN_TTL_SECONDS,
  });
}

// Returns the userId this jti was issued to, or null if it's unknown —
// either never issued, already rotated out, or explicitly revoked (logout).
export async function getRefreshTokenOwner(jti) {
  return redisClient.get(keyFor(jti));
}

export async function revokeRefreshToken(jti) {
  await redisClient.del(keyFor(jti));
}
