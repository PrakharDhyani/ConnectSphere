import { describe, it, expect, beforeEach } from "@jest/globals";
import request from "supertest";
import { startHarness } from "./helpers/harness.js";
import { Room } from "../src/models/Room.js";
import { Message } from "../src/models/Message.js";

const h = startHarness();

const OWNER = { name: "Olivia Owner", email: "olivia@example.com", password: "Password123" };
const MEMBER = { name: "Max Member", email: "max@example.com", password: "Password123" };
const OUTSIDER = { name: "Otto Outsider", email: "otto@example.com", password: "Password123" };

async function reg(app, user) {
  const res = await request(app).post("/api/auth/register").send(user);
  return { token: res.body.data.accessToken, id: res.body.data.user.id };
}

const auth = (t) => ({ Authorization: `Bearer ${t}` });

let owner, member, outsider, roomId, code;

beforeEach(async () => {
  owner = await reg(h.app, OWNER);
  member = await reg(h.app, MEMBER);
  outsider = await reg(h.app, OUTSIDER);

  const created = await request(h.app).post("/api/rooms").set(auth(owner.token)).send({ name: "Standup" });
  roomId = created.body.data.room.id;
  code = created.body.data.room.code;

  await request(h.app).post("/api/rooms/join").set(auth(member.token)).send({ code });
});

describe("GET /api/rooms/:id — member list detail", () => {
  it("returns members with owner flag and isOwner for the caller", async () => {
    const res = await request(h.app).get(`/api/rooms/${roomId}`).set(auth(owner.token));
    expect(res.status).toBe(200);

    const room = res.body.data.room;
    expect(room.isOwner).toBe(true);
    expect(room.members).toHaveLength(2);

    const ownerEntry = room.members.find((m) => m.isOwner);
    expect(ownerEntry.name).toBe(OWNER.name);
    expect(room.members.every((m) => "avatarUrl" in m)).toBe(true);
  });

  it("a member sees isOwner=false", async () => {
    const res = await request(h.app).get(`/api/rooms/${roomId}`).set(auth(member.token));
    expect(res.body.data.room.isOwner).toBe(false);
  });
});

describe("PATCH /api/rooms/:id — rename (owner only)", () => {
  it("owner renames the room", async () => {
    const res = await request(h.app).patch(`/api/rooms/${roomId}`).set(auth(owner.token)).send({ name: "Daily Sync" });
    expect(res.status).toBe(200);
    expect(res.body.data.room.name).toBe("Daily Sync");

    const check = await request(h.app).get(`/api/rooms/${roomId}`).set(auth(owner.token));
    expect(check.body.data.room.name).toBe("Daily Sync");
  });

  it("a non-owner member cannot rename → 403", async () => {
    const res = await request(h.app).patch(`/api/rooms/${roomId}`).set(auth(member.token)).send({ name: "Hijacked" });
    expect(res.status).toBe(403);
  });

  it("rejects an invalid name → 400, unknown id → 404, no auth → 401", async () => {
    expect((await request(h.app).patch(`/api/rooms/${roomId}`).set(auth(owner.token)).send({ name: "x" })).status).toBe(400);
    expect((await request(h.app).patch("/api/rooms/64b7f0000000000000000000").set(auth(owner.token)).send({ name: "Valid Name" })).status).toBe(404);
    expect((await request(h.app).patch(`/api/rooms/${roomId}`).send({ name: "Valid Name" })).status).toBe(401);
  });
});

describe("POST /api/rooms/:id/leave", () => {
  it("a member leaves and the room drops from their list", async () => {
    const res = await request(h.app).post(`/api/rooms/${roomId}/leave`).set(auth(member.token));
    expect(res.status).toBe(200);

    const list = await request(h.app).get("/api/rooms").set(auth(member.token));
    expect(list.body.data.rooms).toHaveLength(0);

    const detail = await request(h.app).get(`/api/rooms/${roomId}`).set(auth(owner.token));
    expect(detail.body.data.room.members).toHaveLength(1); // just the owner now
  });

  it("the owner cannot leave → 400", async () => {
    const res = await request(h.app).post(`/api/rooms/${roomId}/leave`).set(auth(owner.token));
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/rooms/:id — delete (owner only)", () => {
  it("a non-owner cannot delete → 403", async () => {
    const res = await request(h.app).delete(`/api/rooms/${roomId}`).set(auth(member.token));
    expect(res.status).toBe(403);
    expect((await request(h.app).get(`/api/rooms/${roomId}`).set(auth(owner.token))).status).toBe(200);
  });

  it("owner deletes the room and its messages", async () => {
    await Message.create({ room: roomId, sender: owner.id, text: "hi" });

    const res = await request(h.app).delete(`/api/rooms/${roomId}`).set(auth(owner.token));
    expect(res.status).toBe(200);

    // Room gone…
    expect((await request(h.app).get(`/api/rooms/${roomId}`).set(auth(owner.token))).status).toBe(404);
    // …and its messages cleaned up.
    expect(await Message.countDocuments({ room: roomId })).toBe(0);
    expect(await Room.countDocuments({ _id: roomId })).toBe(0);
  });

  it("unknown/malformed id → 404", async () => {
    expect((await request(h.app).delete("/api/rooms/64b7f0000000000000000000").set(auth(owner.token))).status).toBe(404);
    expect((await request(h.app).delete("/api/rooms/not-an-id").set(auth(owner.token))).status).toBe(404);
  });
});
