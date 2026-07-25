import { describe, it, expect, beforeEach } from "@jest/globals";
import request from "supertest";
import { startHarness } from "./helpers/harness.js";
import { Room } from "../src/models/Room.js";
import { Message } from "../src/models/Message.js";

const h = startHarness();

const ALICE = { name: "Alice", email: "alice.msg@example.com", password: "Password123" };
const BOB = { name: "Bob", email: "bob.msg@example.com", password: "Password123" };

async function registerUser(app, user) {
  const res = await request(app).post("/api/auth/register").send(user);
  return { token: res.body.data.accessToken, id: res.body.data.user.id };
}

let alice, bob, roomId;

// Seed a room owned by Alice plus 5 messages with controlled timestamps
// (timestamps:false lets us set createdAt explicitly for deterministic paging).
beforeEach(async () => {
  alice = await registerUser(h.app, ALICE);
  bob = await registerUser(h.app, BOB);
  const created = await request(h.app)
    .post("/api/rooms")
    .set("Authorization", `Bearer ${alice.token}`)
    .send({ name: "Chat Room" });
  roomId = created.body.data.room.id;

  const base = new Date("2026-01-01T00:00:00.000Z").getTime();
  await Message.insertMany(
    [1, 2, 3, 4, 5].map((n) => ({
      room: roomId,
      sender: alice.id,
      text: `msg ${n}`,
      createdAt: new Date(base + n * 1000),
      updatedAt: new Date(base + n * 1000),
    })),
    { timestamps: false }
  );
});

describe("GET /api/rooms/:id/messages", () => {
  it("returns history oldest→newest for a member", async () => {
    const res = await request(h.app)
      .get(`/api/rooms/${roomId}/messages`)
      .set("Authorization", `Bearer ${alice.token}`);

    expect(res.status).toBe(200);
    const texts = res.body.data.messages.map((m) => m.text);
    expect(texts).toEqual(["msg 1", "msg 2", "msg 3", "msg 4", "msg 5"]);
    // sender is populated with display fields
    expect(res.body.data.messages[0].sender).toMatchObject({ name: "Alice" });
  });

  it("respects limit (returns the newest N, still chronological)", async () => {
    const res = await request(h.app)
      .get(`/api/rooms/${roomId}/messages?limit=2`)
      .set("Authorization", `Bearer ${alice.token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.messages.map((m) => m.text)).toEqual(["msg 4", "msg 5"]);
  });

  it("paginates with ?before= (keyset)", async () => {
    const before = new Date("2026-01-01T00:00:04.000Z").toISOString(); // < msg 4
    const res = await request(h.app)
      .get(`/api/rooms/${roomId}/messages?before=${before}`)
      .set("Authorization", `Bearer ${alice.token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.messages.map((m) => m.text)).toEqual(["msg 1", "msg 2", "msg 3"]);
  });

  it("lets a joined member read history too", async () => {
    await request(h.app)
      .post("/api/rooms/join")
      .set("Authorization", `Bearer ${bob.token}`)
      .send({ code: (await Room.findById(roomId)).code });

    const res = await request(h.app)
      .get(`/api/rooms/${roomId}/messages`)
      .set("Authorization", `Bearer ${bob.token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.messages).toHaveLength(5);
  });

  it("blocks a non-member with 403", async () => {
    const res = await request(h.app)
      .get(`/api/rooms/${roomId}/messages`)
      .set("Authorization", `Bearer ${bob.token}`);
    expect(res.status).toBe(403);
  });

  it("401 without a token, 404 for unknown/malformed room id", async () => {
    expect((await request(h.app).get(`/api/rooms/${roomId}/messages`)).status).toBe(401);

    const unknown = await request(h.app)
      .get("/api/rooms/64b7f0000000000000000000/messages")
      .set("Authorization", `Bearer ${alice.token}`);
    expect(unknown.status).toBe(404);

    const malformed = await request(h.app)
      .get("/api/rooms/not-an-id/messages")
      .set("Authorization", `Bearer ${alice.token}`);
    expect(malformed.status).toBe(404);
  });
});
