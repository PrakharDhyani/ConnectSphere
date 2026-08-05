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

  it("returns attachments alongside text", async () => {
    await Message.create({
      room: roomId,
      sender: alice.id,
      text: "",
      attachments: [{ kind: "sticker", stickerId: "fire" }],
    });

    const res = await request(h.app)
      .get(`/api/rooms/${roomId}/messages`)
      .set("Authorization", `Bearer ${alice.token}`);

    const last = res.body.data.messages.at(-1);
    expect(last.text).toBe("");
    expect(last.attachments).toEqual([{ kind: "sticker", stickerId: "fire" }]);
  });
});

describe("Message model content rule", () => {
  it("rejects a message with neither text nor attachments", async () => {
    await expect(Message.create({ room: roomId, sender: alice.id, text: "" })).rejects.toThrow(
      /text or an attachment/
    );
  });

  it("allows an attachment-only message (no text)", async () => {
    const doc = await Message.create({
      room: roomId,
      sender: alice.id,
      attachments: [{ kind: "gif", url: "https://media.tenor.com/abc.gif" }],
    });
    expect(doc.text).toBe("");
    expect(doc.attachments).toHaveLength(1);
  });

  it("caps attachments at 10", async () => {
    const many = Array.from({ length: 11 }, () => ({ kind: "sticker", stickerId: "love" }));
    await expect(
      Message.create({ room: roomId, sender: alice.id, text: "hi", attachments: many })
    ).rejects.toThrow(/Too many attachments/);
  });
});

describe("POST /api/rooms/:id/attachments", () => {
  const png = Buffer.from(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6300010000050001",
    "hex"
  );

  it("uploads files and returns descriptors", async () => {
    const res = await request(h.app)
      .post(`/api/rooms/${roomId}/attachments`)
      .set("Authorization", `Bearer ${alice.token}`)
      .attach("files", png, { filename: "shot.png", contentType: "image/png" });

    expect(res.status).toBe(201);
    expect(res.body.data.attachments).toHaveLength(1);
    expect(res.body.data.attachments[0]).toMatchObject({
      kind: "image",
      mime: "image/png",
      name: "shot.png",
    });
    expect(res.body.data.attachments[0].url).toContain(`/chat/${roomId}/`);
  });

  it("accepts several files in one request", async () => {
    const res = await request(h.app)
      .post(`/api/rooms/${roomId}/attachments`)
      .set("Authorization", `Bearer ${alice.token}`)
      .attach("files", png, { filename: "a.png", contentType: "image/png" })
      .attach("files", Buffer.from("hello"), { filename: "notes.txt", contentType: "text/plain" });

    expect(res.status).toBe(201);
    expect(res.body.data.attachments.map((a) => a.kind)).toEqual(["image", "file"]);
  });

  it("rejects a disallowed file type (400)", async () => {
    const res = await request(h.app)
      .post(`/api/rooms/${roomId}/attachments`)
      .set("Authorization", `Bearer ${alice.token}`)
      .attach("files", Buffer.from("MZ"), {
        filename: "virus.exe",
        contentType: "application/x-msdownload",
      });

    expect(res.status).toBe(400);
  });

  it("rejects a non-member with 403", async () => {
    const res = await request(h.app)
      .post(`/api/rooms/${roomId}/attachments`)
      .set("Authorization", `Bearer ${bob.token}`)
      .attach("files", png, { filename: "shot.png", contentType: "image/png" });

    expect(res.status).toBe(403);
  });

  it("400s when no file is attached", async () => {
    const res = await request(h.app)
      .post(`/api/rooms/${roomId}/attachments`)
      .set("Authorization", `Bearer ${alice.token}`);

    expect(res.status).toBe(400);
  });
});

// View-once must be enforced by the SERVER — a client-side flag would be
// theatre. These lock down "one open per viewer, then the url is gone".
describe("view-once attachments", () => {
  const VO_URL = "http://localhost:9000/connectsphere/chat/x/secret.png";

  async function seedViewOnce() {
    await request(h.app)
      .post("/api/rooms/join")
      .set("Authorization", `Bearer ${bob.token}`)
      .send({ code: (await Room.findById(roomId)).code });

    return Message.create({
      room: roomId,
      sender: alice.id,
      text: "",
      attachments: [{ kind: "image", url: VO_URL, mime: "image/png", viewOnce: true, viewedBy: [] }],
    });
  }

  it("hides the url in history until it is opened", async () => {
    await seedViewOnce();
    const res = await request(h.app)
      .get(`/api/rooms/${roomId}/messages`)
      .set("Authorization", `Bearer ${bob.token}`);

    const last = res.body.data.messages.at(-1);
    expect(last.attachments[0].viewOnce).toBe(true);
    expect(last.attachments[0].spent).toBe(false);
    // The url IS present until viewed (the client needs it only via /view),
    // but viewedBy must never leak.
    expect(last.attachments[0].viewedBy).toBeUndefined();
  });

  it("returns the url once, then 410s on a second open", async () => {
    const msg = await seedViewOnce();

    const first = await request(h.app)
      .post(`/api/rooms/${roomId}/messages/${msg._id}/view`)
      .set("Authorization", `Bearer ${bob.token}`)
      .send({ index: 0 });
    expect(first.status).toBe(200);
    expect(first.body.data.url).toBe(VO_URL);

    const second = await request(h.app)
      .post(`/api/rooms/${roomId}/messages/${msg._id}/view`)
      .set("Authorization", `Bearer ${bob.token}`)
      .send({ index: 0 });
    expect(second.status).toBe(410);
  });

  it("redacts the url from history after that viewer opened it", async () => {
    const msg = await seedViewOnce();
    await request(h.app)
      .post(`/api/rooms/${roomId}/messages/${msg._id}/view`)
      .set("Authorization", `Bearer ${bob.token}`)
      .send({ index: 0 });

    const res = await request(h.app)
      .get(`/api/rooms/${roomId}/messages`)
      .set("Authorization", `Bearer ${bob.token}`);
    const seen = res.body.data.messages.find((m) => m.id === msg._id.toString());
    expect(seen.attachments[0].spent).toBe(true);
    expect(seen.attachments[0].url).toBeUndefined();
  });

  it("the sender peeking does NOT consume the recipient's view", async () => {
    const msg = await seedViewOnce();

    const senderPeek = await request(h.app)
      .post(`/api/rooms/${roomId}/messages/${msg._id}/view`)
      .set("Authorization", `Bearer ${alice.token}`)
      .send({ index: 0 });
    expect(senderPeek.status).toBe(200);

    // Bob can still open it for the first time.
    const bobView = await request(h.app)
      .post(`/api/rooms/${roomId}/messages/${msg._id}/view`)
      .set("Authorization", `Bearer ${bob.token}`)
      .send({ index: 0 });
    expect(bobView.status).toBe(200);
    expect(bobView.body.data.url).toBe(VO_URL);
  });

  it("rejects a non-member and a non-view-once index", async () => {
    const msg = await seedViewOnce();
    const carol = await registerUser(h.app, {
      name: "Carol", email: `carol.vo.${Date.now()}@example.com`, password: "Password123",
    });

    const outsider = await request(h.app)
      .post(`/api/rooms/${roomId}/messages/${msg._id}/view`)
      .set("Authorization", `Bearer ${carol.token}`)
      .send({ index: 0 });
    expect(outsider.status).toBe(403);

    const badIndex = await request(h.app)
      .post(`/api/rooms/${roomId}/messages/${msg._id}/view`)
      .set("Authorization", `Bearer ${bob.token}`)
      .send({ index: 5 });
    expect(badIndex.status).toBe(400);
  });
});
