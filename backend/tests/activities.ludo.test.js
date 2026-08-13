/**
 * Ludo as a plugin — the second bespoke migration, and the last before Kart.
 *
 * What is actually at risk in this one, and therefore what is tested:
 *
 *   1. **Colour-keyed seats.** Ludo's seats are not a flat player list; the
 *      board has four fixed positions and turn order is a list of colours. The
 *      seat cap, the bot seats and the host election all key on colour, so an
 *      off-by-one in that model is the most likely regression.
 *   2. **The bot/human shared path.** `doRoll`/`doMove` take no socket: a
 *      human's event validates identity then calls them, and a bot's timer
 *      calls the same functions. Bots therefore cannot make a move a human
 *      couldn't. That invariant survives only if the timers still reach the
 *      room, which after the migration means `detached()`.
 *   3. **Config that was previously hardcoded.** maxPlayers/allowBots/
 *      botDifficulty/turnTimer were declared in the manifest since Phase 1 with
 *      nothing reading them. `turnTimer: 0` ("Off") is the interesting one — a
 *      `|| DEFAULT` would silently re-enable the AFK clock.
 *
 * Driven through real socket.io clients, like the skribbl and sticky-notes
 * suites: every claim here is about behaviour at the boundary.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "@jest/globals";
import http from "http";
import request from "supertest";
import { io as ioClient } from "socket.io-client";
import { startHarness } from "./helpers/harness.js";

import { getPlugin } from "../../shared/activities/index.js";
import { getRegisteredModuleIds } from "../src/activities/host.js";
import { enabledPluginIds } from "../src/activities/index.js";
import { __games } from "../src/activities/ludo/server.js";

const ID = "ludo";

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
  // Six timer handles per game; a leaked bot or AFK clock fires into the next
  // test and makes failures look random.
  for (const roomId of [...__games.keys()]) {
    const g = __games.get(roomId);
    clearTimeout(g.timer);
    clearTimeout(g.botTimer);
    clearTimeout(g.afkTimer);
    clearTimeout(g.autoMoveTimer);
    __games.delete(roomId);
  }
});

const uniq = (n) => `${n}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

async function reg(name) {
  const email = `ld_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`;
  const res = await request(h.app)
    .post("/api/auth/register")
    .send({ name: uniq(name), email, password: "Password123" });
  return { token: res.body.data.accessToken, id: res.body.data.user.id };
}

async function createRoom(token, activities = [{ id: ID }]) {
  const res = await request(h.app)
    .post("/api/rooms")
    .set("Authorization", `Bearer ${token}`)
    .send({ name: uniq("Ludo Room"), activities });
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

/** Wait for a state broadcast matching a predicate (turns advance on timers). */
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

/**
 * Start the game and RESOLVE ONCE IT IS ACTUALLY PLAYING.
 *
 * `start` broadcasts its state synchronously, so a listener armed after the ack
 * has already missed it — a test that awaits `start` and only then waits for
 * "playing" hangs forever on a game that started fine. Arming the listener
 * first, inside the helper, is the fix; the alternative (a sleep) would just be
 * this race with a longer fuse.
 */
async function startAndWait(ctx, pred = (s) => s.status === "playing") {
  const settled = nextStateWhere(ctx.a, pred);
  const res = await send(ctx.a, ctx.room.id, "start");
  if (res.error) throw new Error(`start refused: ${res.error}`);
  return settled;
}

const openActivity = (s, roomId) => ack(s, "activity:join", { activityId: ID, roomId });
const send = (s, roomId, event, payload) =>
  ack(s, "activity:event", { activityId: ID, roomId, event, payload });

/** Two members in one room, both with the activity open (neither seated yet). */
async function twoInARoom(activities) {
  const owner = await reg("Host");
  const member = await reg("Player");
  const room = await createRoom(owner.token, activities);
  await request(h.app)
    .post("/api/rooms/join")
    .set("Authorization", `Bearer ${member.token}`)
    .send({ code: room.code });
  const a = await connect(owner.token);
  const b = await connect(member.token);
  await openActivity(a, room.id);
  await openActivity(b, room.id);
  return { owner, member, room, a, b };
}

describe("registration", () => {
  it("is served by the host", () => {
    // The "falls back when the flag omits it" half of this test went with
    // ludo.handlers.js in §56 — there is no second path left.
    expect(enabledPluginIds()).toContain(ID);
    expect(getRegisteredModuleIds()).toContain(ID);
  });

  it("caps seats at four, because the board has four colours", () => {
    expect(getPlugin(ID).maxPlayers).toBe(4);
    expect(getPlugin(ID).configSchema.maxPlayers.max).toBe(4);
  });
});

describe("seating", () => {
  it("opening the activity does NOT consume a seat", async () => {
    const { room, a } = await twoInARoom();
    const res = await openActivity(a, room.id);
    // Four seats are scarce; a spectator must not take one just by looking.
    expect(res.state.status).toBe("lobby");
    expect(Object.values(res.state.seats).every((s) => s === null)).toBe(true);
  });

  it("seats a player on an explicit join and assigns a colour", async () => {
    const { owner, room, a } = await twoInARoom();
    const res = await send(a, room.id, "join");
    expect(res.error).toBeUndefined();
    expect(res.color).toBe("red"); // first free colour
    const g = __games.get(room.id);
    expect(g.seats.red.id).toBe(owner.id);
  });

  it("is idempotent — joining twice keeps one seat", async () => {
    const { room, a } = await twoInARoom();
    await send(a, room.id, "join");
    await send(a, room.id, "join");
    const g = __games.get(room.id);
    const taken = Object.values(g.seats).filter(Boolean);
    expect(taken).toHaveLength(1);
  });

  it("refuses a non-member of the room", async () => {
    const { room } = await twoInARoom();
    const outsider = await reg("Outsider");
    const c = await connect(outsider.token);
    const res = await openActivity(c, room.id);
    // Enforced by the host, not the plugin.
    expect(res.error).toBeTruthy();
  });

  it("honours a maxPlayers cap below four", async () => {
    const ctx = await twoInARoom([{ id: ID, config: { maxPlayers: 2 } }]);
    await send(ctx.a, ctx.room.id, "join");
    await send(ctx.b, ctx.room.id, "join");
    // Two seats are now full even though the board has four colours.
    const third = await send(ctx.a, ctx.room.id, "addBot", {});
    expect(third.error).toMatch(/seats taken/i);
  });
});

describe("bots", () => {
  it("only the host may add a bot, and it takes a colour", async () => {
    const ctx = await twoInARoom();
    await send(ctx.a, ctx.room.id, "join");
    const notHost = await send(ctx.b, ctx.room.id, "addBot", {});
    expect(notHost.error).toMatch(/host/i);

    const res = await send(ctx.a, ctx.room.id, "addBot", { difficulty: "hard" });
    expect(res.color).toBeTruthy();
    const g = __games.get(ctx.room.id);
    expect(g.seats[res.color].isBot).toBe(true);
    expect(g.seats[res.color].difficulty).toBe("hard");
  });

  it("uses the room's configured difficulty when none is given", async () => {
    const ctx = await twoInARoom([{ id: ID, config: { botDifficulty: "easy" } }]);
    await send(ctx.a, ctx.room.id, "join");
    const res = await send(ctx.a, ctx.room.id, "addBot", {});
    expect(__games.get(ctx.room.id).seats[res.color].difficulty).toBe("easy");
  });

  it("refuses bots when the room disables them", async () => {
    const ctx = await twoInARoom([{ id: ID, config: { allowBots: false } }]);
    await send(ctx.a, ctx.room.id, "join");
    const res = await send(ctx.a, ctx.room.id, "addBot", {});
    expect(res.error).toMatch(/disabled/i);
  });

  it("removes a bot on request", async () => {
    const ctx = await twoInARoom();
    await send(ctx.a, ctx.room.id, "join");
    const added = await send(ctx.a, ctx.room.id, "addBot", {});
    const res = await send(ctx.a, ctx.room.id, "removeBot", { color: added.color });
    expect(res.ok).toBe(true);
    expect(__games.get(ctx.room.id).seats[added.color]).toBeNull();
  });
});

describe("starting and turn flow", () => {
  it("refuses to start with fewer than two seats", async () => {
    const ctx = await twoInARoom();
    await send(ctx.a, ctx.room.id, "join");
    const res = await send(ctx.a, ctx.room.id, "start");
    expect(res.error).toMatch(/2 players/i);
  });

  it("only the host may start", async () => {
    const ctx = await twoInARoom();
    await send(ctx.a, ctx.room.id, "join");
    await send(ctx.b, ctx.room.id, "join");
    const res = await send(ctx.b, ctx.room.id, "start");
    expect(res.error).toMatch(/host/i);
  });

  it("starts, sets turn order from the seated colours, and broadcasts", async () => {
    const ctx = await twoInARoom();
    await send(ctx.a, ctx.room.id, "join");
    await send(ctx.b, ctx.room.id, "join");

    const playing = nextStateWhere(ctx.b, (s) => s.status === "playing");
    const res = await send(ctx.a, ctx.room.id, "start");
    expect(res.ok).toBe(true);

    const s = await playing;
    expect(s.order).toEqual(["red", "green"]);
    expect(s.turn).toBe("red");
    expect(s.tokens.red).toEqual([0, 0, 0, 0]);
  });

  it("rolls the die for the player whose turn it is, and nobody else", async () => {
    const ctx = await twoInARoom();
    await send(ctx.a, ctx.room.id, "join"); // red = owner
    await send(ctx.b, ctx.room.id, "join"); // green = member
    await startAndWait(ctx);

    // Green tries to roll on red's turn — ignored.
    await send(ctx.b, ctx.room.id, "roll");
    await new Promise((r) => setTimeout(r, 200));
    expect(__games.get(ctx.room.id).dice).toBeNull();

    const rolled = nextStateWhere(ctx.a, (s) => s.dice !== null);
    await send(ctx.a, ctx.room.id, "roll");
    const s = await rolled;
    expect(s.dice).toBeGreaterThanOrEqual(1);
    expect(s.dice).toBeLessThanOrEqual(6);
  });
});

describe("the bot timer chain (detached)", () => {
  /**
   * The migration's real risk. Every bot action fires from a setTimeout with no
   * socket in scope — if those timers cannot reach the room, a bot game simply
   * stops advancing, silently and with nothing in the logs.
   *
   * A bot seated FIRST must therefore roll entirely on its own.
   */
  it("a bot takes its turn with no human input at all", async () => {
    const ctx = await twoInARoom();
    // Bot takes red (first free colour) and so acts first.
    const bot = await send(ctx.a, ctx.room.id, "addBot", { difficulty: "easy" });
    expect(bot.color).toBe("red");
    await send(ctx.a, ctx.room.id, "join"); // human takes green

    await send(ctx.a, ctx.room.id, "start");
    // Nothing else is sent: the dice appearing proves the detached bus reached
    // the room from inside a timer.
    const s = await nextStateWhere(ctx.a, (st) => st.dice !== null, 10000);
    expect(s.dice).toBeGreaterThanOrEqual(1);
  });
});

describe("reactions", () => {
  it("echoes a valid sticker to everyone and drops an invalid one", async () => {
    const ctx = await twoInARoom();
    const seen = next(ctx.b, "react");
    await send(ctx.a, ctx.room.id, "react", { kind: "fire" });
    const r = await seen;
    expect(r.kind).toBe("fire");
    expect(r.id).toBeTruthy();

    let leaked = null;
    ctx.b.on(`activity:${ID}:react`, (p) => { leaked = p; });
    await send(ctx.a, ctx.room.id, "react", { kind: "not-a-sticker" });
    await new Promise((r) => setTimeout(r, 200));
    expect(leaked).toBeNull();
  });
});

describe("reset", () => {
  it("keeps the seats so 'play again' does not rebuild the lobby", async () => {
    const ctx = await twoInARoom();
    await send(ctx.a, ctx.room.id, "join");
    await send(ctx.b, ctx.room.id, "join");
    await startAndWait(ctx);

    const backToLobby = nextStateWhere(ctx.b, (s) => s.status === "lobby");
    await send(ctx.a, ctx.room.id, "reset");
    const s = await backToLobby;
    expect(s.seats.red.id).toBe(ctx.owner.id);
    expect(s.seats.green.id).toBe(ctx.member.id);
  });

  it("only the host may reset", async () => {
    const ctx = await twoInARoom();
    await send(ctx.a, ctx.room.id, "join");
    await send(ctx.b, ctx.room.id, "join");
    await startAndWait(ctx);

    await send(ctx.b, ctx.room.id, "reset");
    await new Promise((r) => setTimeout(r, 200));
    expect(__games.get(ctx.room.id).status).toBe("playing");
  });
});

describe("config", () => {
  it("turnTimer 'Off' (0) disables the AFK clock rather than defaulting it", async () => {
    // The bug this guards: `Number(cfg.turnTimer) || DEFAULT` turns 0 into 30s
    // and silently re-enables auto-play in a room that switched it off.
    const ctx = await twoInARoom([{ id: ID, config: { turnTimer: 0 } }]);
    await send(ctx.a, ctx.room.id, "join");
    await send(ctx.b, ctx.room.id, "join");
    const s = await startAndWait(ctx);
    expect(s.turnDeadline).toBeNull();
    expect(__games.get(ctx.room.id).turnMs).toBe(0);
  });

  it("arms a turn deadline when the timer is on", async () => {
    const ctx = await twoInARoom([{ id: ID, config: { turnTimer: 15 } }]);
    await send(ctx.a, ctx.room.id, "join");
    await send(ctx.b, ctx.room.id, "join");
    const s = await startAndWait(ctx, (st) => st.status === "playing" && st.turnDeadline !== null);
    expect(s.turnDeadline).toBeGreaterThan(Date.now());
  });
});

describe("lifecycle", () => {
  /**
   * Six timer handles. The legacy handler had to ask "is any HUMAN still
   * connected?" so a table of bots would not run forever; the host's teardown
   * answers the stronger question — is anyone still in this activity — so a
   * bot-only table is freed for the same reason an empty one is.
   */
  it("frees the room and its timers when the last participant leaves", async () => {
    const ctx = await twoInARoom();
    await send(ctx.a, ctx.room.id, "join");
    await send(ctx.a, ctx.room.id, "addBot", {});
    await send(ctx.a, ctx.room.id, "start");
    expect(__games.has(ctx.room.id)).toBe(true);

    await ack(ctx.a, "activity:leave", { activityId: ID, roomId: ctx.room.id });
    await ack(ctx.b, "activity:leave", { activityId: ID, roomId: ctx.room.id });

    await new Promise((r) => setTimeout(r, 400));
    // A bot-only table must not survive its last human viewer.
    expect(__games.has(ctx.room.id)).toBe(false);
  });

  it("frees a lobby seat when a player leaves before the game starts", async () => {
    const ctx = await twoInARoom();
    await send(ctx.a, ctx.room.id, "join");
    await send(ctx.b, ctx.room.id, "join");
    const freed = nextStateWhere(ctx.a, (s) => s.seats.green === null);
    await send(ctx.b, ctx.room.id, "leave");
    const s = await freed;
    expect(s.seats.green).toBeNull();
    expect(s.seats.red.id).toBe(ctx.owner.id);
  });
});
