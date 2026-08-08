/**
 * Polls — second migration onto the plugin host.
 *
 * The behaviour tests matter, but the reason poll is migrated SECOND is the
 * timer: a poll can auto-close on a setTimeout, so it is the first plugin whose
 * destroy() must clear something. Same failure mode as Kart's setInterval
 * physics loop, at 1/4 the size — which is why the migration order rehearses it
 * here rather than discovering it on the hard one.
 *
 * Driven through real socket.io clients, like the other activity suites: the
 * claims are about behaviour at the boundary (a non-owner is refused, a closed
 * poll rejects votes, the timer does not outlive the room).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "@jest/globals";
import http from "http";
import request from "supertest";
import { io as ioClient } from "socket.io-client";
import { startHarness } from "./helpers/harness.js";

import { getPlugin } from "../../shared/activities/index.js";
import { getRegisteredModuleIds } from "../src/activities/host.js";
import { enabledPluginIds, legacyHandlerEnabled } from "../src/activities/index.js";
import { __pollCount } from "../src/activities/poll/server.js";

// Serve poll through the new host for this file.
process.env.ACTIVITY_PLUGINS = "poll";

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
  const email = `poll_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`;
  const res = await request(h.app)
    .post("/api/auth/register")
    .send({ name: uniq(name), email, password: "Password123" });
  return { token: res.body.data.accessToken, id: res.body.data.user.id };
}

async function createRoom(token, config) {
  const res = await request(h.app)
    .post("/api/rooms")
    .set("Authorization", `Bearer ${token}`)
    .send({ name: uniq("Poll Room"), activities: [{ id: "poll", ...(config ? { config } : {}) }] });
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

function ack(socket, event, payload) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`ack timeout: ${event}`)), 5000);
    socket.emit(event, payload, (res) => { clearTimeout(t); resolve(res || {}); });
  });
}

function next(socket, event, ms = 4000) {
  const wire = `activity:poll:${event}`;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`no ${wire} within ${ms}ms`)), ms);
    socket.once(wire, (p) => { clearTimeout(t); resolve(p); });
  });
}

const ID = "poll";
const join = (s, roomId) => ack(s, "activity:join", { activityId: ID, roomId });
const send = (s, roomId, event, payload) => ack(s, "activity:event", { activityId: ID, roomId, event, payload });

async function twoInARoom(config) {
  const owner = await reg("Owner");
  const member = await reg("Member");
  const room = await createRoom(owner.token, config);
  await request(h.app).post("/api/rooms/join").set("Authorization", `Bearer ${member.token}`).send({ code: room.code });
  const a = await connect(owner.token);
  const b = await connect(member.token);
  await join(a, room.id);
  await join(b, room.id);
  return { owner, member, room, a, b };
}

const QUESTION = { question: "Pizza or pasta?", options: ["Pizza", "Pasta"] };

describe("migration", () => {
  it("is served by the host and its legacy handler is off", () => {
    expect(enabledPluginIds("poll")).toContain(ID);
    expect(getRegisteredModuleIds()).toContain(ID);
    // Registering both would double-broadcast every vote.
    expect(legacyHandlerEnabled("poll", "poll")).toBe(false);
    expect(legacyHandlerEnabled("poll", "none")).toBe(true);
  });

  it("stays an overlay, so it never claims a tab", () => {
    // PollPanel renders inline beside chat; a tab would be a UI regression.
    expect(getPlugin(ID).surface).toBe("overlay");
  });
});

describe("running a poll", () => {
  it("broadcasts a new poll to everyone in the activity", async () => {
    const { room, a, b } = await twoInARoom();
    const seen = next(b, "state");
    const res = await send(a, room.id, "create", QUESTION);
    expect(res.ok).toBe(true);
    const { poll } = await seen;
    expect(poll.question).toBe("Pizza or pasta?");
    expect(poll.options.map((o) => o.text)).toEqual(["Pizza", "Pasta"]);
  });

  it("counts a vote and names the voter", async () => {
    const { room, a, b, member } = await twoInARoom();
    await send(a, room.id, "create", QUESTION);
    const seen = next(a, "state");
    await send(b, room.id, "vote", { optionIdx: 1 });
    const { poll } = await seen;
    expect(poll.totalVotes).toBe(1);
    expect(poll.options[1].count).toBe(1);
    expect(poll.options[1].voters[0].id).toBe(member.id);
  });

  it("moves a vote rather than double-counting it", async () => {
    const { room, a, b } = await twoInARoom();
    await send(a, room.id, "create", QUESTION);
    await send(b, room.id, "vote", { optionIdx: 0 });
    const seen = next(a, "state");
    await send(b, room.id, "vote", { optionIdx: 1 });
    const { poll } = await seen;
    expect(poll.totalVotes).toBe(1);
    expect(poll.options[0].count).toBe(0);
    expect(poll.options[1].count).toBe(1);
  });

  it("retracts the vote when the same option is tapped twice", async () => {
    const { room, a, b } = await twoInARoom();
    await send(a, room.id, "create", QUESTION);
    await send(b, room.id, "vote", { optionIdx: 0 });
    const seen = next(a, "state");
    await send(b, room.id, "vote", { optionIdx: 0 });
    expect((await seen).poll.totalVotes).toBe(0);
  });

  it("gives a late joiner the poll in progress", async () => {
    const { room, a, member } = await twoInARoom();
    await send(a, room.id, "create", QUESTION);
    const c = await connect(member.token);
    const res = await join(c, room.id);
    expect(res.state.poll.question).toBe("Pizza or pasta?");
  });

  it("refuses a second poll while one is running", async () => {
    const { room, a } = await twoInARoom();
    await send(a, room.id, "create", QUESTION);
    expect((await send(a, room.id, "create", QUESTION)).error).toMatch(/already running/i);
  });

  it("rejects votes once the poll is closed", async () => {
    const { room, a, b } = await twoInARoom();
    await send(a, room.id, "create", QUESTION);
    await send(a, room.id, "close", {});
    expect((await send(b, room.id, "vote", { optionIdx: 0 })).error).toMatch(/no open poll/i);
  });
});

describe("validation and permissions", () => {
  it("requires a question and 2+ options", async () => {
    const { room, a } = await twoInARoom();
    expect((await send(a, room.id, "create", { question: "", options: ["a", "b"] })).error).toBeTruthy();
    expect((await send(a, room.id, "create", { question: "Q", options: ["only one"] })).error).toBeTruthy();
  });

  it("caps options at the configured maximum", async () => {
    // Config can tighten the ceiling; it can never raise it past the server's.
    const { room, a } = await twoInARoom({ maxOptions: 3 });
    const four = { question: "Q", options: ["a", "b", "c", "d"] };
    expect((await send(a, room.id, "create", four)).error).toMatch(/2–3/);
    expect((await send(a, room.id, "create", { question: "Q", options: ["a", "b", "c"] })).ok).toBe(true);
  });

  it("truncating config cannot exceed the hard server ceiling", async () => {
    const { room, a } = await twoInARoom({ maxOptions: 6 });
    const seven = { question: "Q", options: ["a", "b", "c", "d", "e", "f", "g"] };
    expect((await send(a, room.id, "create", seven)).error).toBeTruthy();
  });

  it("honours anyoneCanCreate:false — a capability the old handler never had", async () => {
    const { room, a, b } = await twoInARoom({ anyoneCanCreate: false });
    expect((await send(b, room.id, "create", QUESTION)).error).toMatch(/owner/i);
    expect((await send(a, room.id, "create", QUESTION)).ok).toBe(true);
  });

  it("lets the creator close, and the owner close someone else's", async () => {
    const { room, a, b } = await twoInARoom();
    // Member opens a poll, owner ends it: the old handler allowed only the
    // creator, which left a room stuck if they disconnected.
    await send(b, room.id, "create", QUESTION);
    expect((await send(a, room.id, "close", {})).ok).toBe(true);
  });

  it("refuses an outsider entirely", async () => {
    const owner = await reg("Owner");
    const outsider = await reg("Outsider");
    const room = await createRoom(owner.token);
    const s = await connect(outsider.token);
    expect((await join(s, room.id)).error).toBeTruthy();
  });
});

describe("the timer — why poll migrates before kart", () => {
  it("arms a timer only for a duration the server will honour", async () => {
    const { room, a } = await twoInARoom();
    // Below the 15s floor there is no timer at all — a 2s poll is a typo, not
    // a feature, and arming one would fire before anybody had read the question.
    const short = await send(a, room.id, "create", { ...QUESTION, durationSec: 5 });
    expect(short.poll.endsAt).toBeNull();
    await send(a, room.id, "close", {});

    const timed = await send(a, room.id, "create", { ...QUESTION, durationSec: 15 });
    expect(timed.poll.endsAt).toBeTruthy();
    await send(a, room.id, "close", {});
  });

  /**
   * The detached broadcaster actually delivering — the claim the migration
   * rests on: a timer that fires long after its request is gone must still
   * reach the activity.
   *
   * WAITS THE REAL 15 SECONDS, deliberately. Jest fake timers were the obvious
   * shortcut and do not work here: freezing the clock also freezes socket.io's
   * own delivery, so the broadcast never arrives and the test fails for a
   * reason that has nothing to do with the code under test. A test-only seam to
   * shrink MIN_DURATION would be worse — production code bent to suit a test.
   * One slow test is the honest price for proving the timer path end to end.
   */
  it("auto-close reaches the room from a timer with no socket in scope", async () => {
    const { room, a } = await twoInARoom();
    await send(a, room.id, "create", { ...QUESTION, durationSec: 15 });
    // If closePoll still needed the request's socket — or the raw `io` it
    // originally reached for — this would time out rather than close.
    const { poll } = await next(a, "state", 20_000);
    expect(poll.closed).toBe(true);
    expect(poll.endsAt).toBeNull();
  }, 30_000);

  it("clamps an absurd duration instead of pinning the poll open", async () => {
    const { room, a } = await twoInARoom();
    const res = await send(a, room.id, "create", { ...QUESTION, durationSec: 999_999 });
    // Clamped to 10 minutes, not ~11 days.
    expect(res.poll.endsAt - Date.now()).toBeLessThanOrEqual(600_000 + 2000);
  });

  it("destroy() clears the timer and frees the poll when the room empties", async () => {
    const { room, a, b } = await twoInARoom();
    await send(a, room.id, "create", { ...QUESTION, durationSec: 60 });
    expect(__pollCount()).toBeGreaterThan(0);

    // Everyone leaves — the host calls destroy() once the activity is empty.
    await ack(a, "activity:leave", { activityId: ID, roomId: room.id });
    await ack(b, "activity:leave", { activityId: ID, roomId: room.id });
    await new Promise((r) => setTimeout(r, 300));

    // A leaked setTimeout would hold `wire` and the poll alive for a further
    // minute and then broadcast into an empty room. This is the same failure
    // mode as Kart's physics interval.
    expect(__pollCount()).toBe(0);
  });
});
