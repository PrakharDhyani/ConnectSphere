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
import { registerPollHandlers } from "./poll.handlers.js";
import { registerCaptionHandlers } from "./caption.handlers.js";
import { registerLeaderboardHandlers } from "./leaderboard.handlers.js";
import { registerDmHandlers } from "./dm.handlers.js";
import { registerDashboardHandlers } from "./dashboard.handlers.js";
import { registerActivityHost } from "../activities/host.js";
import { registerActivityServerModules } from "../activities/index.js";

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

  // Every activity is a plugin now (Phase 2 completed in §54), so this serves
  // all of them unconditionally. The parallel-registration flag it used to
  // consult is gone — see §56.
  registerActivityServerModules();

  io.on("connection", (socket) => {
    logger.info(`Socket connected: ${socket.id} (user ${socket.user.id})`);
    // Personal room — lets the server address all of one user's sockets (e.g.
    // send the game drawer their word privately).
    socket.join(`user:${socket.user.id}`);
    registerChatHandlers(io, socket);
    registerMediaHandlers(io, socket);
    /**
     * ONE dispatcher for every activity. This call does not grow as plugins are
     * added — which was the entire point of the platform, and is now literally
     * true: the twelve `registerXHandlers` lines that used to sit here are gone.
     */
    registerActivityHost(io, socket);
    // Polls are CORE, not a plugin — always registered. See the note in
    // shared/activities/index.js on why polls came back out of the plugin
    // system: a room without polls is a downgrade, not a configuration.
    registerPollHandlers(io, socket);
    registerCaptionHandlers(io, socket);
    // Global (not per-room) leaderboards. Core for the same reason polls are:
    // the plugin host would refuse this to anyone whose room has not installed
    // the typing activity, which is wrong for a server-wide scoreboard.
    registerLeaderboardHandlers(io, socket);
    // 1:1 direct messages. Delivered to `user:<id>` personal rooms rather than
    // a per-thread socket.io room, so a DM arrives while you are looking at
    // something else entirely — which is the point of an inbox.
    registerDmHandlers(io, socket);
    // Live "what's happening in my rooms" feed for the dashboard cards. The
    // dashboard is in none of the room/activity socket rooms, so it subscribes
    // explicitly rather than overhearing them.
    registerDashboardHandlers(io, socket);

    socket.on("disconnect", (reason) => {
      logger.info(`Socket disconnected: ${socket.id} — reason: ${reason}`);
    });
  });

  logger.info("✅ Socket.io initialized");
  return io;
}

export { io };
