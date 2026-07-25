import { describe, it, expect } from "@jest/globals";
import request from "supertest";
import { startHarness } from "./helpers/harness.js";

const h = startHarness();

const ALICE = { name: "Alice Owner", email: "alice@example.com", password: "Password123" };
const BOB = { name: "Bob Joiner", email: "bob@example.com", password: "Password123" };

async function registerToken(app, user) {
  const res = await request(app).post("/api/auth/register").send(user);
  return res.body.data.accessToken;
}

async function createRoom(app, token, name = "Daily standup") {
  const res = await request(app)
    .post("/api/rooms")
    .set("Authorization", `Bearer ${token}`)
    .send({ name });
  return res;
}

describe("POST /api/rooms — create", () => {
  it("creates a room: 201, join code, owner counted as member", async () => {
    const token = await registerToken(h.app, ALICE);
    const res = await createRoom(h.app, token);

    expect(res.status).toBe(201);
    const { room } = res.body.data;
    expect(room.name).toBe("Daily standup");
    expect(room.code).toMatch(/^[0-9a-f]{6}$/); // 6 hex chars
    expect(room.memberCount).toBe(1); // the owner
  });

  it("rejects a too-short name → 400", async () => {
    const token = await registerToken(h.app, ALICE);
    const res = await createRoom(h.app, token, "x");
    expect(res.status).toBe(400);
  });

  it("rejects unauthenticated → 401", async () => {
    const res = await request(h.app).post("/api/rooms").send({ name: "Nope" });
    expect(res.status).toBe(401);
  });
});

describe("GET /api/rooms — list mine", () => {
  it("owner sees their room; a stranger sees an empty list", async () => {
    const alice = await registerToken(h.app, ALICE);
    const bob = await registerToken(h.app, BOB);
    await createRoom(h.app, alice);

    const aliceList = await request(h.app).get("/api/rooms").set("Authorization", `Bearer ${alice}`);
    expect(aliceList.body.data.rooms).toHaveLength(1);

    const bobList = await request(h.app).get("/api/rooms").set("Authorization", `Bearer ${bob}`);
    expect(bobList.body.data.rooms).toHaveLength(0);
  });
});

describe("POST /api/rooms/join — join by code", () => {
  it("joins with a valid code and the room appears in the list", async () => {
    const alice = await registerToken(h.app, ALICE);
    const bob = await registerToken(h.app, BOB);
    const { body } = await createRoom(h.app, alice);
    const code = body.data.room.code;

    const join = await request(h.app)
      .post("/api/rooms/join")
      .set("Authorization", `Bearer ${bob}`)
      .send({ code });

    expect(join.status).toBe(200);
    expect(join.body.data.room.memberCount).toBe(2);

    const bobList = await request(h.app).get("/api/rooms").set("Authorization", `Bearer ${bob}`);
    expect(bobList.body.data.rooms).toHaveLength(1);
  });

  it("is idempotent — joining twice doesn't duplicate membership", async () => {
    const alice = await registerToken(h.app, ALICE);
    const bob = await registerToken(h.app, BOB);
    const { body } = await createRoom(h.app, alice);
    const code = body.data.room.code;

    await request(h.app).post("/api/rooms/join").set("Authorization", `Bearer ${bob}`).send({ code });
    const again = await request(h.app)
      .post("/api/rooms/join")
      .set("Authorization", `Bearer ${bob}`)
      .send({ code });

    expect(again.status).toBe(200);
    expect(again.body.data.room.memberCount).toBe(2); // still 2, not 3
  });

  it("accepts an uppercase code (normalized)", async () => {
    const alice = await registerToken(h.app, ALICE);
    const bob = await registerToken(h.app, BOB);
    const { body } = await createRoom(h.app, alice);

    const join = await request(h.app)
      .post("/api/rooms/join")
      .set("Authorization", `Bearer ${bob}`)
      .send({ code: body.data.room.code.toUpperCase() });

    expect(join.status).toBe(200);
  });

  it("unknown code → 404; malformed code → 400", async () => {
    const bob = await registerToken(h.app, BOB);

    const unknown = await request(h.app)
      .post("/api/rooms/join")
      .set("Authorization", `Bearer ${bob}`)
      .send({ code: "abc123" });
    expect(unknown.status).toBe(404);

    const malformed = await request(h.app)
      .post("/api/rooms/join")
      .set("Authorization", `Bearer ${bob}`)
      .send({ code: "not-hex!" });
    expect(malformed.status).toBe(400);
  });
});

describe("GET /api/rooms/:id — membership gate", () => {
  it("member → 200; non-member → 403; malformed/unknown id → 404", async () => {
    const alice = await registerToken(h.app, ALICE);
    const bob = await registerToken(h.app, BOB);
    const { body } = await createRoom(h.app, alice);
    const roomId = body.data.room.id;

    const asOwner = await request(h.app)
      .get(`/api/rooms/${roomId}`)
      .set("Authorization", `Bearer ${alice}`);
    expect(asOwner.status).toBe(200);

    const asStranger = await request(h.app)
      .get(`/api/rooms/${roomId}`)
      .set("Authorization", `Bearer ${bob}`);
    expect(asStranger.status).toBe(403);

    const malformed = await request(h.app)
      .get("/api/rooms/not-an-id")
      .set("Authorization", `Bearer ${alice}`);
    expect(malformed.status).toBe(404);

    const unknown = await request(h.app)
      .get("/api/rooms/64b7f0000000000000000000")
      .set("Authorization", `Bearer ${alice}`);
    expect(unknown.status).toBe(404);
  });
});
