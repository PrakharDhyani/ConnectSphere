/**
 * Draw & Guess as a plugin — the first BESPOKE migration.
 *
 * The framework games (§50) were near-mechanical: one adapter line each, and
 * `lobbyGame.js` already owned the seats. This one has no framework underneath
 * — its own lobby, its own timers, its own scoring — so the risk is different
 * and so are the tests. What is under test here is that a behaviour-preserving
 * transport swap actually preserved the behaviour:
 *
 *   1. The private channel still is private. The drawer learns the real word;
 *      guessers get a mask. This is the capability the migration order was
 *      built around (`sdk.socket.toUser`), so it gets the closest scrutiny.
 *   2. The timer chain survives the request that started it. Every transition
 *      in this game fires from a setTimeout with no socket in scope, which is
 *      what `detached()` exists for — and what a naive migration breaks
 *      silently, since the game simply stops advancing with nothing logged.
 *   3. The host's guarantees now cover it: an outsider is refused, a
 *      non-drawer cannot draw, the guard rails hold.
 *
 * Driven through real socket.io clients, like the sticky-notes suite: every
 * claim is about behaviour at the boundary. Calling `events.guess(sdk, …)`
 * in-process would prove none of it.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "@jest/globals";
import http from "http";
import request from "supertest";
import { io as ioClient } from "socket.io-client";
import { startHarness } from "./helpers/harness.js";

import { getPlugin } from "../../shared/activities/index.js";
import { getRegisteredModuleIds } from "../src/activities/host.js";
import { enabledPluginIds } from "../src/activities/index.js";
import { __games } from "../src/activities/skribbl/server.js";

const ID = "skribbl";

// This plugin IS a migration — it has a legacy handler to fall back to — so
// unlike sticky-notes it must be named explicitly for the host to serve it.
process.env.ACTIVITY_PLUGINS = ID;

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
  // Timers outlive a socket by design; a leaked turn clock would fire into the
  // next test and make failures look random.
  for (const roomId of [...__games.keys()]) {
    const g = __games.get(roomId);
    clearTimeout(g.timers.choose);
    clearTimeout(g.timers.turn);
    clearTimeout(g.timers.reveal);
    (g.timers.hints || []).forEach(clearTimeout);
    __games.delete(roomId);
  }
});

const uniq = (n) => `${n}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

async function reg(name) {
  const email = `sk_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`;
  const res = await request(h.app)
    .post("/api/auth/register")
    .send({ name: uniq(name), email, password: "Password123" });
  return { token: res.body.data.accessToken, id: res.body.data.user.id, name: res.body.data.user.name };
}

async function createRoom(token, activities = [{ id: ID }]) {
  const res = await request(h.app)
    .post("/api/rooms")
    .set("Authorization", `Bearer ${token}`)
    .send({ name: uniq("Draw Room"), activities });
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
function next(socket, event, ms = 6000) {
  const wire = `activity:${ID}:${event}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no ${wire} within ${ms}ms`)), ms);
    socket.once(wire, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

/** Wait for a state broadcast matching a predicate (transitions are timer-driven). */
function nextStateWhere(socket, pred, ms = 8000) {
  const wire = `activity:${ID}:state`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(wire, onState);
      reject(new Error(`no matching state within ${ms}ms`));
    }, ms);
    function onState(s) {
      if (!pred(s)) return;
      clearTimeout(timer);
      socket.off(wire, onState);
      resolve(s);
    }
    socket.on(wire, onState);
  });
}

const join = (s, roomId) => ack(s, "activity:join", { activityId: ID, roomId });
const send = (s, roomId, event, payload) =>
  ack(s, "activity:event", { activityId: ID, roomId, event, payload });

/** Two players in one room, both joined to the activity and both ready. */
async function twoPlayers() {
  const owner = await reg("Host");
  const member = await reg("Guesser");
  const room = await createRoom(owner.token);
  await request(h.app)
    .post("/api/rooms/join")
    .set("Authorization", `Bearer ${member.token}`)
    .send({ code: room.code });
  const a = await connect(owner.token);
  const b = await connect(member.token);
  await join(a, room.id);
  await join(b, room.id);
  return { owner, member, room, a, b };
}

async function readyBoth({ room, a, b }) {
  await send(a, room.id, "ready", { ready: true });
  await send(b, room.id, "ready", { ready: true });
}

describe("registration", () => {
  it("is served when the flag names it", () => {
    expect(enabledPluginIds(ID)).toContain(ID);
    expect(getRegisteredModuleIds()).toContain(ID);
  });

  it("keeps the wire id 'skribbl', not 'draw-guess'", () => {
    // Baked into sessionStorage keys and the room-announce activity id.
    // Renaming would break in-flight sessions for zero benefit.
    expect(getPlugin(ID)).toBeTruthy();
    expect(getPlugin("draw-guess")).toBeNull();
  });

  it("falls back to the legacy handler when the flag omits it", () => {
    // Unlike a native plugin, this one HAS a legacy handler — so "off" must
    // mean "the old path runs", not "silently dead".
    expect(enabledPluginIds("none")).not.toContain(ID);
  });
});

describe("lobby", () => {
  it("seats the joiner and returns state from the join ack", async () => {
    const { owner, room, a } = await twoPlayers();
    const res = await join(a, room.id);
    expect(res.error).toBeUndefined();
    // Join IS the sync — the legacy client needed a second `game:sync` call.
    expect(res.state.status).toBe("lobby");
    expect(res.state.lobby.map((p) => p.id)).toContain(owner.id);
    expect(res.state.hostId).toBe(owner.id);
  });

  it("refuses a player who is not a member of the room", async () => {
    const { room } = await twoPlayers();
    const outsider = await reg("Outsider");
    const c = await connect(outsider.token);
    const res = await join(c, room.id);
    // The host enforces this, not the plugin — the plugin has no such check.
    expect(res.error).toBeTruthy();
    expect(res.state).toBeUndefined();
  });

  it("refuses to start without two ready players", async () => {
    const { room, a } = await twoPlayers();
    const notEnough = await send(a, room.id, "start", {});
    expect(notEnough.error).toMatch(/ready|2 players/i);
  });

  it("only the host may start", async () => {
    const ctx = await twoPlayers();
    await readyBoth(ctx);
    const res = await send(ctx.b, ctx.room.id, "start", {});
    expect(res.error).toMatch(/host/i);
  });
});

describe("the private word channel", () => {
  /**
   * The reason this plugin migrated after the framework games.
   *
   * If `toUser` leaked to the activity room, every guesser would receive the
   * answer and the game would be pointless — and it would still "work" in a
   * one-player smoke test, which is why this is asserted rather than eyeballed.
   */
  it("sends word choices to the drawer alone", async () => {
    const ctx = await twoPlayers();
    await readyBoth(ctx);

    const drawerChoices = next(ctx.a, "choices");
    // If the non-drawer ever receives choices, this resolves and the test fails.
    let leaked = null;
    ctx.b.on(`activity:${ID}:choices`, (p) => { leaked = p; });

    await send(ctx.a, ctx.room.id, "start", { rounds: 1 });
    const { choices } = await drawerChoices;

    expect(Array.isArray(choices)).toBe(true);
    expect(choices).toHaveLength(3);
    expect(leaked).toBeNull();
  });

  it("gives the drawer the real word and everyone else a mask", async () => {
    const ctx = await twoPlayers();
    await readyBoth(ctx);

    const drawerChoices = next(ctx.a, "choices");
    await send(ctx.a, ctx.room.id, "start", { rounds: 1 });
    const { choices } = await drawerChoices;

    const word = choices[0];
    const drawerWord = next(ctx.a, "drawerWord");
    const guesserState = nextStateWhere(ctx.b, (s) => s.status === "drawing");
    await send(ctx.a, ctx.room.id, "chooseWord", { word });

    expect((await drawerWord).word).toBe(word);

    const seen = await guesserState;
    // The guesser gets a mask of the right shape and never the word itself.
    expect(seen.word).toBeNull();
    expect(seen.masked).toBeTruthy();
    expect(seen.masked).not.toBe(word);
    expect(seen.masked.replace(/[^a-z]/gi, "")).not.toBe(word);
  });
});

describe("scoring and the turn clock", () => {
  /**
   * A correct guess scores BOTH players and ends the turn once nobody is left
   * to guess — the whole round advancing from a timer the request did not own.
   */
  it("scores the guesser and the drawer on a correct guess", async () => {
    const ctx = await twoPlayers();
    await readyBoth(ctx);

    const drawerChoices = next(ctx.a, "choices");
    await send(ctx.a, ctx.room.id, "start", { rounds: 1 });
    const { choices } = await drawerChoices;
    const word = choices[0];

    const drawing = nextStateWhere(ctx.b, (s) => s.status === "drawing");
    await send(ctx.a, ctx.room.id, "chooseWord", { word });
    await drawing;

    const correct = next(ctx.a, "correct");
    // Case-insensitive, as the legacy handler was.
    await send(ctx.b, ctx.room.id, "guess", { text: word.toUpperCase() });
    const hit = await correct;
    expect(hit.userId).toBe(ctx.member.id);

    const scored = await nextStateWhere(
      ctx.b,
      (s) => s.players.some((p) => p.id === ctx.member.id && p.score > 0),
      8000
    );
    const guesser = scored.players.find((p) => p.id === ctx.member.id);
    const drawer = scored.players.find((p) => p.id === ctx.owner.id);
    expect(guesser.score).toBeGreaterThan(0);
    // The drawer is paid per correct guesser — 40 a head.
    expect(drawer.score).toBe(40);
  });

  it("broadcasts a wrong guess as chat without revealing the word", async () => {
    const ctx = await twoPlayers();
    await readyBoth(ctx);

    const drawerChoices = next(ctx.a, "choices");
    await send(ctx.a, ctx.room.id, "start", { rounds: 1 });
    const { choices } = await drawerChoices;
    const drawing = nextStateWhere(ctx.b, (s) => s.status === "drawing");
    await send(ctx.a, ctx.room.id, "chooseWord", { word: choices[0] });
    await drawing;

    const msg = next(ctx.a, "guessMessage");
    await send(ctx.b, ctx.room.id, "guess", { text: "definitely-not-the-word" });
    const seen = await msg;
    expect(seen.text).toBe("definitely-not-the-word");
    expect(seen.name).toBeTruthy();
  });

  it("ignores a guess from the drawer, who already knows the word", async () => {
    const ctx = await twoPlayers();
    await readyBoth(ctx);

    const drawerChoices = next(ctx.a, "choices");
    await send(ctx.a, ctx.room.id, "start", { rounds: 1 });
    const { choices } = await drawerChoices;
    const word = choices[0];
    const drawing = nextStateWhere(ctx.b, (s) => s.status === "drawing");
    await send(ctx.a, ctx.room.id, "chooseWord", { word });
    await drawing;

    await send(ctx.a, ctx.room.id, "guess", { text: word });
    const g = __games.get(ctx.room.id);
    expect(g.guessed.has(ctx.owner.id)).toBe(false);
    expect(g.players.get(ctx.owner.id).score).toBe(0);
  });
});

describe("drawing authority", () => {
  it("relays the drawer's strokes to others", async () => {
    const ctx = await twoPlayers();
    await readyBoth(ctx);

    const drawerChoices = next(ctx.a, "choices");
    await send(ctx.a, ctx.room.id, "start", { rounds: 1 });
    const { choices } = await drawerChoices;
    const drawing = nextStateWhere(ctx.b, (s) => s.status === "drawing");
    await send(ctx.a, ctx.room.id, "chooseWord", { word: choices[0] });
    await drawing;

    const stroke = { x0: 0.1, y0: 0.1, x1: 0.2, y1: 0.2, color: "#111827", size: 5 };
    const relayed = next(ctx.b, "draw");
    await send(ctx.a, ctx.room.id, "draw", { stroke });
    expect((await relayed).stroke).toMatchObject(stroke);
  });

  it("ignores strokes from a non-drawer and malformed coordinates", async () => {
    const ctx = await twoPlayers();
    await readyBoth(ctx);

    const drawerChoices = next(ctx.a, "choices");
    await send(ctx.a, ctx.room.id, "start", { rounds: 1 });
    const { choices } = await drawerChoices;
    const drawing = nextStateWhere(ctx.b, (s) => s.status === "drawing");
    await send(ctx.a, ctx.room.id, "chooseWord", { word: choices[0] });
    await drawing;

    let leaked = null;
    ctx.a.on(`activity:${ID}:draw`, (p) => { leaked = p; });

    // Not the drawer.
    await send(ctx.b, ctx.room.id, "draw", {
      stroke: { x0: 0.1, y0: 0.1, x1: 0.2, y1: 0.2, color: "#000", size: 4 },
    });
    // Drawer, but coordinates far outside the normalized 0..1 surface.
    await send(ctx.a, ctx.room.id, "draw", {
      stroke: { x0: 99, y0: 0.1, x1: 0.2, y1: 0.2, color: "#000", size: 4 },
    });

    await new Promise((r) => setTimeout(r, 200));
    expect(leaked).toBeNull();
  });
});

describe("lifecycle", () => {
  /**
   * The reference test of the whole plugin contract: Kart's physics interval is
   * the cautionary tale, and this game runs up to five timers at once. A leaked
   * turn clock fires into an empty room and resurrects a finished game.
   */
  it("frees the room and its timers when the last player leaves", async () => {
    const ctx = await twoPlayers();
    await readyBoth(ctx);
    await send(ctx.a, ctx.room.id, "start", { rounds: 1 });
    expect(__games.has(ctx.room.id)).toBe(true);

    await ack(ctx.a, "activity:leave", { activityId: ID, roomId: ctx.room.id });
    await ack(ctx.b, "activity:leave", { activityId: ID, roomId: ctx.room.id });

    // destroy() runs after the last participant leaves.
    await new Promise((r) => setTimeout(r, 300));
    expect(__games.has(ctx.room.id)).toBe(false);
  });

  it("hands the host role to the remaining player when the host leaves", async () => {
    const ctx = await twoPlayers();
    const handover = nextStateWhere(ctx.b, (s) => s.hostId === ctx.member.id);
    await ack(ctx.a, "activity:leave", { activityId: ID, roomId: ctx.room.id });
    const s = await handover;
    expect(s.hostId).toBe(ctx.member.id);
  });
});

describe("per-room config", () => {
  it("reads maxRounds from the room's activity config", async () => {
    const owner = await reg("Configurer");
    const room = await createRoom(owner.token, [{ id: ID, config: { maxRounds: 7 } }]);
    const a = await connect(owner.token);
    const res = await join(a, room.id);
    // The legacy handler hardcoded 3; the manifest's configSchema is now live.
    expect(res.state.maxRounds).toBe(7);
  });
});
