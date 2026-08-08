/**
 * The client-side Plugin SDK — the browser counterpart to
 * backend/src/activities/sdk.js.
 *
 * WHY THIS EXISTS
 * The server host has spoken `activity:join` / `activity:event` since Phase 2,
 * but nothing in the frontend ever spoke it: every panel still imports
 * socket.js and emits its own bespoke event names. So the namespaced protocol
 * was only ever half-built, and the first plugin to need it would have had to
 * invent a client for it — inside its own folder, where the next plugin could
 * not reuse it. This is that client, built once, as platform.
 *
 * THE SHAPE MIRRORS THE SERVER ON PURPOSE
 * A plugin author reads one contract, not two. `sdk.socket.emit`,
 * `sdk.storage`, `sdk.room`, `sdk.meta` mean the same things on both sides,
 * and capabilities are BUILT from manifest.permissions here exactly as they
 * are there — an undeclared capability is `undefined`, so misuse is a
 * TypeError at the plugin's own call site rather than a silent no-op.
 *
 * WHAT IS DELIBERATELY NOT HERE
 * - No `sdk.storage.set`. Persistence is the server's job: a client that could
 *   write room state directly would be an authorisation hole, since the
 *   browser is not a trusted writer. Plugins persist by emitting an event the
 *   server handler validates. `sdk.storage.get` is not here either — state
 *   arrives from `join()`, which is the one round trip that is already
 *   access-controlled.
 * - No event bus across the wire. Same reason as the server: the bus does not
 *   bridge client and server (see eventBus.js). The local bus below is
 *   in-tab only.
 */
import { getSocket } from "@/lib/socket.js";
import { getPlugin } from "@shared/activities/index.js";

/** Wire event name. Must agree with backend/src/activities/sdk.js. */
export const wireEvent = (pluginId, event) => `activity:${pluginId}:${event}`;

/**
 * How long to wait for a host ack before treating a call as failed.
 *
 * The host answers EVERY ack, including rejections (that was a deliberate fix —
 * a bare `return` used to hang any client that awaited). So a timeout here
 * means the connection died, not that the server refused; the two must stay
 * distinguishable or a plugin will retry forever against a closed socket.
 */
const ACK_TIMEOUT_MS = 10_000;

function emitWithAck(socket, event, payload) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (res) => {
      if (settled) return;
      settled = true;
      resolve(res);
    };
    const timer = setTimeout(() => done({ error: "Timed out" }), ACK_TIMEOUT_MS);
    socket.emit(event, payload, (res) => {
      clearTimeout(timer);
      done(res || { ok: true });
    });
  });
}

/**
 * Build the SDK for one plugin instance in one room.
 *
 * @param {object} opts
 * @param {string} opts.activityId
 * @param {string} opts.roomId
 * @param {object} opts.config    the room's config for this plugin
 * @param {object} opts.user      the current user, for `sdk.user`
 * @param {object} [opts.room]    room metadata, if the caller has it
 */
export function createClientSdk({ activityId, roomId, config = {}, user = null, room = null }) {
  const manifest = getPlugin(activityId);
  if (!manifest) throw new Error(`createClientSdk: unknown plugin "${activityId}"`);

  const socket = getSocket();
  const perms = manifest.permissions || [];

  /**
   * Every listener this plugin registers, so destroy() can remove all of them.
   *
   * This is the client half of the resource-leak guarantee. A plugin that
   * unmounts without removing its socket listeners keeps receiving events into
   * a dead component — React logs a state-update-after-unmount warning, and on
   * a re-mount the handlers stack up and fire N times. Making removal the
   * host's job rather than the plugin's is the same reasoning as destroy() on
   * the server: the failure is invisible in testing and compounding in
   * production.
   */
  const listeners = [];
  let destroyed = false;

  const sdk = {
    meta: Object.freeze({ id: manifest.id, version: manifest.version, config }),
    user: user ? Object.freeze({ ...user }) : null,
    log: {
      info: (...a) => console.info(`[${manifest.id}]`, ...a),
      warn: (...a) => console.warn(`[${manifest.id}]`, ...a),
      error: (...a) => console.error(`[${manifest.id}]`, ...a),
    },
  };

  if (perms.includes("socket:namespaced")) {
    sdk.socket = {
      /**
       * Send an action to this plugin's server module and await its ack.
       * The plugin names a bare event ("move"); the namespace is closed over
       * here, so it cannot address another plugin's handlers.
       */
      emit(event, payload) {
        if (destroyed) return Promise.resolve({ error: "Activity closed" });
        return emitWithAck(socket, "activity:event", { activityId, roomId, event, payload });
      },

      /**
       * Send without awaiting an ack — for high-rate, best-effort traffic.
       *
       * `emit()` arms a 10s timeout per call so a caller that awaits can tell a
       * dropped connection from a refusal. That is right for a move or a save,
       * and wrong for a stream: the whiteboard sends ~20 scene updates and ~16
       * pointer moves a second, which would keep hundreds of timers alive for
       * results nobody reads. Cursor positions and scene deltas are superseded
       * by the next one anyway — a lost frame is invisible, a leaked timer is
       * not.
       */
      post(event, payload) {
        if (destroyed) return;
        socket.emit("activity:event", { activityId, roomId, event, payload });
      },

      /** Subscribe to one of this plugin's server broadcasts. */
      on(event, fn) {
        const wire = wireEvent(activityId, event);
        socket.on(wire, fn);
        listeners.push([wire, fn]);
        return () => {
          socket.off(wire, fn);
          const i = listeners.findIndex(([w, f]) => w === wire && f === fn);
          if (i !== -1) listeners.splice(i, 1);
        };
      },

      /**
       * Enter the activity and get its current state.
       *
       * Returns the server's `state` — for whiteboard the scene, for a game the
       * board. This is the ONLY way a late joiner catches up, and it is
       * access-controlled server-side, which is why there is no storage.get().
       */
      async join() {
        const res = await emitWithAck(socket, "activity:join", { activityId, roomId });
        if (res?.error) throw new Error(res.error);
        return res?.state ?? null;
      },

      leave() {
        return emitWithAck(socket, "activity:leave", { activityId, roomId });
      },
    };
  }

  if (perms.includes("room:read")) {
    sdk.room = Object.freeze({
      id: roomId,
      get name() { return room?.name; },
      get members() { return room?.members || []; },
      isOwner: (userId) => String(room?.owner?._id || room?.owner) === String(userId),
    });
  }

  /**
   * Tear down everything this plugin registered.
   *
   * Idempotent, because React StrictMode double-invokes effects in development
   * and an unmount can race a reconnect. A destroy() that threw or
   * double-removed on the second call would look like a plugin bug.
   */
  sdk.destroy = () => {
    if (destroyed) return;
    destroyed = true;
    for (const [wire, fn] of listeners.splice(0)) socket.off(wire, fn);
    if (sdk.socket) emitWithAck(socket, "activity:leave", { activityId, roomId });
  };

  return sdk;
}
