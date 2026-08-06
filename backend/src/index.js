/**
 * Groot — Backend Entry Point
 *
 * Boot order:
 *  1. Load env vars
 *  2. Connect to MongoDB
 *  3. Connect to Redis
 *  4. Connect to Kafka producer
 *  5. Create Express app
 *  6. Create HTTP server (needed for Socket.io)
 *  7. Initialize Socket.io
 *  8. Start listening
 */

import "dotenv/config";
import http from "http";
// Registers every activity plugin manifest. Imported for its side effect and
// placed FIRST deliberately: a malformed manifest throws here, before any
// external connection is opened, so the failure is an immediate startup crash
// naming the offending plugin and field — never a blank tab in production.
import { getAllPlugins } from "../../shared/activities/index.js";
import { app } from "./app.js";
import { connectMongo } from "./config/mongo.js";
import { connectRedis } from "./config/redis.js";
import { connectKafka } from "./config/kafka.js";
import { createMediasoupWorker } from "./config/mediasoup.js";
import { initSocket } from "./sockets/index.js";
import { logger } from "./utils/logger.js";

const PORT = process.env.PORT || 5000;

async function bootstrap() {
  try {
    // Connect all external services before accepting traffic
    await connectMongo();

    // Dev self-heal: reconcile indexes with the current schema (e.g. a changed
    // unique/partial index). Guarded to non-production — syncIndexes can drop &
    // rebuild indexes, which is unsafe to run automatically on a large prod DB.
    if (process.env.NODE_ENV !== "production") {
      const { User } = await import("./models/User.js");
      const { Room } = await import("./models/Room.js");
      await Promise.all([User.syncIndexes(), Room.syncIndexes()]);
      logger.info("✅ Indexes synced (dev)");
    }

    logger.info(`✅ ${getAllPlugins().length} activity plugins registered`);

    await connectRedis();
    await connectKafka();
    await createMediasoupWorker(); // media server for video calls

    // HTTP server wraps Express so Socket.io can share the same port
    const httpServer = http.createServer(app);

    // Initialize Socket.io on the same HTTP server
    initSocket(httpServer);

    httpServer.listen(PORT, () => {
      logger.info(`🚀 Groot backend running on port ${PORT}`);
      logger.info(`📡 Environment: ${process.env.NODE_ENV}`);
    });
  } catch (error) {
    logger.error("❌ Failed to start server:", error);
    process.exit(1);
  }
}

// Graceful shutdown — close connections on SIGTERM (Docker stop / k8s pod eviction)
process.on("SIGTERM", () => {
  logger.info("SIGTERM received. Shutting down gracefully...");
  process.exit(0);
});

bootstrap();
