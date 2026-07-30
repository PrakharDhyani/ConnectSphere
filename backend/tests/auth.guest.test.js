import { describe, it, expect, beforeEach } from "@jest/globals";
import request from "supertest";
import { startHarness } from "./helpers/harness.js";

const h = startHarness();

const HOST = { name: "Host User", email: "host@example.com", password: "Password123" };

async function reg(user) {
  const res = await request(h.app).post("/api/auth/register").send(user);
  return res.body.data.accessToken;
}
const auth = (t) => ({ Authorization: `Bearer ${t}` });

let hostToken, roomId, code;

beforeEach(async () => {
  hostToken = await reg(HOST);
  const room = await request(h.app).post("/api/rooms").set(auth(hostToken)).send({ name: "Open Meeting" });
  roomId = room.body.data.room.id;
  code = room.body.data.room.code;
});

async function joinAsGuest(name = "Wanderer", useCode = code) {
  return request(h.app).post("/api/auth/guest").send({ name, code: useCode });
}

describe("POST /api/auth/guest", () => {
  it("creates an ephemeral guest and returns a room-scoped token", async () => {
    const res = await joinAsGuest();
    expect(res.status).toBe(201);
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    expect(res.body.data.user).toMatchObject({ name: "Wanderer", isGuest: true });
    expect(res.body.data.user).not.toHaveProperty("password");
    expect(res.body.data.room).toMatchObject({ id: roomId, code });
  });

  it("unknown code → 404, bad name/code → 400", async () => {
    expect((await joinAsGuest("Wanderer", "abc123")).status).toBe(404);
    expect((await joinAsGuest("x", code)).status).toBe(400); // name too short
    expect((await request(h.app).post("/api/auth/guest").send({ name: "Valid", code: "nothex!" })).status).toBe(400);
  });
});

describe("guest access is scoped to their meeting", () => {
  it("can read their room + its messages, and their own identity", async () => {
    const guest = (await joinAsGuest()).body.data.accessToken;

    expect((await request(h.app).get(`/api/rooms/${roomId}`).set(auth(guest))).status).toBe(200);
    expect((await request(h.app).get(`/api/rooms/${roomId}/messages`).set(auth(guest))).status).toBe(200);

    const me = await request(h.app).get("/api/users/me").set(auth(guest));
    expect(me.status).toBe(200);
    expect(me.body.data.user.isGuest).toBe(true);
  });

  it("cannot touch a DIFFERENT room (token is scoped)", async () => {
    const other = await request(h.app).post("/api/rooms").set(auth(hostToken)).send({ name: "Private" });
    const otherId = other.body.data.room.id;
    const guest = (await joinAsGuest()).body.data.accessToken;

    expect((await request(h.app).get(`/api/rooms/${otherId}`).set(auth(guest))).status).toBe(403);
    expect((await request(h.app).get(`/api/rooms/${otherId}/messages`).set(auth(guest))).status).toBe(403);
  });
});

describe("guests are blocked from registered-user actions (403)", () => {
  let guest;
  beforeEach(async () => {
    guest = (await joinAsGuest()).body.data.accessToken;
  });

  it("cannot create a room", async () => {
    expect((await request(h.app).post("/api/rooms").set(auth(guest)).send({ name: "Mine" })).status).toBe(403);
  });
  it("cannot list the dashboard rooms", async () => {
    expect((await request(h.app).get("/api/rooms").set(auth(guest))).status).toBe(403);
  });
  it("cannot join another room by code", async () => {
    expect((await request(h.app).post("/api/rooms/join").set(auth(guest)).send({ code })).status).toBe(403);
  });
  it("cannot edit a profile", async () => {
    expect((await request(h.app).patch("/api/users/me").set(auth(guest)).send({ name: "New" })).status).toBe(403);
  });
  it("cannot rename or delete the room", async () => {
    expect((await request(h.app).patch(`/api/rooms/${roomId}`).set(auth(guest)).send({ name: "X Y" })).status).toBe(403);
    expect((await request(h.app).delete(`/api/rooms/${roomId}`).set(auth(guest))).status).toBe(403);
  });
});
