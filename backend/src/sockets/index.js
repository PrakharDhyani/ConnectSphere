/**
 * Socket.io Initialization — STUB
 *
 * What is Socket.io?
 *   A library that enables real-time, bidirectional communication between
 *   browser and server over WebSocket (with HTTP long-polling as fallback).
 *
 * Why use it over plain WebSocket?
 *   - Auto-reconnection
 *   - Room/namespace support built in
 *   - Works behind proxies (Nginx, AWS ALB)
 *   - Fallback for environments that block WebSocket
 *
 * Full socket handlers will be added in Phase 2 (chat) and Phase 3 (video rooms).
 */

import { Server } from "socket.io";
import { logger } from "../utils/logger.js";

let io;

export function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: process.env.CLIENT_URL || "http://localhost:3000",
      methods: ["GET", "POST"],
      credentials: true,
    },
    // Tune for production:
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  io.on("connection", (socket) => {
    logger.info(`Socket connected: ${socket.id}`);

    socket.on("disconnect", (reason) => {
      logger.info(`Socket disconnected: ${socket.id} — reason: ${reason}`);
    });
  });

  logger.info("✅ Socket.io initialized");
  return io;
}

export { io };
