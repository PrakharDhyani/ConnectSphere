import { describe, it, expect, beforeAll, afterAll, afterEach } from "@jest/globals";
import http from "http";
import request from "supertest";
import { io as ioClient } from "socket.io-client";
import { startHarness } from "./helpers/harness.js";

// Boots the REAL app + Socket.io server on an ephemeral port and drives it with
// real socket.io-client connections — the first automated coverage of the
// real-time layer (auth, chat, whiteboard, game lobby).
const h = startHarness();

let server;
let ioServer;
let port;
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

async function reg(name) {
  const email = `sock_${name}_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`;
  const res = await request(h.app).post("/api/auth/register").send({ name, email, password: "Password123" });
  return { token: res.body.data.accessToken, id: res.body.data.user.id };
}
async function createRoom(token, name = "Room") {
  const res = await request(h.app).post("/api/rooms").set("Authorization", `Bearer ${token}`).send({ name });
  return res.body.data.room;
}
function connect(token) {
  return new Promise((resolve, reject) => {
    const s = ioClient(`http://localhost:${port}`, { auth: { token }, transports: ["websocket"], reconnection: false });
    clients.push(s);
    s.once("connect", () => resolve(s));
    s.once("connect_error", (e) => reject(e));
    setTimeout(() => reject(new Error("connect timeout")), 4000);
  });
}
const ack = (s, ev, arg) => new Promise((r) => s.emit(ev, arg, r));
const once = (s, ev, ms = 3000) =>
  Promise.race([
    new Promise((r) => s.once(ev, r)),
    new Promise((_, x) => setTimeout(() => x(new Error(`no ${ev}`)), ms)),
  ]);

describe("socket auth", () => {
  it("rejects a connection with no token", async () => {
    await expect(connect(undefined)).rejects.toThrow();
  });
  it("rejects a garbage token", async () => {
    await expect(connect("not.a.jwt")).rejects.toThrow();
  });
  it("accepts a valid access token", async () => {
    const a = await reg("Ada");
    const s = await connect(a.token);
    expect(s.connected).toBe(true);
  });
});

describe("chat over sockets", () => {
  it("broadcasts a message to other room members", async () => {
    const owner = await reg("Owner");
    const room = await createRoom(owner.token);
    const member = await reg("Member");
    await request(h.app).post("/api/rooms/join").set("Authorization", `Bearer ${member.token}`).send({ code: room.code });

    const s1 = await connect(owner.token);
    const s2 = await connect(member.token);
    await ack(s1, "room:join", room.id);
    await ack(s2, "room:join", room.id);

    const got = once(s2, "message:new");
    const sendAck = await ack(s1, "message:send", { roomId: room.id, text: "hello" });
    expect(sendAck.ok).toBe(true);
    const msg = await got;
    expect(msg.text).toBe("hello");
    expect(msg.sender.name).toBe("Owner");
  });

  it("blocks a non-member from joining", async () => {
    const owner = await reg("Owner2");
    const room = await createRoom(owner.token);
    const stranger = await reg("Stranger");
    const s = await connect(stranger.token);
    const res = await ack(s, "room:join", room.id);
    expect(res.ok).toBe(false);
  });
});

describe("whiteboard over sockets", () => {
  it("syncs an update to another viewer and rejects non-members", async () => {
    const owner = await reg("WbOwner");
    const room = await createRoom(owner.token);
    const member = await reg("WbMember");
    await request(h.app).post("/api/rooms/join").set("Authorization", `Bearer ${member.token}`).send({ code: room.code });

    const s1 = await connect(owner.token);
    const s2 = await connect(member.token);
    await ack(s1, "room:join", room.id);
    await ack(s2, "room:join", room.id);
    await ack(s1, "whiteboard:join", room.id);
    await ack(s2, "whiteboard:join", room.id);

    const got = once(s2, "whiteboard:update");
    s1.emit("whiteboard:update", { roomId: room.id, elements: [{ id: "r1", type: "rectangle", version: 1 }] });
    const update = await got;
    expect(update.elements).toHaveLength(1);

    // non-member is refused
    const stranger = await reg("WbStranger");
    const s3 = await connect(stranger.token);
    const res = await ack(s3, "whiteboard:join", room.id);
    expect(res.error).toBeTruthy();
  });
});

describe("game lobby over sockets", () => {
  it("only starts once all players are ready (2+)", async () => {
    const owner = await reg("GOwner");
    const room = await createRoom(owner.token);
    const member = await reg("GMember");
    await request(h.app).post("/api/rooms/join").set("Authorization", `Bearer ${member.token}`).send({ code: room.code });

    const s1 = await connect(owner.token);
    const s2 = await connect(member.token);
    await ack(s1, "room:join", room.id);
    await ack(s2, "room:join", room.id);
    s1.emit("game:join", { roomId: room.id });
    s2.emit("game:join", { roomId: room.id });
    await new Promise((r) => setTimeout(r, 150));

    // not ready → start blocked
    let res = await ack(s1, "game:start", { roomId: room.id, rounds: 1 });
    expect(res.error).toBeTruthy();

    // both ready → start ok
    s1.emit("game:ready", { roomId: room.id, ready: true });
    s2.emit("game:ready", { roomId: room.id, ready: true });
    await new Promise((r) => setTimeout(r, 150));
    res = await ack(s1, "game:start", { roomId: room.id, rounds: 1 });
    expect(res.ok).toBe(true);
  });
});
