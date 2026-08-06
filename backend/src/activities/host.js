/**
 * The plugin host — ONE socket dispatcher for every activity.
 *
 * Replaces the twelve hardcoded `registerXHandlers(io, socket)` calls in
 * sockets/index.js. Adding a plugin no longer edits that file, which is
 * guarantee #1 of the architecture: adding a plugin edits no existing file.
 *
 * WHAT THE HOST DOES ON EVERY PLUGIN EVENT, SO PLUGINS NEVER HAVE TO:
 *   1. resolve the plugin from the registry            → unknown id is ignored
 *   2. canAccessRoom(user, roomId)                     → existing authority
 *   3. the room actually has this activity enabled     → uninstalled = closed
 *   4. rate limit, per socket, per event               → automatic
 *   5. build the SDK from declared permissions         → capability isolation
 *   6. try/catch the handler                           → one plugin cannot kill
 *                                                        the socket connection
 *
 * Every one of those is currently repeated by hand in each handler file — and
 * whiteboard.handlers.js repeats steps 2 and 4 four separate times. Structural
 * beats remembered: a plugin author cannot forget a step that is not theirs.
 */
import { getPlugin } from "../../../shared/activities/index.js";
import { resolveInstalled, getActivityConfig } from "../../../shared/activities/index.js";
import { canAccessRoom } from "../utils/roomAccess.js";
import { Room } from "../models/Room.js";
import { logger } from "../utils/logger.js";
import { createServerSdk, activityKey, wireEvent, DEFAULT_RATE, allow } from "./sdk.js";
import { getRoomBus, releaseRoomBus } from "./eventBus.js";

/**
 * Server modules, keyed by plugin id.
 *
 * A module is:
 *   { events: { name: (sdk, payload, ack) => {} },
 *     rates?:  { name: {max, windowMs} },
 *     onJoin?(sdk), onLeave?(sdk), destroy?(roomId) }
 *
 * Registered by activities/index.js, NOT imported here — the host must not know
 * which plugins exist.
 */
const modules = new Map();

export function registerActivityModule(pluginId, mod) {
  if (!getPlugin(pluginId)) {
    throw new Error(`Cannot register a server module for unknown plugin "${pluginId}"`);
  }
  if (modules.has(pluginId)) throw new Error(`Duplicate server module for "${pluginId}"`);
  modules.set(pluginId, mod);
  return mod;
}

export const getActivityModule = (id) => modules.get(id) ?? null;
export const getRegisteredModuleIds = () => [...modules.keys()];

/**
 * Shared gate for every plugin event.
 * Returns a built sdk, or null when the caller must be ignored.
 */
async function authorize(io, socket, pluginId, roomId) {
  if (!roomId || typeof roomId !== "string") return null;
  const manifest = getPlugin(pluginId);
  if (!manifest) return null;

  /**
   * The host only serves plugins that actually have a registered server module.
   *
   * Without this, `activity:join` succeeds for every plugin in the registry
   * even when the migration flag is off — the socket lands in the activity
   * room and gets `{ok:true, state:null}`, while the legacy handler is the one
   * really doing the work. Nothing breaks today (no events are wired), but it
   * is a lie to the client and it is exactly how a double-broadcast bug starts.
   *
   * Caught by a live rollback test, not by the unit tests: the suite always
   * ran with the flag ON, so this path was never exercised.
   */
  if (!modules.has(pluginId)) return null;

  // Existing authority — never re-implemented, only called.
  if (!(await canAccessRoom(socket.user, roomId))) return null;

  const room = await Room.findById(roomId).select("name visibility owner members activities").lean();
  if (!room) return null;

  // An activity that is not installed (or is disabled) is closed, even to a
  // member who knows the event name.
  const entry = resolveInstalled(room).find((a) => a.id === pluginId);
  if (!entry || !entry.enabled) return null;

  return createServerSdk(manifest, {
    io,
    socket,
    roomId,
    room,
    config: getActivityConfig(room, pluginId),
  });
}

/**
 * Wire one socket. Called once per connection, for ALL plugins — the dispatcher
 * listens on a small fixed set of events and routes by plugin id, rather than
 * registering N listeners per plugin per socket.
 */
export function registerActivityHost(io, socket) {
  /** activity:join — enter a plugin's room and get its current state. */
  socket.on("activity:join", async ({ activityId, roomId } = {}, ack) => {
    try {
      if (!allow(socket, "activity:join", 20, 10_000)) return ack?.({ error: "Slow down" });
      const sdk = await authorize(io, socket, activityId, roomId);
      if (!sdk) return ack?.({ error: "Not allowed" });

      socket.join(activityKey(activityId, roomId));
      const mod = modules.get(activityId);
      const state = await mod?.onJoin?.(sdk);
      ack?.({ ok: true, state: state ?? null });
    } catch (err) {
      logger.error(`activity:join failed (${activityId}):`, err);
      ack?.({ error: "Could not open activity" });
    }
  });

  /** activity:leave — the counterpart, so presence and cleanup stay accurate. */
  socket.on("activity:leave", async ({ activityId, roomId } = {}, ack) => {
    try {
      const key = activityKey(activityId, roomId);
      if (!socket.rooms.has(key)) return ack?.({ ok: true });
      socket.leave(key);
      const sdk = await authorize(io, socket, activityId, roomId);
      if (sdk) await modules.get(activityId)?.onLeave?.(sdk);
      // Ack BEFORE teardown: destroy() persists to Mongo, and the leaver should
      // not wait on someone else's disk write to be told they left.
      ack?.({ ok: true });
      maybeTeardown(io, activityId, roomId).catch((err) =>
        logger.error(`activity teardown failed (${activityId}/${roomId}):`, err)
      );
    } catch (err) {
      logger.error(`activity:leave failed (${activityId}):`, err);
      ack?.({ ok: true }); // leaving must never fail loudly
    }
  });

  /** activity:event — every plugin action flows through here. */
  socket.on("activity:event", async ({ activityId, roomId, event, payload } = {}, ack) => {
    /**
     * A rejected event MUST still answer the ack.
     *
     * A bare `return` looks harmless — the event is ignored, which is correct —
     * but a client that awaits the ack (the normal way to send a move and wait
     * for confirmation) then hangs forever on every rejection: not joined,
     * rate limited, unknown event. The rejection is deliberate; the silence is
     * a bug. Found by a test that hung for 30s instead of failing.
     *
     * The reason is intentionally vague and identical for "unknown event" and
     * "not allowed" so probing cannot enumerate which events exist.
     */
    const refuse = (reason) => { ack?.({ error: reason }); };
    try {
      if (typeof event !== "string" || !event || event.length > 64) return refuse("Bad request");
      const mod = modules.get(activityId);
      const handler = mod?.events?.[event];
      if (!handler) return refuse("Not allowed");

      // Cheap gate first: only sockets that joined the activity may act in it.
      // Saves a DB round-trip on the hot path (every stroke, every move).
      if (!socket.rooms.has(activityKey(activityId, roomId))) return refuse("Not allowed");

      const rate = mod.rates?.[event] || DEFAULT_RATE;
      // Distinct reason: being throttled is the client's own doing, and a
      // client that cannot tell it apart from a refusal will retry forever.
      if (!allow(socket, wireEvent(activityId, event), rate.max, rate.windowMs)) return refuse("Slow down");

      const sdk = await authorize(io, socket, activityId, roomId);
      if (!sdk) return refuse("Not allowed");

      // The handler owns the ack when it wants to return data (see the
      // whiteboard's `save`). If it does not use it, the host still answers:
      // an accepted event and a dropped one must be distinguishable by a
      // client that awaits, and most handlers have nothing to say.
      let answered = false;
      const once = (res) => { if (!answered) { answered = true; ack?.(res); } };
      await handler(sdk, payload, once);
      once({ ok: true });
    } catch (err) {
      // A throwing plugin must not take down the socket connection.
      logger.error(`activity event ${activityId}:${event} failed:`, err);
      ack?.({ error: "Something went wrong" });
    }
  });

  /**
   * Leaving by disconnect is the common case (closing a tab), not the
   * exception — without this, presence and in-memory state would leak on every
   * refresh.
   */
  socket.on("disconnecting", () => {
    const keys = [...socket.rooms].filter((k) => k.startsWith("act:"));
    if (!keys.length) return;
    // After the socket has actually left, so counts are accurate.
    setImmediate(() => {
      for (const key of keys) {
        const [, activityId, roomId] = key.split(":");
        modules.get(activityId)?.onDisconnect?.({ activityId, roomId, userId: socket.user?.id, io });
        maybeTeardown(io, activityId, roomId).catch(() => {});
      }
    });
  });
}

/**
 * Free per-room resources once the last participant leaves.
 *
 * The reason this lives in the host rather than in each plugin: forgetting it
 * is invisible in testing and fatal in production (Kart's physics interval
 * would run forever). The host calls destroy(); the plugin only has to
 * implement it.
 */
async function maybeTeardown(io, activityId, roomId) {
  const sockets = await io.in(activityKey(activityId, roomId)).fetchSockets();
  if (sockets.length > 0) return;
  try {
    await modules.get(activityId)?.destroy?.(roomId);
  } catch (err) {
    logger.error(`activity destroy failed (${activityId}/${roomId}):`, err);
  }
  getRoomBus(roomId).offPlugin(activityId);
  releaseRoomBus(roomId);
}

export function __resetModules() {
  modules.clear();
}
