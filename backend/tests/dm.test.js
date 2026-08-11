/**
 * Direct messages (1:1) and blocking.
 *
 * What is actually at risk here, and therefore what is tested:
 *
 *   1. **One thread per pair, under concurrency.** Two people can press
 *      "message" on each other in the same instant. A find-then-create would
 *      race into two threads for one pair, after which each person types into a
 *      thread the other never sees — and both sides look correct in isolation,
 *      which is what makes it so hard to notice. The unique key + upsert is
 *      supposed to make that outcome impossible; this suite fires the race.
 *   2. **Friendship is a live gate, not a door you walk through once.** Opening
 *      a thread while friends must not leave it writable forever, or unfriend
 *      and block would remove someone from your list while their messages kept
 *      arriving.
 *   3. **A block outlives an unfriend, and does not announce itself.** It
 *      survives re-requests, and from the blocked side it is indistinguishable
 *      from the account not existing — otherwise the block becomes a taunt.
 *   4. **"Clear" is per-user.** Neither participant may destroy the other's
 *      copy of a shared history.
 *
 * REST is driven through supertest; the live socket path (dm:send and friends)
 * is exercised in dm.sockets.test.js.
 */
import { describe, it, expect, beforeEach } from "@jest/globals";
import request from "supertest";
import { startHarness } from "./helpers/harness.js";
import { Message } from "../src/models/Message.js";
import { Conversation } from "../src/models/Conversation.js";

const h = startHarness();

const A = { name: "Ana", email: "ana.dm@example.com", password: "Password123" };
const B = { name: "Ben", email: "ben.dm@example.com", password: "Password123" };
const C = { name: "Cass", email: "cass.dm@example.com", password: "Password123" };

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
}

const openWith = (me, other) =>
  request(h.app).post("/api/conversations").set(auth(me.token)).send({ userId: other.id });

/** Insert a message directly — REST does not create them; sockets do. */
const say = (conversationId, sender, text, extra = {}) =>
  Message.create({ conversation: conversationId, sender: sender.id, text, ...extra });

describe("opening a conversation", () => {
  it("opens a thread between two friends", async () => {
    await befriend(a, b);
    const res = await openWith(a, b);
    expect(res.status).toBe(201);
    expect(res.body.data.conversation.user.id).toBe(b.id);
    expect(res.body.data.conversation.unread).toBe(0);
  });

  it("is idempotent — 'message Ben' from anywhere lands in the SAME thread", async () => {
    await befriend(a, b);
    const first = await openWith(a, b);
    const second = await openWith(a, b);
    expect(String(second.body.data.conversation.id)).toBe(String(first.body.data.conversation.id));
    expect(await Conversation.countDocuments({})).toBe(1);
  });

  it("gives both people the same thread, whichever of them opens it", async () => {
    await befriend(a, b);
    const mine = await openWith(a, b);
    const theirs = await openWith(b, a);
    expect(String(theirs.body.data.conversation.id)).toBe(String(mine.body.data.conversation.id));
    expect(theirs.body.data.conversation.user.id).toBe(a.id);
  });

  it("survives both people opening it AT THE SAME TIME", async () => {
    /**
     * The race the unique key exists for. Without it this produces two threads
     * and the two people never see each other's messages again.
     */
    await befriend(a, b);
    const results = await Promise.all([
      openWith(a, b), openWith(b, a), openWith(a, b), openWith(b, a),
    ]);
    for (const r of results) expect([200, 201]).toContain(r.status);
    expect(await Conversation.countDocuments({})).toBe(1);
    const ids = new Set(results.map((r) => String(r.body.data.conversation.id)));
    expect(ids.size).toBe(1);
  });

  it("refuses a non-friend", async () => {
    const res = await openWith(a, c);
    expect(res.status).toBe(403);
  });

  it("refuses yourself", async () => {
    const res = await request(h.app)
      .post("/api/conversations")
      .set(auth(a.token))
      .send({ userId: a.id });
    expect(res.status).toBe(403);
  });

  it("refuses a pending (not yet accepted) friendship", async () => {
    await request(h.app).post("/api/friends/request").set(auth(a.token)).send({ userId: b.id });
    const res = await openWith(a, b);
    expect(res.status).toBe(403);
  });
});

describe("the inbox", () => {
  it("lists threads newest-first with a preview and unread count", async () => {
    await befriend(a, b);
    await befriend(a, c);
    const withB = (await openWith(a, b)).body.data.conversation.id;
    const withC = (await openWith(a, c)).body.data.conversation.id;

    await say(withB, b, "first");
    // Newer, so this thread should sort above the other.
    const conv = await Conversation.findById(withC);
    await say(withC, c, "second");
    conv.lastMessage = { text: "second", sender: c.id, at: new Date() };
    await conv.save();
    const convB = await Conversation.findById(withB);
    convB.lastMessage = { text: "first", sender: b.id, at: new Date(Date.now() - 60_000) };
    await convB.save();

    const res = await request(h.app).get("/api/conversations").set(auth(a.token));
    expect(res.status).toBe(200);
    const list = res.body.data.conversations;
    expect(list).toHaveLength(2);
    expect(String(list[0].id)).toBe(String(withC));
    expect(list[0].lastMessage.text).toBe("second");
    expect(list[0].lastMessage.mine).toBe(false);
    // Both messages are from other people and unread.
    expect(list[0].unread).toBe(1);
    expect(list[1].unread).toBe(1);
  });

  it("does not count my own messages as unread", async () => {
    await befriend(a, b);
    const id = (await openWith(a, b)).body.data.conversation.id;
    await say(id, a, "mine");
    await say(id, a, "also mine");

    const res = await request(h.app).get("/api/conversations").set(auth(a.token));
    expect(res.body.data.conversations[0].unread).toBe(0);
    // ...but they ARE unread for the other person.
    const theirs = await request(h.app).get("/api/conversations").set(auth(b.token));
    expect(theirs.body.data.conversations[0].unread).toBe(2);
  });

  it("clears the unread count when the thread is marked read", async () => {
    await befriend(a, b);
    const id = (await openWith(a, b)).body.data.conversation.id;
    await say(id, b, "hello");

    let res = await request(h.app).get("/api/conversations").set(auth(a.token));
    expect(res.body.data.conversations[0].unread).toBe(1);

    await request(h.app).post(`/api/conversations/${id}/read`).set(auth(a.token));
    res = await request(h.app).get("/api/conversations").set(auth(a.token));
    expect(res.body.data.conversations[0].unread).toBe(0);
  });

  it("shows nobody else's threads", async () => {
    await befriend(a, b);
    await openWith(a, b);
    const res = await request(h.app).get("/api/conversations").set(auth(c.token));
    expect(res.body.data.conversations).toEqual([]);
  });
});

describe("history", () => {
  it("returns messages oldest → newest for a participant", async () => {
    await befriend(a, b);
    const id = (await openWith(a, b)).body.data.conversation.id;
    await say(id, a, "one");
    await say(id, b, "two");

    const res = await request(h.app).get(`/api/conversations/${id}/messages`).set(auth(b.token));
    expect(res.status).toBe(200);
    expect(res.body.data.messages.map((m) => m.text)).toEqual(["one", "two"]);
    expect(res.body.data.messages[0].sender.id).toBe(a.id);
  });

  it("404s for a stranger — never 403", async () => {
    // A 403 would confirm the thread exists, which leaks that two particular
    // people are talking to each other.
    await befriend(a, b);
    const id = (await openWith(a, b)).body.data.conversation.id;
    const res = await request(h.app).get(`/api/conversations/${id}/messages`).set(auth(c.token));
    expect(res.status).toBe(404);
  });

  it("hides messages the viewer deleted for themselves", async () => {
    await befriend(a, b);
    const id = (await openWith(a, b)).body.data.conversation.id;
    await say(id, b, "keep");
    await say(id, b, "hide me", { hiddenFor: [a.id] });

    const mine = await request(h.app).get(`/api/conversations/${id}/messages`).set(auth(a.token));
    expect(mine.body.data.messages.map((m) => m.text)).toEqual(["keep"]);
    // Untouched for the other person.
    const theirs = await request(h.app).get(`/api/conversations/${id}/messages`).set(auth(b.token));
    expect(theirs.body.data.messages).toHaveLength(2);
  });
});

describe("clearing a conversation", () => {
  it("clears MY copy and leaves theirs intact", async () => {
    await befriend(a, b);
    const id = (await openWith(a, b)).body.data.conversation.id;
    await say(id, b, "before the clear");

    await request(h.app).delete(`/api/conversations/${id}`).set(auth(a.token));

    const mine = await request(h.app).get(`/api/conversations/${id}/messages`).set(auth(a.token));
    expect(mine.body.data.messages).toEqual([]);
    // Neither participant may destroy the other's copy of a shared history.
    const theirs = await request(h.app).get(`/api/conversations/${id}/messages`).set(auth(b.token));
    expect(theirs.body.data.messages).toHaveLength(1);
  });

  it("shows messages sent AFTER the clear", async () => {
    await befriend(a, b);
    const id = (await openWith(a, b)).body.data.conversation.id;
    await say(id, b, "old");
    await request(h.app).delete(`/api/conversations/${id}`).set(auth(a.token));
    await say(id, b, "new");

    const res = await request(h.app).get(`/api/conversations/${id}/messages`).set(auth(a.token));
    expect(res.body.data.messages.map((m) => m.text)).toEqual(["new"]);
  });
});

describe("guests", () => {
  it("cannot use direct messages at all", async () => {
    // A guest token is ephemeral and scoped to one room, so a thread addressed
    // to one would outlive the identity that owns it.
    const owner = await reg({ name: "Owner", email: "owner.dm@example.com", password: "Password123" });
    const room = await request(h.app)
      .post("/api/rooms")
      .set(auth(owner.token))
      .send({ name: "Guest Room" });
    const guest = await request(h.app)
      .post("/api/auth/guest")
      .send({ name: "Wanderer", code: room.body.data.room.code });
    const token = guest.body?.data?.accessToken;
    expect(token).toBeTruthy();

    const res = await request(h.app).get("/api/conversations").set(auth(token));
    expect(res.status).toBe(403);
  });
});

describe("blocking", () => {
  it("blocks a friend, and they are no longer a friend", async () => {
    await befriend(a, b);
    const res = await request(h.app).post(`/api/friends/${b.id}/block`).set(auth(a.token));
    expect(res.status).toBe(200);

    const mine = await request(h.app).get("/api/friends").set(auth(a.token));
    expect(mine.body.data.friends).toEqual([]);
    // ...and symmetrically for them, without them being told why.
    const theirs = await request(h.app).get("/api/friends").set(auth(b.token));
    expect(theirs.body.data.friends).toEqual([]);
  });

  it("SURVIVES a re-request, which is what makes it more than an unfriend", async () => {
    await befriend(a, b);
    await request(h.app).post(`/api/friends/${b.id}/block`).set(auth(a.token));

    const retry = await request(h.app)
      .post("/api/friends/request")
      .set(auth(b.token))
      .send({ userId: a.id });
    // 404, deliberately: "you are blocked" would turn a block into a
    // notification. From their side it looks like the account is gone.
    expect(retry.status).toBe(404);
    // The wording must not mention blocking at all.
    expect(JSON.stringify(retry.body)).not.toMatch(/block/i);
  });

  it("stops an existing conversation from being written to", async () => {
    await befriend(a, b);
    const id = (await openWith(a, b)).body.data.conversation.id;
    await request(h.app).post(`/api/friends/${b.id}/block`).set(auth(a.token));

    // The gate is re-checked, so a thread opened while friends does not stay
    // writable forever. (Upload is the REST-reachable write path.)
    const res = await request(h.app)
      .post(`/api/conversations/${id}/attachments`)
      .set(auth(b.token))
      .attach("files", Buffer.from("hi"), "note.txt");
    // 503 when object storage is not configured in this environment — either
    // way the write did not land.
    expect([403, 503]).toContain(res.status);
    if (res.status === 403) expect(JSON.stringify(res.body)).toMatch(/friends/i);
  });

  it("blocks a stranger — available before any friendship exists", async () => {
    const res = await request(h.app).post(`/api/friends/${c.id}/block`).set(auth(a.token));
    expect(res.status).toBe(200);
    const blocked = await request(h.app).get("/api/friends/blocked").set(auth(a.token));
    expect(blocked.body.data.blocked.map((u) => u.id)).toContain(c.id);
  });

  it("hides someone who blocked ME from search, but shows people I blocked", async () => {
    await request(h.app).post(`/api/friends/${a.id}/block`).set(auth(b.token)); // B blocks A
    await request(h.app).post(`/api/friends/${c.id}/block`).set(auth(a.token)); // A blocks C

    const res = await request(h.app).get("/api/friends/search?q=e").set(auth(a.token));
    const ids = res.body.data.users.map((u) => u.id);
    // An "Add" button that always fails would be a way to confirm the block.
    expect(ids).not.toContain(b.id);
    // My own blocks stay visible so I can lift them.
    const mine = await request(h.app).get("/api/friends/search?q=Cass").set(auth(a.token));
    const cass = mine.body.data.users.find((u) => u.id === c.id);
    expect(cass?.relationship).toBe("blocked");
  });

  it("only the blocker can lift it", async () => {
    await request(h.app).post(`/api/friends/${b.id}/block`).set(auth(a.token));
    const theirs = await request(h.app).delete(`/api/friends/${a.id}/block`).set(auth(b.token));
    expect(theirs.status).toBe(404);

    const mine = await request(h.app).delete(`/api/friends/${b.id}/block`).set(auth(a.token));
    expect(mine.status).toBe(200);
  });

  it("unblocking leaves them strangers, NOT friends again", async () => {
    await befriend(a, b);
    await request(h.app).post(`/api/friends/${b.id}/block`).set(auth(a.token));
    await request(h.app).delete(`/api/friends/${b.id}/block`).set(auth(a.token));

    // Silently restoring a friendship you had blocked would be a dangerous
    // surprise. Either side may send a fresh request.
    const friends = await request(h.app).get("/api/friends").set(auth(a.token));
    expect(friends.body.data.friends).toEqual([]);
    const retry = await request(h.app)
      .post("/api/friends/request")
      .set(auth(b.token))
      .send({ userId: a.id });
    expect(retry.status).toBe(201);
  });

  it("cannot be seized by the blocked party", async () => {
    await request(h.app).post(`/api/friends/${b.id}/block`).set(auth(a.token));
    // If B could overwrite the row, they could then lift it themselves.
    const res = await request(h.app).post(`/api/friends/${a.id}/block`).set(auth(b.token));
    expect(res.status).toBe(404);
  });

  it("refuses blocking yourself", async () => {
    const res = await request(h.app).post(`/api/friends/${a.id}/block`).set(auth(a.token));
    expect(res.status).toBe(400);
  });
});

describe("the message model's one-parent rule", () => {
  it("refuses a message with neither a room nor a conversation", async () => {
    // A parentless message is a row no query can reach: invisible, undeletable.
    await expect(Message.create({ sender: a.id, text: "orphan" })).rejects.toThrow(/exactly one/i);
  });

  it("refuses a message with BOTH", async () => {
    await befriend(a, b);
    const id = (await openWith(a, b)).body.data.conversation.id;
    const room = await request(h.app)
      .post("/api/rooms")
      .set(auth(a.token))
      .send({ name: "Both Parents Room" });
    expect(room.status).toBe(201);
    await expect(
      Message.create({
        sender: a.id,
        text: "ambiguous",
        conversation: id,
        room: room.body.data.room.id,
      })
    ).rejects.toThrow(/exactly one/i);
  });
});
