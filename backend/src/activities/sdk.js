/**
 * The server-side Plugin SDK.
 *
 * A plugin never imports app internals — no `io`, no models, no roomKey, no
 * `allow()`. It receives an sdk object built from the capabilities its manifest
 * declares, and that is its entire view of the platform.
 *
 * WHY BUILD FROM PERMISSIONS INSTEAD OF CHECKING THEM
 * An ungranted capability is simply absent, so `sdk.storage.set(...)` on a
 * plugin that never asked for `storage:room` is a TypeError at the plugin's own
 * call site, in development, with a stack trace pointing at the mistake. A
 * runtime permission *check* fails later, in production, inside platform code,
 * and reads as a platform bug. Absent beats denied.
 *
 * WHY NAMESPACED SOCKETS
 * A plugin emits "update"; the wire carries "activity:whiteboard:update". This
 * makes three things structural rather than remembered:
 *   - two plugins can both use "update" without colliding
 *   - access control and rate limiting are applied by the host, not by each
 *     handler (whiteboard.handlers.js currently repeats both by hand, 4×)
 *   - a plugin cannot listen to another plugin's traffic: the namespace is
 *     closed over at construction, not passed in per call
 */
import { roomKey } from "../sockets/chat.handlers.js";
import { allow } from "../utils/socketRate.js";
import { createStorage } from "./storage.js";
import { getRoomBus } from "./eventBus.js";
import { logger } from "../utils/logger.js";

/** Socket.io room for one plugin in one room: "act:<plugin>:<roomId>". */
export const activityKey = (pluginId, roomId) => `act:${pluginId}:${roomId}`;

/** Wire event name. Kept in one place so host and SDK cannot disagree. */
export const wireEvent = (pluginId, event) => `activity:${pluginId}:${event}`;

// Default per-event budget when a plugin does not specify one. Matches the
// existing whiteboard/draw limits (≤40/sec) — generous for turn-based games,
// tight enough that a flood cannot pin the server.
const DEFAULT_RATE = { max: 40, windowMs: 1000 };

function makeSocketApi(manifest, ctx) {
  const { io, socket, roomId } = ctx;
  const key = activityKey(manifest.id, roomId);

  return {
    /** Everyone in this activity, including the sender. */
    broadcast(event, payload) {
      io.to(key).emit(wireEvent(manifest.id, event), payload);
    },
    /** Everyone in this activity except the sender. */
    toOthers(event, payload) {
      socket.to(key).emit(wireEvent(manifest.id, event), payload);
    },
    /** Just this socket. */
    toSelf(event, payload) {
      socket.emit(wireEvent(manifest.id, event), payload);
    },
    /**
     * One user, on all their devices. This is how UNO sends a private hand and
     * how draw-guess sends the drawer their word — the per-user room already
     * exists (`user:<id>`), the SDK just makes it reachable without exposing io.
     */
    toUser(userId, event, payload) {
      io.to(`user:${userId}`).emit(wireEvent(manifest.id, event), payload);
    },
    /**
     * Everyone in the ROOM, not just this activity — for "a game started"
     * announcements that people outside the activity need to see.
     */
    toRoom(event, payload) {
      io.to(roomKey(roomId)).emit(wireEvent(manifest.id, event), payload);
    },
    /** Who is currently in this activity (socket count, not user count). */
    async participantCount() {
      const sockets = await io.in(key).fetchSockets();
      return sockets.length;
    },
  };
}

function makeRoomApi(manifest, ctx) {
  const { roomId, room } = ctx;
  return {
    id: roomId,
    get name() { return room?.name; },
    get visibility() { return room?.visibility || "private"; },
    isOwner(userId) { return String(room?.owner) === String(userId); },
    /** Member ids as strings. Read-only — plugins cannot change membership. */
    memberIds() { return (room?.members || []).map((m) => String(m._id || m)); },
  };
}

function makePresenceApi(manifest, ctx) {
  const { io, roomId } = ctx;
  return {
    /** Distinct users in this activity (deduped across their devices). */
    async inActivity() {
      const sockets = await io.in(activityKey(manifest.id, roomId)).fetchSockets();
      const byUser = new Map();
      for (const s of sockets) if (s.user) byUser.set(s.user.id, { id: s.user.id, name: s.user.name, avatarUrl: s.user.avatarUrl });
      return [...byUser.values()];
    },
    /** Distinct users present in the room as a whole. */
    async inRoom() {
      const sockets = await io.in(roomKey(roomId)).fetchSockets();
      const byUser = new Map();
      for (const s of sockets) if (s.user) byUser.set(s.user.id, { id: s.user.id, name: s.user.name, avatarUrl: s.user.avatarUrl });
      return [...byUser.values()];
    },
  };
}

function makeUserApi(manifest, ctx) {
  const { socket } = ctx;
  // A frozen copy, not the live object: a plugin must not be able to edit
  // socket.user and change who the platform thinks is speaking.
  //
  // socketId is included because per-connection identity is genuinely needed —
  // live cursors key on it, and one user with two tabs is two cursors. It is
  // the connection's id, not a capability, so it is safe to expose.
  return Object.freeze({ ...socket.user, socketId: socket.id });
}

/**
 * Build the sdk for one plugin handling one event on one socket.
 *
 * @param {object} manifest  the plugin's manifest (source of truth for grants)
 * @param {object} ctx       { io, socket, roomId, room, config }
 */
export function createServerSdk(manifest, ctx) {
  const perms = manifest.permissions || [];
  const sdk = {
    // Always available: identity of the plugin and its per-room settings.
    meta: Object.freeze({
      id: manifest.id,
      version: manifest.version,
      config: ctx.config || {},
    }),
    // Who sent this event. Not a capability — a handler that cannot tell who
    // is speaking cannot enforce anything.
    user: makeUserApi(manifest, ctx),
    log: {
      info: (...a) => logger.info(`[${manifest.id}]`, ...a),
      warn: (...a) => logger.warn(`[${manifest.id}]`, ...a),
      error: (...a) => logger.error(`[${manifest.id}]`, ...a),
    },
  };

  const grant = (perm, key, factory) => {
    if (perms.includes(perm)) sdk[key] = factory(manifest, ctx);
  };

  grant("socket:namespaced", "socket", makeSocketApi);
  grant("room:read", "room", makeRoomApi);
  grant("presence:read", "presence", makePresenceApi);
  grant("storage:room", "storage", () => createStorage(manifest.id, ctx.roomId));

  // The bus is always granted for EMIT (a plugin must be able to announce
  // itself) but `on` is gated: subscribing to another plugin's events is a
  // dependency, and dependencies belong in the manifest where they are visible.
  sdk.events = getRoomBus(ctx.roomId).scopedTo(manifest.id, perms.includes("events:listen"));

  return Object.freeze(sdk);
}

export { DEFAULT_RATE, allow };
