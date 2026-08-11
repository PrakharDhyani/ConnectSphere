/**
 * Live room activity — the dashboard's "what's happening right now".
 *
 * The distinction under test is the whole point of the feature: `memberCount`
 * is a ROSTER (who ever joined) and `activity.present` is a LIVE count (who is
 * in there now). Conflating them was the original problem — a 3-member room
 * looked identical whether it was empty or mid-game.
 *
 * Everything here is read from socket.io membership rather than stored, so the
 * tests drive real sockets: a stored "currently playing" flag could be asserted
 * without ever connecting, which would prove nothing about whether it tracks
 * reality.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "@jest/globals";
import http from "http";
import request from "supertest";
import { io as ioClient } from "socket.io-client";
import { startHarness } from "./helpers/harness.js";

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
const auth = (t) => ({ Authorization: `Bearer ${t}` });

async function reg(name) {
  const res = await request(h.app)
    .post("/api/auth/register")
    .send({ name: uniq(name), email: `${uniq("act")}@example.com`, password: "Password123" });
  return { token: res.body.data.accessToken, id: res.body.data.user.id };
}

async function createRoom(token, activities) {
  const res = await request(h.app)
    .post("/api/rooms")
    .set(auth(token))
    .send({ name: uniq("Room"), ...(activities ? { activities } : {}) });
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

function emit(socket, event, payload) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`ack timeout: ${event}`)), 5000);
    socket.emit(event, payload, (res) => {
      clearTimeout(timer);
      resolve(res || {});
    });
  });
}

const listRooms = (token) => request(h.app).get("/api/rooms").set(auth(token));

describe("the live count is not the member count", () => {
  it("reports 0 active for a room nobody is sitting in", async () => {
    const owner = await reg("Owner");
    const room = await createRoom(owner.token);

    const res = await listRooms(owner.token);
    const card = res.body.data.rooms.find((r) => r.id === room.id);
    // One member on the roster...
    expect(card.memberCount).toBe(1);
    // ...and nobody actually there. This is the distinction the feature exists
    // for: before it, both rooms looked the same on the dashboard.
    expect(card.activity.present).toBe(0);
    expect(card.activity.activities).toEqual([]);
    expect(card.activity.headline).toBeNull();
  });

  it("counts people who have joined the room socket", async () => {
    const owner = await reg("Owner");
    const guest = await reg("Guest");
    const room = await createRoom(owner.token);
    await request(h.app)
      .post("/api/rooms/join")
      .set(auth(guest.token))
      .send({ code: room.code });

    const a = await connect(owner.token);
    const b = await connect(guest.token);
    await emit(a, "room:join", room.id);
    await emit(b, "room:join", room.id);

    const card = (await listRooms(owner.token)).body.data.rooms.find((r) => r.id === room.id);
    expect(card.activity.present).toBe(2);
    expect(card.activity.headline).toMatch(/2 people here/i);
  });

  it("counts PEOPLE, not sockets — two tabs is one person", async () => {
    const owner = await reg("Owner");
    const room = await createRoom(owner.token);
    const tab1 = await connect(owner.token);
    const tab2 = await connect(owner.token);
    await emit(tab1, "room:join", room.id);
    await emit(tab2, "room:join", room.id);

    // A card claiming "2 people are here" for one user with tabs open is a lie
    // that makes the whole feature untrustworthy.
    const card = (await listRooms(owner.token)).body.data.rooms.find((r) => r.id === room.id);
    expect(card.activity.present).toBe(1);
  });

  it("drops back to 0 when everyone disconnects", async () => {
    const owner = await reg("Owner");
    const room = await createRoom(owner.token);
    const s = await connect(owner.token);
    await emit(s, "room:join", room.id);

    s.close();
    await new Promise((r) => setTimeout(r, 300));

    // Nothing to clean up and nothing to expire: presence IS socket membership,
    // so a closed tab stops counting by construction.
    const card = (await listRooms(owner.token)).body.data.rooms.find((r) => r.id === room.id);
    expect(card.activity.present).toBe(0);
  });
});

describe("activity sentences", () => {
  it("names the activity and how many are in it", async () => {
    const owner = await reg("Owner");
    const guest = await reg("Guest");
    const room = await createRoom(owner.token, [{ id: "ludo" }]);
    await request(h.app)
      .post("/api/rooms/join")
      .set(auth(guest.token))
      .send({ code: room.code });

    const a = await connect(owner.token);
    const b = await connect(guest.token);
    await emit(a, "room:join", room.id);
    await emit(b, "room:join", room.id);
    await emit(a, "activity:join", { activityId: "ludo", roomId: room.id });
    await emit(b, "activity:join", { activityId: "ludo", roomId: room.id });

    const card = (await listRooms(owner.token)).body.data.rooms.find((r) => r.id === room.id);
    const ludo = card.activity.activities.find((x) => x.id === "ludo");
    expect(ludo).toBeTruthy();
    expect(ludo.count).toBe(2);
    // The sentence the card shows, e.g. "2 people are playing Ludo".
    expect(ludo.label).toBe("2 people are playing Ludo");
    expect(ludo.icon).toBe("🎲");
    expect(card.activity.headline).toBe("2 people are playing Ludo");
  });

  it("uses singular for one person", async () => {
    const owner = await reg("Owner");
    const room = await createRoom(owner.token, [{ id: "whiteboard" }]);
    const a = await connect(owner.token);
    await emit(a, "room:join", room.id);
    await emit(a, "activity:join", { activityId: "whiteboard", roomId: room.id });

    const card = (await listRooms(owner.token)).body.data.rooms.find((r) => r.id === room.id);
    // Per-plugin phrasing: "brainstorming on" reads better than the category's
    // generic "creating on".
    expect(card.activity.activities[0].label).toBe("1 person is brainstorming on Whiteboard");
  });

  it("reports several activities at once, busiest first", async () => {
    const owner = await reg("Owner");
    const g1 = await reg("G1");
    const g2 = await reg("G2");
    const room = await createRoom(owner.token, [{ id: "whiteboard" }, { id: "ludo" }]);
    for (const g of [g1, g2]) {
      await request(h.app).post("/api/rooms/join").set(auth(g.token)).send({ code: room.code });
    }

    const a = await connect(owner.token);
    const b = await connect(g1.token);
    const c = await connect(g2.token);
    for (const s of [a, b, c]) await emit(s, "room:join", room.id);

    // Two on the whiteboard, one on ludo.
    await emit(a, "activity:join", { activityId: "whiteboard", roomId: room.id });
    await emit(b, "activity:join", { activityId: "whiteboard", roomId: room.id });
    await emit(c, "activity:join", { activityId: "ludo", roomId: room.id });

    const card = (await listRooms(owner.token)).body.data.rooms.find((r) => r.id === room.id);
    expect(card.activity.activities.map((x) => x.id)).toEqual(["whiteboard", "ludo"]);
    expect(card.activity.activities[0].count).toBe(2);
    // With limited space on a card, the busiest thing leads.
    expect(card.activity.headline).toMatch(/2 people are brainstorming/i);
  });
});

describe("the dashboard live feed", () => {
  it("returns a snapshot immediately, without waiting for a tick", async () => {
    const owner = await reg("Owner");
    const room = await createRoom(owner.token);
    const s = await connect(owner.token);
    await emit(s, "room:join", room.id);

    const res = await emit(s, "dashboard:watch", { roomIds: [room.id] });
    expect(res.ok).toBe(true);
    expect(res.rooms[room.id].present).toBe(1);
  });

  it("REFUSES rooms the caller is not a member of", async () => {
    // Without this the feed would be a presence oracle: anyone who learned a
    // room id could watch who is inside a private room.
    const owner = await reg("Owner");
    const outsider = await reg("Outsider");
    const room = await createRoom(owner.token);
    const a = await connect(owner.token);
    await emit(a, "room:join", room.id);

    const so = await connect(outsider.token);
    const res = await emit(so, "dashboard:watch", { roomIds: [room.id] });
    expect(res.ok).toBe(true);
    expect(res.rooms).toEqual({});
  });

  it("pushes updates as the room changes", async () => {
    const owner = await reg("Owner");
    const guest = await reg("Guest");
    const room = await createRoom(owner.token);
    await request(h.app)
      .post("/api/rooms/join")
      .set(auth(guest.token))
      .send({ code: room.code });

    const watcher = await connect(owner.token);
    await emit(watcher, "dashboard:watch", { roomIds: [room.id] });

    const update = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no dashboard:activity within 10s")), 10_000);
      const onTick = (rooms) => {
        if (rooms?.[room.id]?.present >= 1) {
          clearTimeout(timer);
          watcher.off("dashboard:activity", onTick);
          resolve(rooms);
        }
      };
      watcher.on("dashboard:activity", onTick);
    });

    // Someone walks in — the dashboard should learn about it without a refresh.
    const b = await connect(guest.token);
    await emit(b, "room:join", room.id);

    const rooms = await update;
    expect(rooms[room.id].present).toBeGreaterThanOrEqual(1);
  });

  it("stops sweeping when the watcher unwatches", async () => {
    const owner = await reg("Owner");
    const room = await createRoom(owner.token);
    const s = await connect(owner.token);
    await emit(s, "dashboard:watch", { roomIds: [room.id] });
    s.emit("dashboard:unwatch");

    // A closed dashboard must not leave an interval sweeping sockets forever —
    // the same lifecycle obligation the activity host has for plugin timers.
    let ticked = false;
    s.on("dashboard:activity", () => { ticked = true; });
    await new Promise((r) => setTimeout(r, 5000));
    expect(ticked).toBe(false);
  }, 15_000);
});
