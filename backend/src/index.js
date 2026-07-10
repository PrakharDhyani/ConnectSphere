/**
 * ConnectSphere — Backend Entry Point
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
import { app } from "./app.js";
import { connectMongo } from "./config/mongo.js";
import { connectRedis } from "./config/redis.js";
import { connectKafka } from "./config/kafka.js";
import { initSocket } from "./sockets/index.js";
import { logger } from "./utils/logger.js";

const PORT = process.env.PORT || 5000;

async function bootstrap() {
  try {
    // Connect all external services before accepting traffic
    await connectMongo();
    await connectRedis();
    await connectKafka();

    // HTTP server wraps Express so Socket.io can share the same port
    const httpServer = http.createServer(app);

    // Initialize Socket.io on the same HTTP server
    initSocket(httpServer);

    httpServer.listen(PORT, () => {
      logger.info(`🚀 ConnectSphere backend running on port ${PORT}`);
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
