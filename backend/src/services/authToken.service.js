/**
 * One-time token service for email verification & password reset.
 *
 * Flow for both: generate a high-entropy random token → email the RAW token
 * to the user → store only its SHA-256 hash in Redis with a TTL. On use, we
 * hash the incoming token and look it up. Storing the hash (not the token)
 * means a Redis leak exposes nothing usable. SHA-256 (a fast hash) is correct
 * here — the token is already 256 bits of randomness, so there's nothing to
 * brute-force, unlike a password.
 */

import crypto from "crypto";
import { redisClient } from "../config/redis.js";

const VERIFY_PREFIX = "verify_email:";
const RESET_PREFIX = "reset_password:";

const VERIFY_TTL_SECONDS = 24 * 60 * 60; // 24 hours
const RESET_TTL_SECONDS = 60 * 60; // 1 hour

const hash = (token) => crypto.createHash("sha256").update(token).digest("hex");

async function createToken(prefix, ttl, userId) {
  const token = crypto.randomBytes(32).toString("hex");
  await redisClient.set(prefix + hash(token), userId.toString(), { EX: ttl });
  return token; // raw token — goes in the email link, never stored
}

// Look up + delete in one shot so a token can't be used twice (getdel is
// atomic; no race between read and delete).
async function consumeToken(prefix, token) {
  if (!token) return null;
  return redisClient.getDel(prefix + hash(token));
}

export const createVerificationToken = (userId) =>
  createToken(VERIFY_PREFIX, VERIFY_TTL_SECONDS, userId);

export const consumeVerificationToken = (token) =>
  consumeToken(VERIFY_PREFIX, token);

export const createPasswordResetToken = (userId) =>
  createToken(RESET_PREFIX, RESET_TTL_SECONDS, userId);

export const consumePasswordResetToken = (token) =>
  consumeToken(RESET_PREFIX, token);
