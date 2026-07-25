/**
 * Socket.io Initialization
 *
 * What is Socket.io?
 *   A library for real-time, bidirectional messaging between browser and
 *   server over a persistent WebSocket connection (with polling fallback).
 *   Unlike HTTP request/response, the server can PUSH to the client at any
 *   time — which is what live chat (and later, call signaling) needs.
 *
 * Flow: every socket must pass `authenticateSocket` (JWT in the handshake)
 * before it's allowed to connect; then per-socket chat handlers are wired up.
 */
import { Server } from "socket.io";
import { logger } from "../utils/logger.js";
import { authenticateSocket } from "./auth.js";
import { registerChatHandlers } from "./chat.handlers.js";
import { registerMediaHandlers } from "./media.handlers.js";
import { registerWhiteboardHandlers } from "./whiteboard.handlers.js";

let io;

export function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: process.env.CLIENT_URL || "http://localhost:3000",
      methods: ["GET", "POST"],
      credentials: true,
    },
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  // Gate every connection on a valid access token (see auth.js).
  io.use(authenticateSocket);

  io.on("connection", (socket) => {
    logger.info(`Socket connected: ${socket.id} (user ${socket.user.id})`);
    registerChatHandlers(io, socket);
    registerMediaHandlers(io, socket);
    registerWhiteboardHandlers(io, socket);

    socket.on("disconnect", (reason) => {
      logger.info(`Socket disconnected: ${socket.id} — reason: ${reason}`);
    });
  });

  logger.info("✅ Socket.io initialized");
  return io;
}

export { io };
