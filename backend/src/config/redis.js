/**
 * Redis Client Configuration
 *
 * We use the official `redis` npm package (v4+).
 * A single client instance is created here and exported
 * so all modules share the same connection pool.
 *
 * Use cases in Groot:
 *  - redisClient.set / get  → cache room metadata
 *  - redisClient.setEx      → store refresh tokens with TTL
 *  - redisClient.del        → blacklist tokens on logout
 *  - Socket.io adapter      → share socket state across multiple Node processes
 */

import { createClient } from "redis";
import { logger } from "../utils/logger.js";

let redisClient;

export async function connectRedis() {
  redisClient = createClient({
    socket: {
      host: process.env.REDIS_HOST || "localhost",
      port: parseInt(process.env.REDIS_PORT) || 6379,
      reconnectStrategy: (retries) => {
        // Exponential backoff — wait up to 5s between reconnect attempts
        if (retries > 10) {
          logger.error("Redis: too many reconnection attempts, giving up");
          return new Error("Too many retries");
        }
        return Math.min(retries * 500, 5000);
      },
    },
  });

  redisClient.on("connect", () => logger.info("✅ Redis connected"));
  redisClient.on("error", (err) => logger.error("Redis error:", err));
  redisClient.on("reconnecting", () => logger.warn("⚠️  Redis reconnecting..."));

  await redisClient.connect();
}

// Export the client so other modules can use it
export { redisClient };
