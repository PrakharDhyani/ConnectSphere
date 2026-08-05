import { describe, it, expect, beforeAll, afterAll, afterEach } from "@jest/globals";
import http from "http";
import request from "supertest";
import { io as ioClient } from "socket.io-client";
import { startHarness } from "./helpers/harness.js";

// Boots the REAL app + Socket.io server on an ephemeral port and drives it with
// real socket.io-client connections â€” the first automated coverage of the
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

// Display names are unique in this app, so a helper that registers the SAME
// logical person in several tests needs a salt. Kept separate from reg() so
// existing tests that assert an exact name keep working.
const uniq = (name) => `${name}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
const regUnique = (name) => reg(uniq(name));
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

// Attachment descriptors arrive over the socket, so they are UNTRUSTED input â€”
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

  it("accepts OtakuGIFs and Klipy CDN gifs", async () => {
    const { s, room } = await soloRoom("ProviderGifs");
    for (const url of [
      "https://cdn.otakugifs.xyz/gifs/laugh/abc123.gif",
      "https://cdn.klipy.com/gif/xyz.gif",   // subdomain suffix rule
      "https://media.klipy.com/a/b.gif",
    ]) {
      const res = await ack(s, "message:send", {
        roomId: room.id, text: "", attachments: [{ kind: "gif", url }],
      });
      expect(res.ok).toBe(true);
      expect(res.message.attachments).toHaveLength(1);
    }
  });

  // A suffix rule is only safe if it anchors on a dot â€” "evilklipy.com" and
  // "klipy.com.evil.net" must both lose.
  it("cannot be fooled by lookalike domains", async () => {
    const { s, room } = await soloRoom("Lookalike");
    for (const url of [
      "https://evilklipy.com/x.gif",           // suffix without the dot
      "https://klipy.com.evil.net/x.gif",      // domain as a prefix
      "https://notklipy.com/x.gif",
      "https://cdn.otakugifs.xyz.evil.com/x.gif",
      "http://cdn.klipy.com/x.gif",            // plain http
    ]) {
      const res = await ack(s, "message:send", {
        roomId: room.id, text: "hmm", attachments: [{ kind: "gif", url }],
      });
      expect(res.ok).toBe(true);
      expect(res.message.attachments).toHaveLength(0);
    }
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
  // registry). They drift silently unless something checks â€” a picked GIF
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
    expect([...frontendIds].filter((id) => !backendIds.has(id))).toEqual([]); // frontend-only â†’ would be rejected
    expect([...backendIds].filter((id) => !frontendIds.has(id))).toEqual([]); // backend-only â†’ dead entry
  });

  // The frontend's OtakuGIFs reaction names must be real upstream categories,
  // or a search silently returns nothing (this exact bug shipped once: "think"
  // is a Gifukai action, not an OtakuGIFs one). Offline-safe: skipped when the
  // network is unavailable so CI never fails on a third party being down.
  it("OtakuGIFs reaction names are all real upstream categories", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(
      new URL("../../frontend/src/lib/gifs.js", import.meta.url),
      "utf8"
    );
    const block = /const OTAKU_REACTIONS = \[([\s\S]*?)\n\];/.exec(src)?.[1] || "";
    const names = [...block.matchAll(/\["([^"]+)",/g)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(20);

    let upstream;
    try {
      const res = await fetch("https://api.otakugifs.xyz/gif/allreactions", {
        signal: AbortSignal.timeout(8000),
      });
      upstream = new Set((await res.json()).reactions);
    } catch {
      console.warn("OtakuGIFs unreachable â€” skipping upstream name check");
      return;
    }
    expect(names.filter((n) => !upstream.has(n))).toEqual([]);
  }, 20000);

  it("accepts a built-in reaction GIF by id and stores NO url", async () => {
    const { s, room } = await soloRoom("LocalGif");
    const res = await ack(s, "message:send", {
      roomId: room.id,
      text: "",
      // A malicious client sends both an id AND an inline svg payload â€” the id
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

  it("accepts a voice note with duration and waveform", async () => {
    const { s, room } = await soloRoom("VoiceNote");
    const res = await ack(s, "message:send", {
      roomId: room.id,
      text: "",
      attachments: [{
        kind: "audio", voice: true,
        url: "http://localhost:9000/connectsphere/chat/x/note.webm",
        mime: "audio/webm", durationMs: 4200,
        waveform: [10, 50, 90, 30],
      }],
    });
    expect(res.ok).toBe(true);
    expect(res.message.attachments[0]).toMatchObject({ kind: "audio", voice: true, durationMs: 4200 });
    expect(res.message.attachments[0].waveform).toEqual([10, 50, 90, 30]);
  });

  it("clamps a hostile waveform instead of storing it verbatim", async () => {
    const { s, room } = await soloRoom("BadWave");
    const res = await ack(s, "message:send", {
      roomId: room.id,
      text: "",
      attachments: [{
        kind: "audio", voice: true,
        url: "http://localhost:9000/connectsphere/chat/x/n.webm",
        // 500 values, wildly out of range, plus junk
        waveform: [...Array(500).keys()].map((i) => (i % 2 ? 99999 : -50)),
      }],
    });
    expect(res.ok).toBe(true);
    const w = res.message.attachments[0].waveform;
    expect(w.length).toBe(64);                      // capped
    expect(Math.max(...w)).toBeLessThanOrEqual(100); // clamped
    expect(Math.min(...w)).toBeGreaterThanOrEqual(0);
  });

  it("never broadcasts a view-once url, and ignores client-supplied viewedBy", async () => {
    const { s, room } = await soloRoom("ViewOnceSock");
    const res = await ack(s, "message:send", {
      roomId: room.id,
      text: "",
      attachments: [{
        kind: "image",
        url: "http://localhost:9000/connectsphere/chat/x/secret.png",
        viewOnce: true,
        viewedBy: ["deadbeefdeadbeefdeadbeef"], // must be ignored
      }],
    });
    expect(res.ok).toBe(true);
    const a = res.message.attachments[0];
    expect(a.viewOnce).toBe(true);
    expect(a.url).toBeUndefined();       // stripped from the broadcast
    expect(a.viewedBy).toBeUndefined();  // never echoed back
  });

  it("ignores viewOnce on a non-visual attachment", async () => {
    const { s, room } = await soloRoom("ViewOnceFile");
    const res = await ack(s, "message:send", {
      roomId: room.id,
      text: "",
      attachments: [{
        kind: "file", url: "http://localhost:9000/connectsphere/chat/x/doc.pdf", viewOnce: true,
      }],
    });
    expect(res.ok).toBe(true);
    expect(res.message.attachments[0].viewOnce).toBeUndefined();
    expect(res.message.attachments[0].url).toBeTruthy(); // still a normal file
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

// Message actions are all permission decisions, so these lock down WHO may do
// WHAT â€” the part a client could otherwise just lie about.
describe("message actions over sockets", () => {
  async function twoPersonRoom(label, { visibility } = {}) {
    const owner = await regUnique(`${label}Own`);
    // Room names are unique too â€” salt them so re-runs don't collide.
    const roomName = `${label}Room_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const room = await createRoom(owner.token, roomName);
    if (visibility === "public") {
      // Visibility isn't settable via PATCH, so flip it directly â€” this test
      // is about forwarding rules, not about how a room becomes public.
      const { Room } = await import("../src/models/Room.js");
      await Room.updateOne({ _id: room.id }, { visibility: "public" });
    }
    const member = await regUnique(`${label}Mem`);
    await request(h.app).post("/api/rooms/join")
      .set("Authorization", `Bearer ${member.token}`).send({ code: room.code });

    const os = await connect(owner.token);
    const ms = await connect(member.token);
    await ack(os, "room:join", room.id);
    await ack(ms, "room:join", room.id);
    return { owner, member, room, os, ms };
  }

  const say = (s, roomId, text) => ack(s, "message:send", { roomId, text });

  it("edits your own message and broadcasts it", async () => {
    const { room, os, ms } = await twoPersonRoom("Edit");
    const sent = await say(os, room.id, "helo");
    const heard = once(ms, "message:edited");
    const res = await ack(os, "message:edit", { roomId: room.id, messageId: sent.message.id, text: "hello" });
    expect(res.ok).toBe(true);
    const ev = await heard;
    expect(ev.text).toBe("hello");
    expect(ev.editedAt).toBeTruthy();
  });

  it("refuses to edit someone else's message", async () => {
    const { room, os, ms } = await twoPersonRoom("EditOther");
    const sent = await say(os, room.id, "mine");
    const res = await ack(ms, "message:edit", { roomId: room.id, messageId: sent.message.id, text: "hacked" });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/your own/i);
  });

  it("delete-for-everyone tombstones the message for the author", async () => {
    const { room, os, ms } = await twoPersonRoom("DelAll");
    const sent = await say(os, room.id, "oops");
    const heard = once(ms, "message:deleted");
    const res = await ack(os, "message:delete", { roomId: room.id, messageId: sent.message.id, scope: "everyone" });
    expect(res.ok).toBe(true);
    expect((await heard).scope).toBe("everyone");
  });

  it("lets the ROOM OWNER delete a member's message (moderation)", async () => {
    const { room, os, ms } = await twoPersonRoom("DelMod");
    const sent = await say(ms, room.id, "spam spam");
    const res = await ack(os, "message:delete", { roomId: room.id, messageId: sent.message.id, scope: "everyone" });
    expect(res.ok).toBe(true);
  });

  it("refuses delete-for-everyone by a non-author, non-owner", async () => {
    const { room, os, ms, member } = await twoPersonRoom("DelNo");
    const third = await regUnique("DelThird");
    await request(h.app).post("/api/rooms/join")
      .set("Authorization", `Bearer ${third.token}`).send({ code: room.code });
    const ts = await connect(third.token);
    await ack(ts, "room:join", room.id);

    const sent = await say(ms, room.id, "not yours");
    const res = await ack(ts, "message:delete", { roomId: room.id, messageId: sent.message.id, scope: "everyone" });
    expect(res.ok).toBe(false);
    expect(member).toBeTruthy();
  });

  it("delete-for-me hides it only from that user's history", async () => {
    const { room, os, ms, owner, member } = await twoPersonRoom("DelMe");
    const sent = await say(os, room.id, "just for me");
    const res = await ack(ms, "message:delete", { roomId: room.id, messageId: sent.message.id, scope: "me" });
    expect(res.ok).toBe(true);

    const hidden = await request(h.app).get(`/api/rooms/${room.id}/messages`)
      .set("Authorization", `Bearer ${member.token}`);
    expect(hidden.body.data.messages.some((m) => m.id === sent.message.id)).toBe(false);

    const visible = await request(h.app).get(`/api/rooms/${room.id}/messages`)
      .set("Authorization", `Bearer ${owner.token}`);
    expect(visible.body.data.messages.some((m) => m.id === sent.message.id)).toBe(true);
  });

  it("only the room owner can pin", async () => {
    const { room, os, ms } = await twoPersonRoom("Pin");
    const sent = await say(os, room.id, "important");

    const denied = await ack(ms, "message:pin", { roomId: room.id, messageId: sent.message.id, pinned: true });
    expect(denied.ok).toBe(false);

    const heard = once(ms, "message:pinned");
    const allowed = await ack(os, "message:pin", { roomId: room.id, messageId: sent.message.id, pinned: true });
    expect(allowed.ok).toBe(true);
    expect((await heard).pinned).toBe(true);
  });

  it("refuses to forward OUT OF a private room", async () => {
    const { room, os } = await twoPersonRoom("FwdPriv");
    const other = await createRoom((await regUnique("FwdDest")).token, uniq("FwdDestRoom"));
    const sent = await say(os, room.id, "secret");
    const res = await ack(os, "message:forward", { roomId: room.id, messageId: sent.message.id, toRoomId: other.id });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/public/i);
  });

  it("forwards out of a PUBLIC room and tags the origin", async () => {
    const { room, os, owner } = await twoPersonRoom("FwdPub", { visibility: "public" });
    const dest = await createRoom(owner.token, `FwdPubDest_${Date.now()}`);
    const sent = await say(os, room.id, "shareable");

    const res = await ack(os, "message:forward", { roomId: room.id, messageId: sent.message.id, toRoomId: dest.id });
    expect(res.ok).toBe(true);
    expect(res.message.text).toBe("shareable");
    expect(res.message.forwardedFrom?.roomName).toContain("FwdPubRoom");
    expect(res.message.forwardedFrom?.roomId).toBe(room.id);
  });
});

describe("call presence + ring", () => {
  it("reports an empty call and refuses to ring when not in it", async () => {
    const owner = await regUnique("RingOwn");
    const room = await createRoom(owner.token);
    const mate = await regUnique("RingMate");
    await request(h.app).post("/api/rooms/join")
      .set("Authorization", `Bearer ${mate.token}`).send({ code: room.code });

    const s = await connect(owner.token);
    await ack(s, "room:join", room.id);

    const state = await ack(s, "call:get", room.id);
    expect(state.active).toBe(false);
    expect(state.count).toBe(0);

    // Not in the call â†’ cannot ring anyone.
    const rung = await ack(s, "call:ring", { roomId: room.id, userIds: [mate.id] });
    expect(rung.error).toMatch(/join the call/i);
  });

  it("room:join reports current call state to a late joiner", async () => {
    const owner = await regUnique("LateOwn");
    const room = await createRoom(owner.token);
    const s = await connect(owner.token);
    const joined = await ack(s, "room:join", room.id);
    expect(joined.ok).toBe(true);
    expect(joined.call).toEqual({ active: false, participants: [], count: 0 });
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
  it("runs a full create â†’ vote â†’ retract â†’ close cycle", async () => {
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

    // not ready â†’ start blocked
    let res = await ack(s1, "game:start", { roomId: room.id, rounds: 1 });
    expect(res.error).toBeTruthy();

    // both ready â†’ start ok
    s1.emit("game:ready", { roomId: room.id, ready: true });
    s2.emit("game:ready", { roomId: room.id, ready: true });
    await new Promise((r) => setTimeout(r, 150));
    res = await ack(s1, "game:start", { roomId: room.id, rounds: 1 });
    expect(res.ok).toBe(true);
  });
});
