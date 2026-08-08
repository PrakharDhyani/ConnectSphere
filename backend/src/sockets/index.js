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
import { registerGameHandlers } from "./game.handlers.js";
import { registerLudoHandlers } from "./ludo.handlers.js";
import { registerKartHandlers } from "./kart.handlers.js";
import { registerChessHandlers } from "./chess.handlers.js";
import { registerUnoHandlers } from "./uno.handlers.js";
import { registerTypingHandlers } from "./typing.handlers.js";
import { registerBingoHandlers } from "./bingo.handlers.js";
import { registerPollHandlers } from "./poll.handlers.js";
import { registerCaptionHandlers } from "./caption.handlers.js";
import { registerActivityHost } from "../activities/host.js";
import { registerActivityServerModules, legacyHandlerEnabled } from "../activities/index.js";

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

  // Activity plugins served through the new host (ACTIVITY_PLUGINS env flag).
  // Anything not listed keeps its original handler below, so the two paths can
  // run side by side and a migration reverts with an env var, not a deploy.
  registerActivityServerModules();

  io.on("connection", (socket) => {
    logger.info(`Socket connected: ${socket.id} (user ${socket.user.id})`);
    // Personal room — lets the server address all of one user's sockets (e.g.
    // send the game drawer their word privately).
    socket.join(`user:${socket.user.id}`);
    registerChatHandlers(io, socket);
    registerMediaHandlers(io, socket);
    // One dispatcher for every migrated plugin — this call does not grow as
    // plugins are added, which is the whole point.
    registerActivityHost(io, socket);
    // Legacy handlers, skipped once their plugin is served by the host.
    // Registering both would double-broadcast every event.
    if (legacyHandlerEnabled("whiteboard")) registerWhiteboardHandlers(io, socket);
    registerGameHandlers(io, socket);
    registerLudoHandlers(io, socket);
    registerKartHandlers(io, socket);
    registerChessHandlers(io, socket);
    registerUnoHandlers(io, socket);
    registerTypingHandlers(io, socket);
    registerBingoHandlers(io, socket);
    // Polls are CORE, not a plugin — always registered. See the note in
    // shared/activities/index.js on why polls came back out of the plugin
    // system: a room without polls is a downgrade, not a configuration.
    registerPollHandlers(io, socket);
    registerCaptionHandlers(io, socket);

    socket.on("disconnect", (reason) => {
      logger.info(`Socket disconnected: ${socket.id} — reason: ${reason}`);
    });
  });

  logger.info("✅ Socket.io initialized");
  return io;
}

export { io };
