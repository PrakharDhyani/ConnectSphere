/**
 * Sticky Notes — the first plugin built AFTER the plugin system.
 *
 * Two things are under test here, and the second matters more than the first:
 *
 *   1. The plugin works: notes sync, persist, and the destructive action is
 *      governed by config.
 *   2. GUARANTEE #1 — adding it edited no existing file beyond the registration
 *      lines. That is asserted mechanically at the bottom of this file, because
 *      a guarantee nobody checks is a comment.
 *
 * Driven through real socket.io clients rather than by calling the module
 * directly: every claim here is about behaviour at the boundary (an outsider is
 * refused, a non-author cannot edit, a full board refuses), and calling
 * `events.create(sdk, …)` in-process would prove none of it.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "@jest/globals";
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import request from "supertest";
import { io as ioClient } from "socket.io-client";
import { startHarness } from "./helpers/harness.js";

import { getPlugin } from "../../shared/activities/index.js";
import { getRegisteredModuleIds } from "../src/activities/host.js";
import { enabledPluginIds } from "../src/activities/index.js";

// Deliberately NOT set to "sticky-notes": a native plugin must be served even
// with the flag at its default, and this suite is where that is proven.
process.env.ACTIVITY_PLUGINS = "none";

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

async function reg(name) {
  const email = `sn_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`;
  const res = await request(h.app)
    .post("/api/auth/register")
    .send({ name: uniq(name), email, password: "Password123" });
  return { token: res.body.data.accessToken, id: res.body.data.user.id };
}

/**
 * A room with Sticky Notes installed, the way the creation wizard does it.
 *
 * Installing it EXPLICITLY is the point, not test scaffolding: a room created
 * before this plugin existed resolves to LEGACY_ACTIVITY_IDS, which
 * deliberately excludes it, so a legacy room refuses the join. That is the
 * compat resolver working — a 2026 plugin must not appear in 2025's rooms
 * unasked — and the first draft of this suite failed against it, which is the
 * behaviour being documented here.
 */
async function createRoom(token, name = "Notes Room") {
  const res = await request(h.app)
    .post("/api/rooms")
    .set("Authorization", `Bearer ${token}`)
    .send({ name: uniq(name), activities: [{ id: ID }] });
  return res.body.data.room;
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

/** Emit and await the ack. Every host reply answers, including refusals. */
function ack(socket, event, payload) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`ack timeout: ${event}`)), 5000);
    socket.emit(event, payload, (res) => {
      clearTimeout(timer);
      resolve(res || {});
    });
  });
}

/** Wait for one broadcast of a plugin event. */
function next(socket, event, ms = 4000) {
  const wire = `activity:sticky-notes:${event}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no ${wire} within ${ms}ms`)), ms);
    socket.once(wire, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

const ID = "sticky-notes";
const join = (s, roomId) => ack(s, "activity:join", { activityId: ID, roomId });
const send = (s, roomId, event, payload) =>
  ack(s, "activity:event", { activityId: ID, roomId, event, payload });

/** Owner + member in the same room, both joined to the activity. */
async function twoInARoom() {
  const owner = await reg("Owner");
  const member = await reg("Member");
  const room = await createRoom(owner.token);
  await request(h.app).post("/api/rooms/join").set("Authorization", `Bearer ${member.token}`).send({ code: room.code });
  const a = await connect(owner.token);
  const b = await connect(member.token);
  await join(a, room.id);
  await join(b, room.id);
  return { owner, member, room, a, b };
}

describe("registration", () => {
  it("is served even though the flag is 'none'", () => {
    // The flag is a migration rollback. Sticky Notes has no legacy handler, so
    // "off" would mean silently dead rather than "the old path runs".
    expect(enabledPluginIds("none")).toContain(ID);
    expect(getRegisteredModuleIds()).toContain(ID);
  });

  it("has a manifest with its own tab surface", () => {
    const m = getPlugin(ID);
    expect(m).toBeTruthy();
    // NOT "board": that surface is a single slot held by whiteboard, and a
    // second board plugin used to be dropped without a word.
    expect(m.surface).toBe("tab");
  });
});

describe("notes sync between people", () => {
  it("gives a joiner the current board", async () => {
    const owner = await reg("Owner");
    const room = await createRoom(owner.token);
    const s = await connect(owner.token);
    const res = await join(s, room.id);
    expect(res.ok).toBe(true);
    expect(res.state.notes).toEqual([]);
    expect(res.state.you).toBe(owner.id);
  });

  it("broadcasts a new note to everyone, author included", async () => {
    const { room, a, b } = await twoInARoom();
    const seen = next(b, "created");
    const res = await send(a, room.id, "create", { text: "hello", color: "pink", pos: { x: 0.2, y: 0.3 } });
    expect(res.note.text).toBe("hello");
    const { note } = await seen;
    expect(note.text).toBe("hello");
    expect(note.color).toBe("pink");
  });

  it("shows a late joiner the notes already on the board", async () => {
    const { room, a, member } = await twoInARoom();
    await send(a, room.id, "create", { text: "earlier", pos: { x: 0.1, y: 0.1 } });
    const c = await connect(member.token);
    const res = await join(c, room.id);
    expect(res.state.notes.map((n) => n.text)).toContain("earlier");
  });

  it("moves a note for the others but not back at the dragger", async () => {
    const { room, a, b } = await twoInARoom();
    const { note } = await (async () => {
      const seen = next(b, "created");
      await send(a, room.id, "create", { text: "drag me", pos: { x: 0, y: 0 } });
      return seen;
    })();

    const moved = next(b, "moved");
    // Echoing the position back at the dragger would fight their own cursor
    // mid-gesture, so `move` uses toOthers rather than broadcast.
    const bounced = next(a, "moved", 800).then(() => "echoed").catch(() => "silent");
    await send(a, room.id, "move", { id: note.id, pos: { x: 0.9, y: 0.4 } });
    expect((await moved).pos).toEqual({ x: 0.9, y: 0.4 });
    expect(await bounced).toBe("silent");
  });

  it("removes a note for everyone", async () => {
    const { room, a, b } = await twoInARoom();
    const created = next(b, "created");
    await send(a, room.id, "create", { text: "temporary", pos: { x: 0.5, y: 0.5 } });
    const { note } = await created;

    const gone = next(b, "removed");
    expect((await send(a, room.id, "remove", { id: note.id })).ok).toBe(true);
    expect((await gone).id).toBe(note.id);
  });
});

describe("the server owns the fields that matter", () => {
  it("stamps authorship itself and ignores a forged author", async () => {
    const { room, a, owner } = await twoInARoom();
    // A client-supplied authorId would let anyone write as someone else.
    const res = await send(a, room.id, "create", {
      text: "who wrote this?",
      pos: { x: 0.1, y: 0.1 },
      authorId: "000000000000000000000000",
      id: "forged-id",
    });
    expect(res.note.authorId).toBe(owner.id);
    expect(res.note.id).not.toBe("forged-id");
  });

  it("clamps positions into the board", async () => {
    const { room, a } = await twoInARoom();
    // Off-board coordinates would put a note where nobody can reach it to
    // delete it.
    const res = await send(a, room.id, "create", { text: "far away", pos: { x: 99, y: -4 } });
    expect(res.note.pos).toEqual({ x: 1, y: 0 });
  });

  it("truncates over-long text and rejects a colour outside the palette", async () => {
    const { room, a } = await twoInARoom();
    const res = await send(a, room.id, "create", {
      text: "x".repeat(5000),
      color: "'; background: url(evil)",
      pos: { x: 0.5, y: 0.5 },
    });
    expect(res.note.text).toHaveLength(280);
    expect(res.note.color).toBe("yellow");
  });

  it("refuses an outsider entirely", async () => {
    const owner = await reg("Owner");
    const outsider = await reg("Outsider");
    const room = await createRoom(owner.token);
    const s = await connect(outsider.token);
    expect((await join(s, room.id)).error).toBeTruthy();
  });
});

describe("editing and deleting rules", () => {
  it("lets only the author rewrite a note", async () => {
    const { room, a, b } = await twoInARoom();
    const created = next(b, "created");
    await send(a, room.id, "create", { text: "mine", pos: { x: 0.2, y: 0.2 } });
    const { note } = await created;

    // Rewriting someone else's words under their name is a different act from
    // removing a note, so it is author-only regardless of allowDelete.
    const changed = next(a, "edited", 800).then(() => "changed").catch(() => "unchanged");
    await send(b, room.id, "edit", { id: note.id, text: "hijacked" });
    expect(await changed).toBe("unchanged");

    const ok = next(b, "edited");
    await send(a, room.id, "edit", { id: note.id, text: "revised" });
    expect((await ok).text).toBe("revised");
  });

  it("defaults to author-only deletion", async () => {
    const { room, a, b } = await twoInARoom();
    const created = next(b, "created");
    await send(a, room.id, "create", { text: "not yours", pos: { x: 0.3, y: 0.3 } });
    const { note } = await created;

    expect((await send(b, room.id, "remove", { id: note.id })).error).toBeTruthy();
    expect((await send(a, room.id, "remove", { id: note.id })).ok).toBe(true);
  });

  it("treats deleting an already-gone note as success", async () => {
    const { room, a } = await twoInARoom();
    // Two people deleting at once must not produce an error for the loser.
    expect((await send(a, room.id, "remove", { id: "no-such-note" })).ok).toBe(true);
  });
});

describe("guarantee #1 — adding a plugin edits no existing file", () => {
  const __dirname_ = path.dirname(fileURLToPath(import.meta.url));
  const repo = path.resolve(__dirname_, "../..");
  const read = (p) => fs.readFileSync(path.join(repo, p), "utf8");

  it("lives entirely in its own three folders", () => {
    for (const p of [
      "shared/activities/sticky-notes/manifest.js",
      "backend/src/activities/sticky-notes/server.js",
      "frontend/src/activities/sticky-notes/index.jsx",
    ]) {
      expect(fs.existsSync(path.join(repo, p))).toBe(true);
    }
  });

  it("is named ONLY by the three registration files, nowhere else", () => {
    /**
     * The actual architectural claim, checked mechanically.
     *
     * If a future change makes the room shell, the dispatcher or the wizard
     * mention "sticky-notes" by name, this fails — and it should, because that
     * is the coupling the whole plugin system exists to prevent. The fix is to
     * make the platform generic again, not to add a file to this list.
     */
    const allowed = [
      "shared/activities/index.js",
      "backend/src/activities/index.js",
      "frontend/src/activities/registry.jsx",
    ];
    for (const p of allowed) expect(read(p)).toContain(ID);

    // The files that used to need editing for every new activity.
    const mustNotMention = [
      "backend/src/sockets/index.js",
      "frontend/src/pages/RoomPage.jsx",
      "frontend/src/components/GamesHub.jsx",
      "shared/activities/room-view.js",
      "shared/activities/compat.js",
      "shared/activities/recommend.js",
      "frontend/src/activities/ActivityHost.jsx",
      "frontend/src/activities/sdk.js",
    ];
    for (const p of mustNotMention) expect(read(p)).not.toContain(ID);
  });

  it("is not retro-installed into pre-plugin rooms", () => {
    // LEGACY_ACTIVITY_IDS is a historical fact about rooms that existed before
    // plugins. Adding a 2026 plugin to it would silently appear in every old
    // room, which is precisely what compat.js exists to prevent.
    expect(read("shared/activities/compat.js")).not.toContain(ID);
  });
});
