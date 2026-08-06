/**
 * Per-room event bus — the ONLY way one plugin reaches another.
 *
 * Plugins never import or call each other. A game announces "activity.started"
 * and does not know or care whether anything is listening; a notification
 * plugin subscribes without knowing which games exist. That indirection is what
 * lets a plugin be added later and still participate in behaviour written
 * before it existed.
 *
 * THE VOCABULARY MATTERS MORE THAN THE MECHANISM
 * Generic events — activity.started / ended / scored / saved — are what replace
 * today's hand-maintained ACT_LABEL map in RoomPage.jsx. The room can announce
 * "started Ludo 🎲" from the manifest (name + icon) plus a generic event,
 * instead of someone remembering to add a line per game.
 *
 * THREE RULES, EACH LOAD-BEARING
 * 1. Emission is namespaced to the emitter. A plugin cannot forge another's
 *    events, because the source is stamped by the bus, not supplied by the
 *    caller.
 * 2. Listening requires the `events:listen` permission. Subscribing to another
 *    plugin is a dependency, and dependencies belong in the manifest where a
 *    reader can see them.
 * 3. The bus does NOT bridge client and server. Crossing that gap goes through
 *    sdk.socket, which is access-controlled. A bus that silently spanned both
 *    would be an authorisation hole — a client could emit an event that server
 *    plugins trust as coming from a peer plugin.
 */
import { logger } from "../utils/logger.js";

// roomId -> Bus
const buses = new Map();

class Bus {
  constructor(roomId) {
    this.roomId = roomId;
    this.listeners = new Map(); // event -> Set<{pluginId, fn}>
  }

  emit(sourcePluginId, event, payload) {
    const subs = this.listeners.get(event);
    if (!subs?.size) return 0;
    const meta = Object.freeze({ source: sourcePluginId, roomId: this.roomId, event });
    let delivered = 0;
    for (const sub of subs) {
      // A plugin does not receive its own emission — that is a loop waiting to
      // happen, and a plugin already knows what it just did.
      if (sub.pluginId === sourcePluginId) continue;
      try {
        sub.fn(payload, meta);
        delivered += 1;
      } catch (err) {
        // One bad subscriber must not stop delivery to the others, and must
        // never propagate back into the emitting plugin's call stack.
        logger.error(`[bus] listener in "${sub.pluginId}" threw on "${event}":`, err);
      }
    }
    return delivered;
  }

  on(pluginId, event, fn) {
    let subs = this.listeners.get(event);
    if (!subs) { subs = new Set(); this.listeners.set(event, subs); }
    const sub = { pluginId, fn };
    subs.add(sub);
    return () => subs.delete(sub);
  }

  /** Drop every subscription owned by a plugin — part of its teardown. */
  offPlugin(pluginId) {
    for (const [event, subs] of this.listeners) {
      for (const sub of [...subs]) if (sub.pluginId === pluginId) subs.delete(sub);
      if (!subs.size) this.listeners.delete(event);
    }
  }

  get size() {
    let n = 0;
    for (const subs of this.listeners.values()) n += subs.size;
    return n;
  }

  /**
   * The plugin-facing face of the bus: emit is stamped with this plugin's id,
   * and `on` exists only if the plugin declared `events:listen`.
   */
  scopedTo(pluginId, canListen) {
    const api = {
      emit: (event, payload) => this.emit(pluginId, event, payload),
    };
    if (canListen) api.on = (event, fn) => this.on(pluginId, event, fn);
    return Object.freeze(api);
  }
}

export function getRoomBus(roomId) {
  let bus = buses.get(String(roomId));
  if (!bus) { bus = new Bus(String(roomId)); buses.set(String(roomId), bus); }
  return bus;
}

/** Free a room's bus once nothing is listening — keeps the Map bounded. */
export function releaseRoomBus(roomId) {
  const bus = buses.get(String(roomId));
  if (bus && bus.size === 0) buses.delete(String(roomId));
}

/**
 * Standard cross-plugin events. Using these rather than bespoke names is what
 * makes a plugin's behaviour visible to code written before it existed.
 */
export const BUS_EVENTS = Object.freeze({
  STARTED: "activity.started",
  ENDED: "activity.ended",
  SCORED: "activity.scored",
  SAVED: "activity.saved",
});

export function __resetBuses() {
  buses.clear();
}

export function __busCount() {
  return buses.size;
}
