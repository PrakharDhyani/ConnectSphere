/**
 * Smash Karts as a plugin — the LAST migration, and the reference lifecycle test.
 *
 * Every other plugin is event-driven. Kart runs a 30 Hz `setInterval` physics
 * loop that advances whether or not anyone speaks, which creates one obligation
 * no other plugin has:
 *
 *   **destroy() MUST clear the interval.** A leaked `setTimeout` fires once into
 *   an empty room. A leaked `setInterval` simulating ten karts pins a core for
 *   the life of the process and says nothing about it in any log. The migration
 *   plan named this "the reference lifecycle test" from the start, so it is the
 *   assertion this suite is built around — and it is checked by observing the
 *   loop's *effect* (does the world keep advancing?) rather than by peeking at a
 *   handle, because a cleared handle with a live closure would still burn CPU.
 *
 * Also under test: the volatile stream (`sdk.socket.detached().stream()`, added
 * for this migration), no-hot-join, and the config fields the manifest declared
 * in Phase 1 with no reader.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "@jest/globals";
import http from "http";
import request from "supertest";
import { io as ioClient } from "socket.io-client";
import { startHarness } from "./helpers/harness.js";

import { getPlugin } from "../../shared/activities/index.js";
import { getRegisteredModuleIds } from "../src/activities/host.js";
import { enabledPluginIds } from "../src/activities/index.js";
import { __games } from "../src/activities/kart/server.js";

const ID = "kart";

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
  // A physics loop surviving into the next test would burn CPU for the rest of
  // the run and make unrelated timings flaky.
  for (const roomId of [...__games.keys()]) {
    const g = __games.get(roomId);
    if (g.loop) clearInterval(g.loop);
    __games.delete(roomId);
  }
});

const uniq = (n) => `${n}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

async function reg(name) {
  const email = `kt_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`;
  const res = await request(h.app)
    .post("/api/auth/register")
    .send({ name: uniq(name), email, password: "Password123" });
  return { token: res.body.data.accessToken, id: res.body.data.user.id };
}

async function createRoom(token, activities = [{ id: ID }]) {
  const res = await request(h.app)
    .post("/api/rooms")
    .set("Authorization", `Bearer ${token}`)
    .send({ name: uniq("Arena"), activities });
  return res.body.data.room;
}

function connect(token) {
  return new Promise((resolve, reject) => {
    const s = ioClient(`http://localhost:${port}`, {
      auth: { token },
      transports: ["websocket"],
      reconnection: false,
    });
    clients.push(s);
    s.once("connect", () => resolve(s));
    s.once("connect_error", reject);
    setTimeout(() => reject(new Error("connect timeout")), 4000);
  });
}

function ack(socket, event, payload) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`ack timeout: ${event}`)), 5000);
    socket.emit(event, payload, (res) => {
      clearTimeout(timer);
      resolve(res || {});
    });
  });
}

/** Wait for a state broadcast matching a predicate. */
function nextStateWhere(socket, pred, ms = 8000) {
  const wire = `activity:${ID}:state`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(wire, onState);
      reject(new Error(`no matching state within ${ms}ms`));
    }, ms);
    function onState(s) {
      if (!pred(s)) return;
      clearTimeout(timer);
      socket.off(wire, onState);
      resolve(s);
    }
    socket.on(wire, onState);
  });
}

/** Count state frames over a window — used to observe the stream's liveness. */
function countStates(socket, ms) {
  const wire = `activity:${ID}:state`;
  let n = 0;
  const onState = () => { n += 1; };
  socket.on(wire, onState);
  return new Promise((resolve) =>
    setTimeout(() => {
      socket.off(wire, onState);
      resolve(n);
    }, ms)
  );
}

const openActivity = (s, roomId) => ack(s, "activity:join", { activityId: ID, roomId });
const send = (s, roomId, event, payload) =>
  ack(s, "activity:event", { activityId: ID, roomId, event, payload });

async function twoInARoom(activities) {
  const owner = await reg("Host");
  const member = await reg("Racer");
  const room = await createRoom(owner.token, activities);
  await request(h.app)
    .post("/api/rooms/join")
    .set("Authorization", `Bearer ${member.token}`)
    .send({ code: room.code });
  const a = await connect(owner.token);
  const b = await connect(member.token);
  await openActivity(a, room.id);
  await openActivity(b, room.id);
  return { owner, member, room, a, b };
}

/** Start a match, arming the listener BEFORE the (synchronous) broadcast. */
async function startAndWait(ctx) {
  const playing = nextStateWhere(ctx.a, (s) => s.status === "playing");
  const res = await send(ctx.a, ctx.room.id, "start");
  if (res.error) throw new Error(`start refused: ${res.error}`);
  return playing;
}

describe("registration", () => {
  it("is served by the host", () => {
    expect(enabledPluginIds()).toContain(ID);
    expect(getRegisteredModuleIds()).toContain(ID);
  });

  it("completes the migration — every activity is a plugin", () => {
    // The point of the whole phase, and since §56 there is no flag to qualify
    // it: this IS the list, unconditionally.
    expect(enabledPluginIds()).toEqual(
      expect.arrayContaining(["whiteboard", "sticky-notes", "chess", "uno", "typing", "bingo", "skribbl", "ludo", "kart"])
    );
  });

  it("caps karts at ten, matching the arena", () => {
    expect(getPlugin(ID).maxPlayers).toBe(10);
  });
});

describe("joining", () => {
  it("opening the activity does not put a kart in the arena", async () => {
    const { room, a } = await twoInARoom();
    const res = await openActivity(a, room.id);
    expect(res.state.status).toBe("lobby");
    expect(res.state.players).toEqual([]);
  });

  it("seats a kart on an explicit join and assigns a colour", async () => {
    const { owner, room, a } = await twoInARoom();
    const res = await send(a, room.id, "join");
    expect(res.color).toBeTruthy();
    expect(__games.get(room.id).players.get(owner.id)).toBeTruthy();
  });

  it("refuses a non-member of the room", async () => {
    const { room } = await twoInARoom();
    const outsider = await reg("Outsider");
    const c = await connect(outsider.token);
    expect((await openActivity(c, room.id)).error).toBeTruthy();
  });

  it("refuses a hot-join mid-match and offers spectating instead", async () => {
    const ctx = await twoInARoom();
    await send(ctx.a, ctx.room.id, "join");
    await startAndWait(ctx);
    // Being dropped in against fighters who are already damaged is unfair both
    // ways, so latecomers watch until the match ends.
    const res = await send(ctx.b, ctx.room.id, "join");
    expect(res.spectate).toBe(true);
    expect(res.error).toMatch(/in progress/i);
  });

  it("honours a maxPlayers cap below ten", async () => {
    const ctx = await twoInARoom([{ id: ID, config: { maxPlayers: 2 } }]);
    await send(ctx.a, ctx.room.id, "join");
    await send(ctx.b, ctx.room.id, "join");
    const res = await send(ctx.a, ctx.room.id, "addBot", {});
    expect(res.error).toMatch(/full/i);
  });
});

describe("bots", () => {
  it("only the host may add one", async () => {
    const ctx = await twoInARoom();
    await send(ctx.a, ctx.room.id, "join");
    await send(ctx.b, ctx.room.id, "join");
    expect((await send(ctx.b, ctx.room.id, "addBot", {})).error).toMatch(/host/i);
    expect((await send(ctx.a, ctx.room.id, "addBot", { difficulty: "hard" })).ok).toBe(true);
  });

  it("refuses bots when the room disables them", async () => {
    const ctx = await twoInARoom([{ id: ID, config: { allowBots: false } }]);
    await send(ctx.a, ctx.room.id, "join");
    expect((await send(ctx.a, ctx.room.id, "addBot", {})).error).toMatch(/disabled/i);
  });

  it("removes the most recent bot when given no id", async () => {
    const ctx = await twoInARoom();
    await send(ctx.a, ctx.room.id, "join");
    await send(ctx.a, ctx.room.id, "addBot", {});
    const second = await send(ctx.a, ctx.room.id, "addBot", {});
    await send(ctx.a, ctx.room.id, "removeBot", {});
    expect(__games.get(ctx.room.id).players.has(second.id)).toBe(false);
  });
});

describe("the match loop", () => {
  it("starts and streams world snapshots", async () => {
    const ctx = await twoInARoom();
    await send(ctx.a, ctx.room.id, "join");
    const s = await startAndWait(ctx);
    expect(s.status).toBe("playing");

    // ~15 Hz. Anything above a handful of frames in 700ms proves the loop is
    // running and the detached stream reaches the activity room.
    const frames = await countStates(ctx.a, 700);
    expect(frames).toBeGreaterThan(3);
  });

  it("advances the simulation from the loop, with nobody sending anything", async () => {
    const ctx = await twoInARoom();
    await send(ctx.a, ctx.room.id, "join");
    await send(ctx.a, ctx.room.id, "addBot", { difficulty: "hard" });
    await startAndWait(ctx);

    const g = __games.get(ctx.room.id);
    const startTick = g.tick;
    await new Promise((r) => setTimeout(r, 500));
    // The physics ran without a single client message — that is the whole
    // difference between this plugin and every other one.
    expect(g.tick).toBeGreaterThan(startTick);
  });

  it("only the host may start", async () => {
    const ctx = await twoInARoom();
    await send(ctx.a, ctx.room.id, "join");
    await send(ctx.b, ctx.room.id, "join");
    expect((await send(ctx.b, ctx.room.id, "start")).error).toMatch(/host/i);
  });

  it("clamps hostile input rather than trusting it", async () => {
    const ctx = await twoInARoom();
    await send(ctx.a, ctx.room.id, "join");
    await startAndWait(ctx);

    await send(ctx.a, ctx.room.id, "input", {
      input: { throttle: 9999, steer: -9999, shoot: "yes" },
    });
    const p = __games.get(ctx.room.id).players.get(ctx.owner.id);
    expect(p.input.throttle).toBe(1);
    expect(p.input.steer).toBe(-1);
    expect(p.input.shoot).toBe(true);
  });
});

describe("lifecycle — the reference test", () => {
  /**
   * The assertion the whole migration plan pointed at.
   *
   * Checked by OBSERVING THE LOOP'S EFFECT, not by reading `g.loop`: a handle
   * set to null while the closure still ticks would pass a naive check and
   * still burn a core forever.
   */
  it("destroy() stops the physics loop when the last participant leaves", async () => {
    const ctx = await twoInARoom();
    await send(ctx.a, ctx.room.id, "join");
    await send(ctx.a, ctx.room.id, "addBot", {});
    await startAndWait(ctx);

    const g = __games.get(ctx.room.id);
    expect(g.loop).toBeTruthy();
    const tickBefore = g.tick;

    await ack(ctx.a, "activity:leave", { activityId: ID, roomId: ctx.room.id });
    await ack(ctx.b, "activity:leave", { activityId: ID, roomId: ctx.room.id });
    await new Promise((r) => setTimeout(r, 400));

    // The room is gone entirely...
    expect(__games.has(ctx.room.id)).toBe(false);
    // ...and the world it held has genuinely stopped advancing. A leaked
    // interval would have added ~12 ticks in that window.
    const tickAfter = g.tick;
    await new Promise((r) => setTimeout(r, 300));
    expect(g.tick).toBe(tickAfter);
    expect(g.loop).toBeNull();
    expect(tickAfter).toBeGreaterThanOrEqual(tickBefore);
  });

  it("a bot-only arena does not outlive its last human viewer", async () => {
    const ctx = await twoInARoom();
    await send(ctx.a, ctx.room.id, "join");
    await send(ctx.a, ctx.room.id, "addBot", {});
    await send(ctx.a, ctx.room.id, "addBot", {});
    await startAndWait(ctx);
    const g = __games.get(ctx.room.id);

    // The legacy handler had to reason about "are any HUMANS left?" itself.
    // The host's teardown answers the stronger question, so bots cannot keep a
    // match running once nobody is watching it.
    await ack(ctx.a, "activity:leave", { activityId: ID, roomId: ctx.room.id });
    await ack(ctx.b, "activity:leave", { activityId: ID, roomId: ctx.room.id });
    await new Promise((r) => setTimeout(r, 400));

    expect(__games.has(ctx.room.id)).toBe(false);
    expect(g.loop).toBeNull();
  });

  it("reset stops the loop and returns the arena to the lobby", async () => {
    const ctx = await twoInARoom();
    await send(ctx.a, ctx.room.id, "join");
    await startAndWait(ctx);

    const g = __games.get(ctx.room.id);
    const backToLobby = nextStateWhere(ctx.b, (s) => s.status === "lobby");
    await send(ctx.a, ctx.room.id, "reset");
    await backToLobby;
    expect(g.loop).toBeNull();
  });
});

describe("config", () => {
  it("reads match length from the room config", async () => {
    const ctx = await twoInARoom([{ id: ID, config: { matchLength: 120 } }]);
    await send(ctx.a, ctx.room.id, "join");
    const s = await startAndWait(ctx);
    expect(s.matchMs).toBe(120_000);
    // timeLeft counts down from the configured length, not the 180s default.
    expect(s.timeLeft).toBeLessThanOrEqual(120_000);
  });

  it("reads the arena from the room config", async () => {
    const ctx = await twoInARoom([{ id: ID, config: { map: "volcano" } }]);
    const res = await send(ctx.a, ctx.room.id, "join");
    expect(res.ok).toBe(true);
    expect(__games.get(ctx.room.id).mapId).toBe("volcano");
  });

  it("host config still overrides the room default in the lobby", async () => {
    const ctx = await twoInARoom();
    await send(ctx.a, ctx.room.id, "join");
    const changed = nextStateWhere(ctx.b, (s) => s.mode === "tdm");
    await send(ctx.a, ctx.room.id, "config", { mode: "tdm", duration: 300 });
    const s = await changed;
    expect(s.mode).toBe("tdm");
    expect(s.matchMs).toBe(300_000);
  });
});
