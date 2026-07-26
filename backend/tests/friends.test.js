import { describe, it, expect, beforeEach } from "@jest/globals";
import request from "supertest";
import { startHarness } from "./helpers/harness.js";

const h = startHarness();

const A = { name: "Aria", email: "aria@example.com", password: "Password123" };
const B = { name: "Bruno", email: "bruno@example.com", password: "Password123" };
const C = { name: "Cleo", email: "cleo@example.com", password: "Password123" };

async function reg(user) {
  const res = await request(h.app).post("/api/auth/register").send(user);
  return { token: res.body.data.accessToken, id: res.body.data.user.id };
}
const auth = (t) => ({ Authorization: `Bearer ${t}` });

let a, b, c;
beforeEach(async () => {
  a = await reg(A);
  b = await reg(B);
  c = await reg(C);
});

async function befriend(x, y) {
  await request(h.app).post("/api/friends/request").set(auth(x.token)).send({ userId: y.id });
  const reqs = await request(h.app).get("/api/friends/requests").set(auth(y.token));
  const id = reqs.body.data.incoming[0].id;
  await request(h.app).post(`/api/friends/requests/${id}/accept`).set(auth(y.token));
  return id;
}

describe("friend requests", () => {
  it("send → appears as incoming for recipient and outgoing for sender", async () => {
    const send = await request(h.app).post("/api/friends/request").set(auth(a.token)).send({ userId: b.id });
    expect(send.status).toBe(201);

    const bReqs = await request(h.app).get("/api/friends/requests").set(auth(b.token));
    expect(bReqs.body.data.incoming).toHaveLength(1);
    expect(bReqs.body.data.incoming[0].from).toMatchObject({ id: a.id, name: "Aria" });

    const aReqs = await request(h.app).get("/api/friends/requests").set(auth(a.token));
    expect(aReqs.body.data.outgoing).toHaveLength(1);
    expect(aReqs.body.data.outgoing[0].to.name).toBe("Bruno");
  });

  it("blocks self-friending, duplicates, and unknown users", async () => {
    expect((await request(h.app).post("/api/friends/request").set(auth(a.token)).send({ userId: a.id })).status).toBe(400);
    await request(h.app).post("/api/friends/request").set(auth(a.token)).send({ userId: b.id });
    expect((await request(h.app).post("/api/friends/request").set(auth(a.token)).send({ userId: b.id })).status).toBe(409);
    // reverse direction is also blocked as a duplicate
    expect((await request(h.app).post("/api/friends/request").set(auth(b.token)).send({ userId: a.id })).status).toBe(409);
    expect((await request(h.app).post("/api/friends/request").set(auth(a.token)).send({ userId: "64b7f0000000000000000000" })).status).toBe(404);
  });

  it("accept → both see each other in their friends list", async () => {
    await befriend(a, b);
    const aFriends = await request(h.app).get("/api/friends").set(auth(a.token));
    const bFriends = await request(h.app).get("/api/friends").set(auth(b.token));
    expect(aFriends.body.data.friends.map((f) => f.name)).toEqual(["Bruno"]);
    expect(bFriends.body.data.friends.map((f) => f.name)).toEqual(["Aria"]);
    // request no longer pending
    expect((await request(h.app).get("/api/friends/requests").set(auth(a.token))).body.data.outgoing).toHaveLength(0);
  });

  it("decline removes the pending request without befriending", async () => {
    await request(h.app).post("/api/friends/request").set(auth(a.token)).send({ userId: b.id });
    const reqs = await request(h.app).get("/api/friends/requests").set(auth(b.token));
    const id = reqs.body.data.incoming[0].id;
    expect((await request(h.app).delete(`/api/friends/requests/${id}`).set(auth(b.token))).status).toBe(200);
    expect((await request(h.app).get("/api/friends").set(auth(b.token))).body.data.friends).toHaveLength(0);
    expect((await request(h.app).get("/api/friends/requests").set(auth(b.token))).body.data.incoming).toHaveLength(0);
  });

  it("unfriend removes the friendship for both", async () => {
    await befriend(a, b);
    expect((await request(h.app).delete(`/api/friends/${b.id}`).set(auth(a.token))).status).toBe(200);
    expect((await request(h.app).get("/api/friends").set(auth(a.token))).body.data.friends).toHaveLength(0);
    expect((await request(h.app).get("/api/friends").set(auth(b.token))).body.data.friends).toHaveLength(0);
  });
});

describe("user search", () => {
  it("finds by name and annotates relationship", async () => {
    await request(h.app).post("/api/friends/request").set(auth(a.token)).send({ userId: b.id });
    const res = await request(h.app).get("/api/friends/search?q=bru").set(auth(a.token));
    expect(res.status).toBe(200);
    const bruno = res.body.data.users.find((u) => u.name === "Bruno");
    expect(bruno.relationship).toBe("outgoing"); // I sent B a request
  });

  it("excludes yourself from results", async () => {
    const res = await request(h.app).get("/api/friends/search?q=aria").set(auth(a.token));
    expect(res.body.data.users.map((u) => u.name)).not.toContain("Aria");
  });

  it("short query returns nothing", async () => {
    const res = await request(h.app).get("/api/friends/search?q=a").set(auth(a.token));
    expect(res.body.data.users).toHaveLength(0);
  });
});

describe("invite to room", () => {
  it("lets you invite a friend to a room you're in", async () => {
    await befriend(a, b);
    const room = await request(h.app).post("/api/rooms").set(auth(a.token)).send({ name: "Hangout" });
    const roomId = room.body.data.room.id;
    const res = await request(h.app).post("/api/friends/invite").set(auth(a.token)).send({ friendId: b.id, roomId });
    expect(res.status).toBe(200);
  });

  it("rejects inviting a non-friend (403)", async () => {
    const room = await request(h.app).post("/api/rooms").set(auth(a.token)).send({ name: "Private" });
    const res = await request(h.app).post("/api/friends/invite").set(auth(a.token)).send({ friendId: c.id, roomId: room.body.data.room.id });
    expect(res.status).toBe(403);
  });

  it("rejects inviting to a room you're not in (403)", async () => {
    await befriend(a, b);
    const room = await request(h.app).post("/api/rooms").set(auth(c.token)).send({ name: "Cleo's" });
    const res = await request(h.app).post("/api/friends/invite").set(auth(a.token)).send({ friendId: b.id, roomId: room.body.data.room.id });
    expect(res.status).toBe(403);
  });
});

describe("guests are blocked from friends", () => {
  it("a guest token gets 403 on friends endpoints", async () => {
    const room = await request(h.app).post("/api/rooms").set(auth(a.token)).send({ name: "Open" });
    const guest = await request(h.app).post("/api/auth/guest").send({ name: "Ghost", code: room.body.data.room.code });
    const gt = guest.body.data.accessToken;
    expect((await request(h.app).get("/api/friends").set(auth(gt))).status).toBe(403);
    expect((await request(h.app).post("/api/friends/request").set(auth(gt)).send({ userId: b.id })).status).toBe(403);
  });
});
