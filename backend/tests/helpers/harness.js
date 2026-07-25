/**
 * Shared test harness for the API suite.
 *
 * What it does, in order:
 *  1. Sets the env the code reads at import time (JWT secrets/TTLs, URLs) —
 *     must happen BEFORE app.js/token.js are imported, so it's at module top.
 *  2. Mocks the three external edges so tests need no Docker and send no mail:
 *       - config/redis.js      → in-memory fake (see fakeRedis.js)
 *       - services/email.service.js → spies that CAPTURE the verify/reset URLs
 *         (so a test can pull the real one-time token out, like reading MailDev)
 *       - utils/logger.js      → silent (no winston file handles leaking)
 *  3. Boots an in-memory MongoDB (mongodb-memory-server) and connects mongoose.
 *  4. Imports the real Express `app` and wires per-test cleanup.
 *
 * Usage (top of a test file):
 *   const h = startHarness();
 *   ... request(h.app) ... h.redis ... h.emails ...
 */
import { jest, beforeAll, afterAll, beforeEach } from "@jest/globals";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { makeFakeRedis } from "./fakeRedis.js";

// Absolute path to backend/src — jest.unstable_mockModule resolves its
// specifier relative to the *test file* that triggers the import (not this
// helper), so relative paths here would break. Absolute paths resolve to the
// same module id no matter which test file calls startHarness().
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src");
const src = (rel) => path.join(SRC, rel);

// ── (1) Env, before anything imports the app ──
process.env.NODE_ENV = "test";
process.env.JWT_ACCESS_SECRET = "test-access-secret";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
process.env.JWT_ACCESS_EXPIRES_IN = "15m";
process.env.JWT_REFRESH_EXPIRES_IN = "7d";
process.env.CLIENT_URL = "http://localhost:3000";
process.env.SERVER_URL = "http://localhost:5000";
process.env.EMAIL_FROM = "no-reply@connectsphere.test";
// Ensure Google OAuth is treated as "not configured" (routes 501, no strategy).
delete process.env.GOOGLE_CLIENT_ID;
delete process.env.GOOGLE_CLIENT_SECRET;

export function startHarness() {
  const redis = makeFakeRedis();
  const emails = { verifications: [], resets: [] };
  const uploads = []; // { userId, size, mimetype, url } per storage upload

  // ── (2) Mock the external edges. Jest matches by resolved path, so the
  //        specifiers here (relative to this file) target the same modules
  //        app.js imports via "../config/..." etc. Registered now, before the
  //        dynamic import() of app.js in beforeAll. ──
  jest.unstable_mockModule(src("config/redis.js"), () => ({
    redisClient: redis,
    connectRedis: async () => {},
  }));

  jest.unstable_mockModule(src("services/email.service.js"), () => ({
    sendVerificationEmail: jest.fn(async (to, url) => {
      emails.verifications.push({ to, url });
    }),
    sendPasswordResetEmail: jest.fn(async (to, url) => {
      emails.resets.push({ to, url });
    }),
    getTransporter: jest.fn(),
  }));

  // Object storage → captured in-memory. Tests get real URLs back without
  // MinIO running; `uploads` records every call for assertions.
  jest.unstable_mockModule(src("services/storage.service.js"), () => ({
    storageEnabled: () => true,
    allowedAvatarMimeTypes: ["image/jpeg", "image/png", "image/webp"],
    uploadAvatar: jest.fn(async (userId, buffer, mimetype) => {
      const url = `http://localhost:9000/connectsphere/avatars/${userId}`;
      uploads.push({ userId: String(userId), size: buffer.length, mimetype, url });
      return url;
    }),
  }));

  jest.unstable_mockModule(src("utils/logger.js"), () => ({
    logger: {
      info() {},
      warn() {},
      error() {},
      http() {},
      debug() {},
    },
  }));

  const handle = { app: null, redis, emails, uploads };
  let mongod;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());

    // Import AFTER mocks + mongo are ready. app.js reads no DB at import, but
    // its models must register against the live connection.
    ({ app: handle.app } = await import("../../src/app.js"));
    const { User } = await import("../../src/models/User.js");
    await User.syncIndexes(); // materialize unique(email) / sparse(googleId)
    const { Room } = await import("../../src/models/Room.js");
    await Room.syncIndexes(); // materialize unique(code)
  });

  afterAll(async () => {
    await mongoose.disconnect();
    if (mongod) await mongod.stop();
  });

  // Fresh state per test: wipe collections (keep indexes), flush redis, drop
  // captured emails.
  beforeEach(async () => {
    const collections = await mongoose.connection.db.collections();
    for (const c of collections) await c.deleteMany({});
    redis.__flush();
    emails.verifications.length = 0;
    emails.resets.length = 0;
    uploads.length = 0;
  });

  return handle;
}

// ── cookie helpers ──────────────────────────────────────────────────────────

// Pull the "refreshToken=<value>" pair (name=value only, no attributes) out of
// a response's Set-Cookie header, ready to send back via .set("Cookie", ...).
export function getRefreshCookie(res) {
  const setCookie = res.headers["set-cookie"] || [];
  const cookie = setCookie.find((c) => c.startsWith("refreshToken="));
  return cookie ? cookie.split(";")[0] : null;
}

// The full Set-Cookie string (with attributes) — for asserting flags like
// HttpOnly / Max-Age=0 on logout.
export function getRefreshSetCookie(res) {
  const setCookie = res.headers["set-cookie"] || [];
  return setCookie.find((c) => c.startsWith("refreshToken=")) || null;
}
