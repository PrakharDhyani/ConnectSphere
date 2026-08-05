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

// Attachment descriptors arrive over the socket, so they are UNTRUSTED input —
// these lock down sanitizeAttachments (chat.handlers.js).
describe("chat attachments over sockets", () => {
  async function soloRoom(label) {
    const owner = await reg(label);
    const room = await createRoom(owner.token);
    const s = await connect(owner.token);
    await ack(s, "room:join", room.id);
    return { s, room };
  }

  it("sends an attachment-only message (sticker, no text)", async () => {
    const { s, room } = await soloRoom("StickerSender");
    const res = await ack(s, "message:send", {
      roomId: room.id,
      text: "",
      attachments: [{ kind: "sticker", stickerId: "fire" }],
    });
    expect(res.ok).toBe(true);
    expect(res.message.attachments).toEqual([{ kind: "sticker", stickerId: "fire" }]);
  });

  it("drops an unknown sticker id", async () => {
    const { s, room } = await soloRoom("BadSticker");
    const res = await ack(s, "message:send", {
      roomId: room.id,
      text: "hi",
      attachments: [{ kind: "sticker", stickerId: "definitely-not-real" }],
    });
    expect(res.ok).toBe(true);
    expect(res.message.attachments).toHaveLength(0);
  });

  it("accepts an upload URL from our own storage", async () => {
    const { s, room } = await soloRoom("UploadSender");
    const res = await ack(s, "message:send", {
      roomId: room.id,
      text: "",
      attachments: [
        { kind: "image", url: `http://localhost:9000/connectsphere/chat/${room.id}/x.png`, name: "x.png", mime: "image/png", size: 10 },
      ],
    });
    expect(res.ok).toBe(true);
    expect(res.message.attachments[0]).toMatchObject({ kind: "image", name: "x.png" });
  });

  it("rejects an upload URL pointing at a foreign host", async () => {
    const { s, room } = await soloRoom("EvilUpload");
    const res = await ack(s, "message:send", {
      roomId: room.id,
      text: "look",
      attachments: [{ kind: "image", url: "https://evil.example.com/payload.png" }],
    });
    expect(res.ok).toBe(true);
    expect(res.message.attachments).toHaveLength(0); // silently dropped, text kept
  });

  it("accepts a Tenor gif but rejects a gif from anywhere else", async () => {
    const { s, room } = await soloRoom("GifSender");
    const good = await ack(s, "message:send", {
      roomId: room.id,
      text: "",
      attachments: [{ kind: "gif", url: "https://media.tenor.com/abc123/funny.gif", width: 400, height: 300 }],
    });
    expect(good.message.attachments).toHaveLength(1);
    expect(good.message.attachments[0].kind).toBe("gif");

    const bad = await ack(s, "message:send", {
      roomId: room.id,
      text: "nope",
      attachments: [{ kind: "gif", url: "https://evil.example.com/tracker.gif" }],
    });
    expect(bad.message.attachments).toHaveLength(0);
  });

  // The built-in GIF ids exist in TWO places (backend whitelist + frontend
  // registry). They drift silently unless something checks — a picked GIF
  // would just vanish on send. This is that check.
  it("backend LOCAL_GIF_IDS matches the frontend registry exactly", async () => {
    const { readFileSync } = await import("node:fs");
    const handlers = readFileSync(
      new URL("../src/sockets/chat.handlers.js", import.meta.url),
      "utf8"
    );
    const registry = readFileSync(
      new URL("../../frontend/src/lib/localGifs.js", import.meta.url),
      "utf8"
    );

    const backendIds = new Set(
      (/const LOCAL_GIF_IDS = new Set\(\[([\s\S]*?)\]\)/.exec(handlers)?.[1] || "")
        .match(/"([^"]+)"/g)
        ?.map((s) => s.replaceAll('"', "")) || []
    );
    const frontendIds = new Set(
      [...registry.matchAll(/\{\s*id:\s*"(lg-[^"]+)"/g)].map((m) => m[1])
    );

    expect(frontendIds.size).toBeGreaterThan(0);
    expect([...frontendIds].filter((id) => !backendIds.has(id))).toEqual([]); // frontend-only → would be rejected
    expect([...backendIds].filter((id) => !frontendIds.has(id))).toEqual([]); // backend-only → dead entry
  });

  it("accepts a built-in reaction GIF by id and stores NO url", async () => {
    const { s, room } = await soloRoom("LocalGif");
    const res = await ack(s, "message:send", {
      roomId: room.id,
      text: "",
      // A malicious client sends both an id AND an inline svg payload — the id
      // must win and the payload must never be persisted.
      attachments: [
        { kind: "gif", gifId: "lg-lol", name: "LOL", url: "data:image/svg+xml,<svg onload=alert(1)>" },
      ],
    });
    expect(res.ok).toBe(true);
    expect(res.message.attachments[0]).toMatchObject({ kind: "gif", gifId: "lg-lol" });
    expect(res.message.attachments[0].url).toBeUndefined();
  });

  it("drops an unknown built-in gif id", async () => {
    const { s, room } = await soloRoom("BadLocalGif");
    const res = await ack(s, "message:send", {
      roomId: room.id,
      text: "hey",
      attachments: [{ kind: "gif", gifId: "lg-not-real" }],
    });
    expect(res.ok).toBe(true);
    expect(res.message.attachments).toHaveLength(0);
  });

  it("rejects a raw data: URI gif (no id)", async () => {
    const { s, room } = await soloRoom("DataUriGif");
    const res = await ack(s, "message:send", {
      roomId: room.id,
      text: "hi",
      attachments: [{ kind: "gif", url: "data:image/svg+xml,<svg onload=alert(1)></svg>" }],
    });
    expect(res.ok).toBe(true);
    expect(res.message.attachments).toHaveLength(0);
  });

  it("rejects a message that is empty after sanitisation", async () => {
    const { s, room } = await soloRoom("EmptyAfterClean");
    const res = await ack(s, "message:send", {
      roomId: room.id,
      text: "",
      attachments: [{ kind: "image", url: "https://evil.example.com/x.png" }],
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/empty/i);
  });

  it("caps attachments at 10 per message", async () => {
    const { s, room } = await soloRoom("TooMany");
    const res = await ack(s, "message:send", {
      roomId: room.id,
      text: "spam",
      attachments: Array.from({ length: 25 }, () => ({ kind: "sticker", stickerId: "love" })),
    });
    expect(res.ok).toBe(true);
    expect(res.message.attachments).toHaveLength(10);
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

describe("polls over sockets", () => {
  it("runs a full create → vote → retract → close cycle", async () => {
    const owner = await reg("PollOwner");
    const room = await createRoom(owner.token);
    const member = await reg("PollMember");
    await request(h.app).post("/api/rooms/join").set("Authorization", `Bearer ${member.token}`).send({ code: room.code });

    const s1 = await connect(owner.token);
    const s2 = await connect(member.token);
    await ack(s1, "room:join", room.id);
    await ack(s2, "room:join", room.id);

    // create broadcasts state to everyone in the room
    const got = once(s2, "poll:state");
    const createAck = await ack(s1, "poll:create", { roomId: room.id, question: "Pizza night?", options: ["Yes", "Obviously"] });
    expect(createAck.ok).toBe(true);
    const { poll } = await got;
    expect(poll.question).toBe("Pizza night?");
    expect(poll.options).toHaveLength(2);

    // a second concurrent poll is refused
    const dup = await ack(s2, "poll:create", { roomId: room.id, question: "Another?", options: ["a", "b"] });
    expect(dup.ok).toBe(false);

    // vote lands with voter identity; late joiners get it via poll:sync
    await ack(s2, "poll:vote", { roomId: room.id, optionIdx: 1 });
    const sync = await ack(s1, "poll:sync", room.id);
    expect(sync.poll.options[1].count).toBe(1);
    expect(sync.poll.options[1].voters[0].name).toBe("PollMember");

    // voting the same option again retracts it
    await ack(s2, "poll:vote", { roomId: room.id, optionIdx: 1 });
    const sync2 = await ack(s1, "poll:sync", room.id);
    expect(sync2.poll.totalVotes).toBe(0);

    // only the creator can close
    const memberClose = await ack(s2, "poll:close", { roomId: room.id });
    expect(memberClose.ok).toBe(false);
    const ownerClose = await ack(s1, "poll:close", { roomId: room.id });
    expect(ownerClose.ok).toBe(true);
    const sync3 = await ack(s1, "poll:sync", room.id);
    expect(sync3.poll.closed).toBe(true);
  });

  it("rejects invalid polls and outsiders", async () => {
    const owner = await reg("PollOwner2");
    const room = await createRoom(owner.token);
    const s1 = await connect(owner.token);
    await ack(s1, "room:join", room.id);

    expect((await ack(s1, "poll:create", { roomId: room.id, question: "", options: ["a", "b"] })).ok).toBe(false);
    expect((await ack(s1, "poll:create", { roomId: room.id, question: "Q", options: ["only one"] })).ok).toBe(false);

    // a socket that never joined the room can't create or vote
    const stranger = await reg("PollStranger");
    const s2 = await connect(stranger.token);
    expect((await ack(s2, "poll:create", { roomId: room.id, question: "Q", options: ["a", "b"] })).ok).toBe(false);
    expect((await ack(s2, "poll:vote", { roomId: room.id, optionIdx: 0 })).ok).toBe(false);
  });
});

describe("caption relay over sockets", () => {
  it("relays caption text to other room members but never the sender", async () => {
    const owner = await reg("CapOwner");
    const room = await createRoom(owner.token);
    const member = await reg("CapMember");
    await request(h.app).post("/api/rooms/join").set("Authorization", `Bearer ${member.token}`).send({ code: room.code });

    const s1 = await connect(owner.token);
    const s2 = await connect(member.token);
    await ack(s1, "room:join", room.id);
    await ack(s2, "room:join", room.id);

    const got = once(s2, "caption:new");
    s1.emit("caption:say", { roomId: room.id, text: "hello grandma", interim: false, lang: "en-US" });
    const cap = await got;
    expect(cap.text).toBe("hello grandma");
    expect(cap.name).toBe("CapOwner");
    expect(cap.interim).toBe(false);
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
