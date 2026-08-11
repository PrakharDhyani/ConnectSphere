/**
 * Direct messages over sockets — the live delivery half.
 *
 * The REST suite (dm.test.js) covers opening threads, history, unread counts
 * and blocking. This one covers the part REST cannot: that a message actually
 * ARRIVES on the other person's screen, and arrives in the right places.
 *
 * The design decision under test is delivery to `user:<id>` personal rooms
 * rather than a socket.io room per conversation. That is what makes a DM land
 * while the recipient is looking at something else entirely — an inbox that
 * only delivered to people with the thread already open would not be an inbox.
 * It is also what makes multi-device work, so both are asserted.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "@jest/globals";
import http from "http";
import request from "supertest";
import { io as ioClient } from "socket.io-client";
import { startHarness } from "./helpers/harness.js";

const h = startHarness();

let server, ioServer, port;
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

const uniq = (n) => `${n}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
const auth = (t) => ({ Authorization: `Bearer ${t}` });

async function reg(name) {
  const email = `${uniq("dm")}@example.com`;
  const res = await request(h.app)
    .post("/api/auth/register")
    .send({ name: uniq(name), email, password: "Password123" });
  return { token: res.body.data.accessToken, id: res.body.data.user.id, name: res.body.data.user.name };
}

function connect(token) {
  return new Promise((resolve, reject) => {
    const s = ioClient(`http://localhost:${port}`, {
      auth: { token },
      transports: ["websocket"],
      reconnection: false,
    });
    clients.push(s);
    s.once("connect", () => resolve(s));
    s.once("connect_error", reject);
    setTimeout(() => reject(new Error("connect timeout")), 4000);
  });
}

function emit(socket, event, payload) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`ack timeout: ${event}`)), 5000);
    socket.emit(event, payload, (res) => {
      clearTimeout(timer);
      resolve(res || {});
    });
  });
}

function next(socket, event, ms = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no ${event} within ${ms}ms`)), ms);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

/** Resolves true if the event does NOT arrive within `ms`. */
function never(socket, event, ms = 500) {
  return new Promise((resolve) => {
    let fired = false;
    const onEvent = () => { fired = true; };
    socket.once(event, onEvent);
    setTimeout(() => {
      socket.off(event, onEvent);
      resolve(!fired);
    }, ms);
  });
}

async function befriend(x, y) {
  await request(h.app).post("/api/friends/request").set(auth(x.token)).send({ userId: y.id });
  const reqs = await request(h.app).get("/api/friends/requests").set(auth(y.token));
  const id = reqs.body.data.incoming[0].id;
  await request(h.app).post(`/api/friends/requests/${id}/accept`).set(auth(y.token));
}

/** Two friends, both connected, with a thread open. */
async function pair() {
  const a = await reg("Ana");
  const b = await reg("Ben");
  await befriend(a, b);
  const res = await request(h.app)
    .post("/api/conversations")
    .set(auth(a.token))
    .send({ userId: b.id });
  const conversationId = res.body.data.conversation.id;
  const sa = await connect(a.token);
  const sb = await connect(b.token);
  return { a, b, sa, sb, conversationId };
}

describe("sending", () => {
  it("delivers to the other person without them joining anything", async () => {
    const { sa, sb, conversationId, a } = await pair();
    // No dm:join, no room to enter — this is the whole point of addressing the
    // personal room instead of a per-thread socket.io room.
    const heard = next(sb, "dm:new");
    const ack = await emit(sa, "dm:send", { conversationId, text: "hello there" });

    expect(ack.ok).toBe(true);
    const got = await heard;
    expect(got.text).toBe("hello there");
    expect(got.conversationId).toBe(String(conversationId));
    expect(got.sender.id).toBe(a.id);
  });

  it("delivers to my OTHER devices, but not back to the sending socket", async () => {
    const { a, sa, conversationId } = await pair();
    const secondDevice = await connect(a.token);

    const onOtherDevice = next(secondDevice, "dm:new");
    const notEchoed = never(sa, "dm:new");
    await emit(sa, "dm:send", { conversationId, text: "from my phone" });

    expect((await onOtherDevice).text).toBe("from my phone");
    // The sender already has it from the ack; echoing would double it.
    expect(await notEchoed).toBe(true);
  });

  it("refuses an empty message", async () => {
    const { sa, conversationId } = await pair();
    const ack = await emit(sa, "dm:send", { conversationId, text: "   " });
    expect(ack.ok).toBe(false);
  });

  it("refuses a stranger's socket", async () => {
    const { conversationId } = await pair();
    const outsider = await reg("Outsider");
    const so = await connect(outsider.token);
    const ack = await emit(so, "dm:send", { conversationId, text: "let me in" });
    expect(ack.ok).toBe(false);
    expect(ack.error).toMatch(/not found/i);
  });

  it("STOPS once the pair is no longer friends", async () => {
    const { a, b, sa, sb, conversationId } = await pair();
    await request(h.app).delete(`/api/friends/${b.id}`).set(auth(a.token));

    const silent = never(sb, "dm:new");
    const ack = await emit(sa, "dm:send", { conversationId, text: "still there?" });
    // The gate is re-checked per send: a thread opened while friends must not
    // stay writable forever, or unfriending would not actually stop anything.
    expect(ack.ok).toBe(false);
    expect(ack.error).toMatch(/friends/i);
    expect(await silent).toBe(true);
  });

  it("stops when blocked, with the same wording as an unfriend", async () => {
    const { a, b, sa, conversationId } = await pair();
    // B blocks A; A then tries to keep messaging.
    await request(h.app).post(`/api/friends/${a.id}/block`).set(auth(b.token));

    const ack = await emit(sa, "dm:send", { conversationId, text: "hello?" });
    expect(ack.ok).toBe(false);
    // Identical to the unfriend error, so a block cannot be identified by
    // probing — which is what stops it becoming a taunt.
    expect(ack.error).toMatch(/friends/i);
  });

  it("updates the inbox preview and the other person's unread count", async () => {
    const { b, sa, conversationId } = await pair();
    await emit(sa, "dm:send", { conversationId, text: "preview me" });

    const inbox = await request(h.app).get("/api/conversations").set(auth(b.token));
    const thread = inbox.body.data.conversations.find((c) => String(c.id) === String(conversationId));
    expect(thread.lastMessage.text).toBe("preview me");
    expect(thread.lastMessage.mine).toBe(false);
    expect(thread.unread).toBe(1);
  });

  it("does not count the sender's own message as unread for them", async () => {
    const { a, sa, conversationId } = await pair();
    await emit(sa, "dm:send", { conversationId, text: "mine" });
    const inbox = await request(h.app).get("/api/conversations").set(auth(a.token));
    expect(inbox.body.data.conversations[0].unread).toBe(0);
  });
});

describe("editing and deleting", () => {
  it("edits my own message and tells both sides", async () => {
    const { sa, sb, conversationId } = await pair();
    const sent = await emit(sa, "dm:send", { conversationId, text: "teh typo" });

    const heard = next(sb, "dm:edited");
    const ack = await emit(sa, "dm:edit", { messageId: sent.message.id, text: "the typo" });
    expect(ack.ok).toBe(true);
    const got = await heard;
    expect(got.text).toBe("the typo");
    expect(got.editedAt).toBeTruthy();
  });

  it("refuses to edit someone else's message", async () => {
    const { sa, sb, conversationId } = await pair();
    const sent = await emit(sa, "dm:send", { conversationId, text: "mine" });
    const ack = await emit(sb, "dm:edit", { messageId: sent.message.id, text: "hijacked" });
    expect(ack.ok).toBe(false);
  });

  it("deletes for everyone — but only the author may", async () => {
    const { sa, sb, conversationId } = await pair();
    const sent = await emit(sa, "dm:send", { conversationId, text: "oops" });

    // A room has an owner who can moderate; a DM has no such authority, so
    // neither participant may withdraw the other's words.
    const theirs = await emit(sb, "dm:delete", { messageId: sent.message.id, scope: "everyone" });
    expect(theirs.ok).toBe(false);

    const heard = next(sb, "dm:deleted");
    const mine = await emit(sa, "dm:delete", { messageId: sent.message.id, scope: "everyone" });
    expect(mine.ok).toBe(true);
    expect((await heard).scope).toBe("everyone");
  });

  it("lets either side delete for THEMSELVES", async () => {
    const { a, b, sa, sb, conversationId } = await pair();
    const sent = await emit(sa, "dm:send", { conversationId, text: "hide this" });

    // B hides A's message from B's own view.
    const ack = await emit(sb, "dm:delete", { messageId: sent.message.id, scope: "me" });
    expect(ack.ok).toBe(true);

    // Gone for B...
    const theirs = await request(h.app)
      .get(`/api/conversations/${conversationId}/messages`)
      .set(auth(b.token));
    expect(theirs.body.data.messages.map((m) => m.text)).not.toContain("hide this");

    // ...and untouched for A, who wrote it. "Delete for me" must never reach
    // across to the other person's copy.
    const mine = await request(h.app)
      .get(`/api/conversations/${conversationId}/messages`)
      .set(auth(a.token));
    expect(mine.body.data.messages.map((m) => m.text)).toContain("hide this");
  });
});

describe("typing", () => {
  it("relays to the other person only", async () => {
    const { a, sa, sb, conversationId } = await pair();
    const heard = next(sb, "dm:typing");
    sa.emit("dm:typing", { conversationId });
    const got = await heard;
    expect(got.conversationId).toBe(String(conversationId));
    expect(got.user.id).toBe(a.id);
  });

  it("is ignored for a thread I am not in", async () => {
    const { conversationId } = await pair();
    const outsider = await reg("Nosy");
    const so = await connect(outsider.token);
    // Nothing to assert on the wire — the point is that it does not throw and
    // nobody receives it. A silent no-op is the correct behaviour.
    so.emit("dm:typing", { conversationId });
    await new Promise((r) => setTimeout(r, 200));
    expect(so.connected).toBe(true);
  });
});
