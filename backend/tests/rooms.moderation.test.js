import { describe, it, expect, beforeEach } from "@jest/globals";
import request from "supertest";
import { startHarness } from "./helpers/harness.js";
import { Report } from "../src/models/Report.js";
import { canAccessRoom } from "../src/utils/roomAccess.js";

const h = startHarness();

const OWNER = { name: "Mia Mod", email: "mia@example.com", password: "Password123" };
const TROLL = { name: "Terry Troll", email: "terry@example.com", password: "Password123" };
const BYSTANDER = { name: "Bella By", email: "bella@example.com", password: "Password123" };

async function reg(app, user) {
  const res = await request(app).post("/api/auth/register").send(user);
  return { token: res.body.data.accessToken, id: res.body.data.user.id };
}
const auth = (t) => ({ Authorization: `Bearer ${t}` });

let owner, troll, bystander, roomId, code;

beforeEach(async () => {
  owner = await reg(h.app, OWNER);
  troll = await reg(h.app, TROLL);
  bystander = await reg(h.app, BYSTANDER);
  const created = await request(h.app).post("/api/rooms").set(auth(owner.token)).send({ name: "Mod Test Room" });
  roomId = created.body.data.room.id;
  code = created.body.data.room.code;
  await request(h.app).post("/api/rooms/join").set(auth(troll.token)).send({ code });
  await request(h.app).post("/api/rooms/join").set(auth(bystander.token)).send({ code });
});

describe("room rules", () => {
  it("owner sets rules; every member can read them", async () => {
    const res = await request(h.app)
      .put(`/api/rooms/${roomId}/rules`)
      .set(auth(owner.token))
      .send({ items: ["Be kind", "No spoilers", "  "] }); // blank is dropped

    expect(res.status).toBe(200);
    expect(res.body.data.rules).toEqual(["Be kind", "No spoilers"]);

    const asMember = await request(h.app).get(`/api/rooms/${roomId}`).set(auth(troll.token));
    expect(asMember.body.data.room.rules).toEqual(["Be kind", "No spoilers"]);
    expect(asMember.body.data.room.rulesUpdatedAt).toBeTruthy();
  });

  it("non-owners cannot set rules", async () => {
    const res = await request(h.app)
      .put(`/api/rooms/${roomId}/rules`)
      .set(auth(troll.token))
      .send({ items: ["My rules now"] });
    expect(res.status).toBe(403);
  });

  it("caps at 20 rules and 200 chars each", async () => {
    const res = await request(h.app)
      .put(`/api/rooms/${roomId}/rules`)
      .set(auth(owner.token))
      .send({ items: [...Array(30).keys()].map((i) => `rule ${i} ${"x".repeat(400)}`) });

    expect(res.status).toBe(200);
    expect(res.body.data.rules).toHaveLength(20);
    expect(res.body.data.rules.every((r) => r.length <= 200)).toBe(true);
  });

  it("records the reason on a ban and shows it to the owner only", async () => {
    await request(h.app)
      .post(`/api/rooms/${roomId}/ban`)
      .set(auth(owner.token))
      .send({ userId: troll.id, reason: "Rule 2: No spoilers" });

    const asOwner = await request(h.app).get(`/api/rooms/${roomId}`).set(auth(owner.token));
    const entry = asOwner.body.data.room.banned.find((b) => b.id === troll.id);
    expect(entry.reason).toBe("Rule 2: No spoilers");

    // The ban list (and its reasons) stays owner-only information.
    const asOther = await request(h.app).get(`/api/rooms/${roomId}`).set(auth(bystander.token));
    expect(asOther.body.data.room.banned).toBeUndefined();
  });
});

describe("kick", () => {
  it("owner kicks a member; they lose access but may rejoin by code", async () => {
    const res = await request(h.app).post(`/api/rooms/${roomId}/kick`).set(auth(owner.token)).send({ userId: troll.id });
    expect(res.status).toBe(200);
    expect(await canAccessRoom({ id: troll.id }, roomId)).toBe(false);
    // Kick is not a ban — the code still works.
    const rejoin = await request(h.app).post("/api/rooms/join").set(auth(troll.token)).send({ code });
    expect(rejoin.status).toBe(200);
    expect(await canAccessRoom({ id: troll.id }, roomId)).toBe(true);
  });

  it("non-owners cannot kick; owner cannot kick themselves", async () => {
    const nope = await request(h.app).post(`/api/rooms/${roomId}/kick`).set(auth(troll.token)).send({ userId: bystander.id });
    expect(nope.status).toBe(403);
    const self = await request(h.app).post(`/api/rooms/${roomId}/kick`).set(auth(owner.token)).send({ userId: owner.id });
    expect(self.status).toBe(400);
  });
});

describe("ban / unban", () => {
  it("banned users cannot rejoin by code and lose socket-level access", async () => {
    await request(h.app).post(`/api/rooms/${roomId}/ban`).set(auth(owner.token)).send({ userId: troll.id });
    expect(await canAccessRoom({ id: troll.id }, roomId)).toBe(false);
    const rejoin = await request(h.app).post("/api/rooms/join").set(auth(troll.token)).send({ code });
    expect(rejoin.status).toBe(403);
    expect(rejoin.body.error.message).toMatch(/banned/i);
  });

  it("ban blocks public-room joining too", async () => {
    const pub = await request(h.app).post("/api/rooms").set(auth(owner.token))
      .send({ name: "Public Mod Room", visibility: "public" });
    const pubId = pub.body.data.room.id;
    await request(h.app).post(`/api/rooms/${pubId}/join-public`).set(auth(troll.token));
    await request(h.app).post(`/api/rooms/${pubId}/ban`).set(auth(owner.token)).send({ userId: troll.id });
    const back = await request(h.app).post(`/api/rooms/${pubId}/join-public`).set(auth(troll.token));
    expect(back.status).toBe(403);
  });

  it("the owner sees the ban list (members don't) and unban restores access", async () => {
    await request(h.app).post(`/api/rooms/${roomId}/ban`).set(auth(owner.token)).send({ userId: troll.id });
    const asOwner = await request(h.app).get(`/api/rooms/${roomId}`).set(auth(owner.token));
    expect(asOwner.body.data.room.banned).toHaveLength(1);
    expect(asOwner.body.data.room.banned[0].name).toBe(TROLL.name);
    const asMember = await request(h.app).get(`/api/rooms/${roomId}`).set(auth(bystander.token));
    expect(asMember.body.data.room.banned).toBeUndefined();

    await request(h.app).post(`/api/rooms/${roomId}/unban`).set(auth(owner.token)).send({ userId: troll.id });
    const rejoin = await request(h.app).post("/api/rooms/join").set(auth(troll.token)).send({ code });
    expect(rejoin.status).toBe(200);
  });
});

describe("slow mode", () => {
  it("owner sets it (clamped to 0..120) and it appears in room detail", async () => {
    const res = await request(h.app).post(`/api/rooms/${roomId}/slowmode`).set(auth(owner.token)).send({ seconds: 15 });
    expect(res.status).toBe(200);
    expect(res.body.data.slowModeSec).toBe(15);
    const detail = await request(h.app).get(`/api/rooms/${roomId}`).set(auth(troll.token));
    expect(detail.body.data.room.slowModeSec).toBe(15);
    const big = await request(h.app).post(`/api/rooms/${roomId}/slowmode`).set(auth(owner.token)).send({ seconds: 9999 });
    expect(big.body.data.slowModeSec).toBe(120);
  });

  it("members cannot set slow mode", async () => {
    const res = await request(h.app).post(`/api/rooms/${roomId}/slowmode`).set(auth(troll.token)).send({ seconds: 5 });
    expect(res.status).toBe(403);
  });
});

describe("report", () => {
  it("a member files a report; duplicates within the hour are collapsed", async () => {
    const res = await request(h.app).post(`/api/rooms/${roomId}/report`).set(auth(bystander.token))
      .send({ userId: troll.id, reason: "spamming the chat" });
    expect(res.status).toBe(200);
    await request(h.app).post(`/api/rooms/${roomId}/report`).set(auth(bystander.token))
      .send({ userId: troll.id, reason: "again" });
    const reports = await Report.find({ room: roomId });
    expect(reports).toHaveLength(1);
    expect(reports[0].reportedName).toBe(TROLL.name);
    expect(reports[0].reason).toBe("spamming the chat");
  });

  it("outsiders cannot report; you cannot report yourself", async () => {
    const stranger = await reg(h.app, { name: "Sam Stranger", email: "sam@example.com", password: "Password123" });
    const nope = await request(h.app).post(`/api/rooms/${roomId}/report`).set(auth(stranger.token))
      .send({ userId: troll.id });
    expect(nope.status).toBe(403);
    const self = await request(h.app).post(`/api/rooms/${roomId}/report`).set(auth(troll.token))
      .send({ userId: troll.id });
    expect(self.status).toBe(400);
  });
});
