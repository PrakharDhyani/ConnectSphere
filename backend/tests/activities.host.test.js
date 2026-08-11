/**
 * The activity plugin HOST — dispatch, isolation, and the whiteboard migration.
 *
 * Driven through real socket.io clients against the real server, because every
 * claim being made here is about behaviour at the boundary: that an outsider is
 * refused, that a flood is dropped, that one plugin cannot hear another. A unit
 * test of the dispatcher would prove none of those.
 *
 * The whiteboard plugin is enabled explicitly via ACTIVITY_PLUGINS so this file
 * exercises the NEW path regardless of the ambient default (which is "none" —
 * Phase 2 ships dark).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, jest } from "@jest/globals";
import http from "http";
import request from "supertest";
import { io as ioClient } from "socket.io-client";
import { startHarness } from "./helpers/harness.js";

import { enabledPluginIds, legacyHandlerEnabled, SERVER_MODULES } from "../src/activities/index.js";
import { createServerSdk, activityKey, wireEvent } from "../src/activities/sdk.js";
import { getRoomBus, __resetBuses, BUS_EVENTS } from "../src/activities/eventBus.js";
import { registerActivityModule, __resetModules, getRegisteredModuleIds } from "../src/activities/host.js";
import { getPlugin } from "../../shared/activities/index.js";

// Serve whiteboard through the new host for this file.
process.env.ACTIVITY_PLUGINS = "whiteboard";

const h = startHarness();

let server, ioServer, port;
const clients = [];

beforeAll(async () => {
  const { initSocket } = await import("../src/sockets/index.js");
  server = http.createServer(h.app);
  ioServer = initSocket(server);
  await new Promise((res) => server.listen(0, res));
  port = server.address().port;
});

afterAll(async () => {
  if (ioServer) ioServer.close();
  if (server) await new Promise((res) => server.close(res));
});

afterEach(() => {
  clients.splice(0).forEach((c) => c.close());
});

const uniq = (n) => `${n}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

async function reg(name) {
  const email = `act_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`;
  const res = await request(h.app).post("/api/auth/register").send({ name: uniq(name), email, password: "Password123" });
  return { token: res.body.data.accessToken, id: res.body.data.user.id };
}

async function createRoom(token, name = "Board Room") {
  const res = await request(h.app).post("/api/rooms").set("Authorization", `Bearer ${token}`).send({ name: uniq(name) });
  return res.body.data.room;
}

function connect(token) {
  return new Promise((resolve, reject) => {
    const s = ioClient(`http://localhost:${port}`, { auth: { token }, transports: ["websocket"], reconnection: false });
    clients.push(s);
    s.once("connect", () => resolve(s));
    s.once("connect_error", reject);
    setTimeout(() => reject(new Error("connect timeout")), 4000);
  });
}

const ack = (s, ev, arg) => new Promise((r) => s.emit(ev, arg, r));
const once = (s, ev, ms = 2500) =>
  Promise.race([
    new Promise((r) => s.once(ev, r)),
    new Promise((_, x) => setTimeout(() => x(new Error(`no ${ev}`)), ms)),
  ]);
const never = async (s, ev, ms = 400) => {
  let fired = false;
  s.once(ev, () => { fired = true; });
  await new Promise((r) => setTimeout(r, ms));
  return !fired;
};

const join = (s, activityId, roomId) => ack(s, "activity:join", { activityId, roomId });
const send = (s, activityId, roomId, event, payload) =>
  ack(s, "activity:event", { activityId, roomId, event, payload });

describe("migration flag", () => {
  /**
   * The flag governs MIGRATED plugins — ones with a legacy handler to fall back
   * to. Native plugins (born after the plugin system) have no fallback, so
   * "off" would mean dead rather than legacy, and they are always served.
   */
  const NATIVE = ["sticky-notes"];
  const migrated = (ids) => ids.filter((id) => !NATIVE.includes(id));

  it("defaults to none for migrated plugins, so Phase 2 ships dark", () => {
    expect(migrated(enabledPluginIds("none"))).toEqual([]);
    expect(migrated(enabledPluginIds(""))).toEqual([]);
    // `undefined` falls through to process.env.ACTIVITY_PLUGINS, which THIS
    // FILE sets to "whiteboard" at import time — so assert the unset default
    // by clearing the env rather than passing undefined and reading the
    // suite's own override back.
    const saved = process.env.ACTIVITY_PLUGINS;
    delete process.env.ACTIVITY_PLUGINS;
    try {
      expect(migrated(enabledPluginIds())).toEqual([]);
    } finally {
      process.env.ACTIVITY_PLUGINS = saved;
    }
  });

  it("serves a native plugin regardless of the flag", () => {
    // Sticky Notes has no sockets/*.handlers.js. If the flag could switch it
    // off, the tab would render and silently never sync — a failure with
    // nothing in the logs, which is worse than not shipping it.
    for (const raw of ["none", "", "whiteboard", "all"]) {
      expect(enabledPluginIds(raw)).toContain("sticky-notes");
    }
  });

  it("parses a list, 'all', and ignores unknown ids", () => {
    expect(migrated(enabledPluginIds("whiteboard"))).toEqual(["whiteboard"]);
    expect(enabledPluginIds("all").sort()).toEqual(Object.keys(SERVER_MODULES).sort());
    // A typo must not silently mean "old handler still running" without a warning.
    expect(migrated(enabledPluginIds("whiteboard, nonsense"))).toEqual(["whiteboard"]);
  });

  it("turns the legacy handler off exactly when the plugin is served", () => {
    expect(legacyHandlerEnabled("whiteboard", "none")).toBe(true);
    expect(legacyHandlerEnabled("whiteboard", "whiteboard")).toBe(false);
    // Both registered would double-broadcast every stroke.
  });

  it("registered the whiteboard module for this suite", () => {
    expect(getRegisteredModuleIds()).toContain("whiteboard");
  });
});

describe("host authorization", () => {
  it("lets a member join and returns the current scene", async () => {
    const owner = await reg("Owner");
    const room = await createRoom(owner.token);
    const s = await connect(owner.token);
    const res = await join(s, "whiteboard", room.id);
    expect(res.ok).toBe(true);
    expect(res.state).toEqual({ elements: [] });
  });

  it("refuses a non-member", async () => {
    const owner = await reg("Owner");
    const outsider = await reg("Outsider");
    const room = await createRoom(owner.token);
    const s = await connect(outsider.token);
    expect((await join(s, "whiteboard", room.id)).error).toBeTruthy();
  });

  it("refuses an unknown activity id", async () => {
    const owner = await reg("Owner");
    const room = await createRoom(owner.token);
    const s = await connect(owner.token);
    expect((await join(s, "no-such-plugin", room.id)).error).toBeTruthy();
  });

  /**
   * A plugin with a manifest but NO registered server module must be refused.
   *
   * Regression: the host used to accept these. Every plugin is "installed" in a
   * legacy room (absence means everything), so `activity:join` for e.g. ludo
   * returned {ok:true, state:null} and put the socket in the activity room —
   * while the real ludo handler was the legacy one. Harmless in isolation,
   * but it is the first half of a double-broadcast bug, and it made the
   * migration flag look like it had not taken effect.
   *
   * Missed by the rest of this suite because it always runs with the flag ON.
   * Found by driving the live server with ACTIVITY_PLUGINS=none.
   */
  it("refuses a plugin that has no server module (flag off for it)", async () => {
    const owner = await reg("Owner");
    const room = await createRoom(owner.token);
    const s = await connect(owner.token);
    // ludo has a manifest and is "installed" in every legacy room, but is not
    // migrated — the legacy handler owns it.
    expect(getPlugin("ludo")).not.toBeNull();
    expect(getRegisteredModuleIds()).not.toContain("ludo");
    expect((await join(s, "ludo", room.id)).error).toBeTruthy();
  });

  it("refuses a malformed or missing roomId", async () => {
    const owner = await reg("Owner");
    const s = await connect(owner.token);
    expect((await join(s, "whiteboard", undefined)).error).toBeTruthy();
    expect((await join(s, "whiteboard", "not-an-id")).error).toBeTruthy();
  });

  it("ignores events from a socket that never joined the activity", async () => {
    // The cheap gate: acting in an activity requires having joined it, which is
    // what keeps a DB round-trip off the hot path.
    const owner = await reg("Owner");
    const other = await reg("Other");
    const room = await createRoom(owner.token);
    await request(h.app).post("/api/rooms/join").set("Authorization", `Bearer ${other.token}`).send({ code: room.code });

    const a = await connect(owner.token);
    const b = await connect(other.token);
    await join(a, "whiteboard", room.id);
    // b is a member but never joined the whiteboard — its update must not land.
    const res = await send(b, "whiteboard", room.id, "update", { elements: [{ id: "x" }] });
    expect(res.error).toBeTruthy();
    expect(await never(a, wireEvent("whiteboard", "update"))).toBe(true);
  });

  /**
   * Every rejection path must answer the ack. A client that awaits an ack (the
   * normal way to send a move and wait for confirmation) would otherwise hang
   * forever whenever the server declines — the refusal is correct, the silence
   * is not. Regression test: these originally hung for 30s instead of failing.
   */
  it("always acks, even when it refuses", async () => {
    const owner = await reg("Owner");
    const room = await createRoom(owner.token);
    const s = await connect(owner.token);
    await join(s, "whiteboard", room.id);

    const cases = [
      ["unknown event", { activityId: "whiteboard", roomId: room.id, event: "no-such-event" }],
      ["unknown plugin", { activityId: "ghost", roomId: room.id, event: "update" }],
      ["malformed event name", { activityId: "whiteboard", roomId: room.id, event: "" }],
      ["over-long event name", { activityId: "whiteboard", roomId: room.id, event: "x".repeat(65) }],
    ];
    for (const [label, arg] of cases) {
      const res = await Promise.race([
        ack(s, "activity:event", arg),
        new Promise((_, x) => setTimeout(() => x(new Error(`no ack for ${label}`)), 1500)),
      ]);
      expect(res.error).toBeTruthy();
    }
  });

  it("reports throttling distinctly from refusal, so a client can back off", async () => {
    const owner = await reg("Owner");
    const room = await createRoom(owner.token);
    const s = await connect(owner.token);
    await join(s, "whiteboard", room.id);
    let throttled = null;
    for (let i = 0; i < 80 && !throttled; i++) {
      const res = await send(s, "whiteboard", room.id, "update", { elements: [] });
      if (res?.error && /slow/i.test(res.error)) throttled = res.error;
    }
    expect(throttled).toMatch(/slow/i);
  });
});

describe("whiteboard plugin behaviour (migrated)", () => {
  async function twoInRoom() {
    const owner = await reg("Owner");
    const guest = await reg("Guest");
    const room = await createRoom(owner.token);
    await request(h.app).post("/api/rooms/join").set("Authorization", `Bearer ${guest.token}`).send({ code: room.code });
    const a = await connect(owner.token);
    const b = await connect(guest.token);
    await join(a, "whiteboard", room.id);
    await join(b, "whiteboard", room.id);
    return { room, a, b };
  }

  it("broadcasts a scene update to others but not the sender", async () => {
    const { room, a, b } = await twoInRoom();
    const heard = once(b, wireEvent("whiteboard", "update"));
    const senderHears = never(a, wireEvent("whiteboard", "update"));
    await send(a, "whiteboard", room.id, "update", { elements: [{ id: "rect1" }] });
    expect((await heard).elements).toEqual([{ id: "rect1" }]);
    expect(await senderHears).toBe(true);
  });

  it("hands the current scene to a late joiner", async () => {
    const { room, a } = await twoInRoom();
    await send(a, "whiteboard", room.id, "update", { elements: [{ id: "persisted" }] });
    const late = await reg("Late");
    await request(h.app).post("/api/rooms/join").set("Authorization", `Bearer ${late.token}`).send({ code: room.code });
    const c = await connect(late.token);
    const res = await join(c, "whiteboard", room.id);
    expect(res.state.elements).toEqual([{ id: "persisted" }]);
  });

  it("relays live cursors with the sender's identity", async () => {
    const { room, a, b } = await twoInRoom();
    const heard = once(b, wireEvent("whiteboard", "pointer"));
    await send(a, "whiteboard", room.id, "pointer", { pointer: { x: 5, y: 9 } });
    const msg = await heard;
    expect(msg.pointer).toEqual({ x: 5, y: 9 });
    expect(msg.name).toBeTruthy();
    expect(msg.socketId).toBeTruthy();
  });

  it("rejects a scene over the configured element cap", async () => {
    const { room, a, b } = await twoInRoom();
    const quiet = never(b, wireEvent("whiteboard", "update"), 500);
    // Default cap is 50k (whiteboard manifest) — one client must not be able to
    // pin the server's memory.
    await send(a, "whiteboard", room.id, "update", { elements: new Array(50_001).fill({ id: "x" }) });
    expect(await quiet).toBe(true);
  });

  it("ignores a non-array elements payload instead of throwing", async () => {
    const { room, a } = await twoInRoom();
    for (const bad of [undefined, null, "nope", 42, {}]) {
      await send(a, "whiteboard", room.id, "update", { elements: bad });
    }
    // Still alive and serving.
    expect((await send(a, "whiteboard", room.id, "save")).ok).toBe(true);
  });

  it("persists on explicit save and reports the element count", async () => {
    const { room, a } = await twoInRoom();
    await send(a, "whiteboard", room.id, "update", { elements: [{ id: "a" }, { id: "b" }] });
    const res = await send(a, "whiteboard", room.id, "save");
    expect(res).toEqual({ ok: true, elementCount: 2 });
  });

  it("survives everyone leaving and reloads the scene from storage", async () => {
    // destroy() persists and frees the in-memory scene; the next join must read
    // it back rather than starting blank.
    const { room, a, b } = await twoInRoom();
    await send(a, "whiteboard", room.id, "update", { elements: [{ id: "kept" }] });
    await ack(a, "activity:leave", { activityId: "whiteboard", roomId: room.id });
    await ack(b, "activity:leave", { activityId: "whiteboard", roomId: room.id });

    // Teardown is intentionally detached from the leave ack, so poll for the
    // persisted document rather than sleeping a guessed interval.
    const { Whiteboard } = await import("../src/models/Whiteboard.js");
    for (let i = 0; i < 40; i++) {
      const doc = await Whiteboard.findOne({ room: room.id }).lean();
      if (doc?.elements?.length) break;
      await new Promise((r) => setTimeout(r, 50));
    }

    const late = await reg("Reader");
    await request(h.app).post("/api/rooms/join").set("Authorization", `Bearer ${late.token}`).send({ code: room.code });
    const c = await connect(late.token);
    const res = await join(c, "whiteboard", room.id);
    expect(res.state.elements).toEqual([{ id: "kept" }]);
  });

  it("rate limits a flood rather than relaying all of it", async () => {
    const { room, a, b } = await twoInRoom();
    let seen = 0;
    b.on(wireEvent("whiteboard", "update"), () => { seen += 1; });

    /**
     * Send ONE event and await its ack before opening the throttle.
     *
     * The 120 below are fire-and-forget by design (a flood is the thing under
     * test), but that made the whole test a race: `twoInRoom` resolves when the
     * join ACK arrives, which is not the same instant as the sender's own
     * `activity:event` path being ready. When the burst won that race every
     * event was refused and `seen` was 0 — failing on
     * `toBeGreaterThan(0)`, i.e. reporting "nothing was relayed" for a test
     * whose subject is "too much was relayed". Roughly 1 run in 3.
     *
     * One awaited round-trip removes the race without weakening the assertion:
     * the burst is still a burst, it just starts from a known-open channel.
     * A sleep here would have been the same race with a longer fuse.
     */
    const primed = await send(a, "whiteboard", room.id, "update", { elements: [{ id: "primer" }] });
    expect(primed.ok).toBe(true);

    // The cap is 40/sec; 120 in one burst must not all get through.
    for (let i = 0; i < 120; i++) a.emit("activity:event", { activityId: "whiteboard", roomId: room.id, event: "update", payload: { elements: [{ id: i }] } });
    await new Promise((r) => setTimeout(r, 600));
    expect(seen).toBeGreaterThan(0);
    expect(seen).toBeLessThanOrEqual(45); // small margin for window boundary
  });
});

describe("SDK capability isolation", () => {
  const fakeCtx = () => ({
    io: { to: () => ({ emit() {} }), in: () => ({ fetchSockets: async () => [] }) },
    socket: { id: "sock1", user: { id: "u1", name: "U" }, to: () => ({ emit() {} }), emit() {} },
    roomId: "r1",
    room: { name: "R", owner: "u1", members: [] },
    config: {},
  });

  it("omits capabilities the manifest did not request", () => {
    // Absent, not denied: calling it is a TypeError at the plugin's own call
    // site in development, not a permission error in production.
    const sdk = createServerSdk(
      { id: "minimal", version: "1.0.0", permissions: ["room:read"] },
      fakeCtx()
    );
    expect(sdk.room).toBeDefined();
    expect(sdk.socket).toBeUndefined();
    expect(sdk.storage).toBeUndefined();
    expect(sdk.presence).toBeUndefined();
    expect(() => sdk.storage.set({})).toThrow(TypeError);
  });

  it("grants exactly what the real whiteboard manifest declares", () => {
    const sdk = createServerSdk(getPlugin("whiteboard"), fakeCtx());
    expect(sdk.socket).toBeDefined();
    expect(sdk.room).toBeDefined();
    expect(sdk.storage).toBeDefined();
    expect(sdk.presence).toBeDefined();
  });

  it("never exposes io, the raw socket, or models", () => {
    const sdk = createServerSdk(getPlugin("whiteboard"), fakeCtx());
    for (const forbidden of ["io", "socket_", "Room", "db", "mongoose"]) {
      expect(sdk[forbidden]).toBeUndefined();
    }
    // sdk.socket is the namespaced API, not the socket.io socket.
    expect(typeof sdk.socket.broadcast).toBe("function");
    expect(sdk.socket.join).toBeUndefined();
    expect(sdk.socket.handshake).toBeUndefined();
  });

  it("freezes the sdk and the user copy so a plugin cannot rewrite identity", () => {
    const sdk = createServerSdk(getPlugin("whiteboard"), fakeCtx());
    expect(() => { sdk.user = { id: "admin" }; }).toThrow();
    expect(() => { sdk.user.id = "admin"; }).toThrow();
    expect(sdk.user.id).toBe("u1");
  });

  it("namespaces the wire event so two plugins cannot collide", () => {
    expect(wireEvent("whiteboard", "update")).toBe("activity:whiteboard:update");
    expect(wireEvent("ludo", "update")).toBe("activity:ludo:update");
    expect(activityKey("ludo", "r1")).toBe("act:ludo:r1");
  });
});

describe("event bus", () => {
  afterEach(() => __resetBuses());

  it("delivers to other plugins with the source stamped by the bus", () => {
    const bus = getRoomBus("r1");
    const seen = [];
    bus.on("listener", BUS_EVENTS.SAVED, (payload, meta) => seen.push({ payload, meta }));
    bus.emit("whiteboard", BUS_EVENTS.SAVED, { elementCount: 3 });
    expect(seen).toHaveLength(1);
    expect(seen[0].payload).toEqual({ elementCount: 3 });
    expect(seen[0].meta.source).toBe("whiteboard"); // not caller-supplied
  });

  it("does not echo an event back to its emitter", () => {
    const bus = getRoomBus("r1");
    const fn = jest.fn();
    bus.on("whiteboard", BUS_EVENTS.SAVED, fn);
    bus.emit("whiteboard", BUS_EVENTS.SAVED, {});
    expect(fn).not.toHaveBeenCalled();
  });

  it("isolates rooms from each other", () => {
    const fn = jest.fn();
    getRoomBus("r1").on("listener", "x", fn);
    getRoomBus("r2").emit("whiteboard", "x", {});
    expect(fn).not.toHaveBeenCalled();
  });

  it("keeps delivering when one subscriber throws", () => {
    const bus = getRoomBus("r1");
    const good = jest.fn();
    bus.on("bad", "e", () => { throw new Error("boom"); });
    bus.on("good", "e", good);
    expect(() => bus.emit("src", "e", {})).not.toThrow();
    expect(good).toHaveBeenCalled();
  });

  it("only exposes `on` to plugins that declared events:listen", () => {
    const bus = getRoomBus("r1");
    expect(bus.scopedTo("a", true).on).toBeDefined();
    expect(bus.scopedTo("b", false).on).toBeUndefined();
    // Emitting is always allowed — a plugin must be able to announce itself.
    expect(bus.scopedTo("b", false).emit).toBeDefined();
  });

  it("drops a plugin's subscriptions on teardown", () => {
    const bus = getRoomBus("r1");
    const fn = jest.fn();
    bus.on("doomed", "e", fn);
    expect(bus.size).toBe(1);
    bus.offPlugin("doomed");
    expect(bus.size).toBe(0);
    bus.emit("src", "e", {});
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("host module registration", () => {
  it("refuses a server module for a plugin with no manifest", () => {
    expect(() => registerActivityModule("ghost-plugin", {})).toThrow(/unknown plugin/);
  });
});
