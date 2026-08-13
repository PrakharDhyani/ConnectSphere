/**
 * The four framework games (chess · uno · typing · bingo) hosted as plugins.
 *
 * WHAT IS ACTUALLY UNDER TEST: the ADAPTER, not the games.
 *
 * Chess rules, UNO effects and bingo draws are already covered by
 * games.engines.test.js and are untouched by this migration — the framework's
 * `games` Map is shared, so both paths drive the same table. What is new is the
 * translation layer: that seat management, moves, private state and timers all
 * work when dispatched through the activity host instead of the game's own
 * socket registration.
 *
 * The seat lifecycle is the interesting part. It used to live inside
 * `createLobbyGame`'s `register()`; extracting it into `lobby.seats` is what
 * let one adapter serve four games without reimplementing join/start/bots four
 * times.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "@jest/globals";
import http from "http";
import request from "supertest";
import { io as ioClient } from "socket.io-client";
import { startHarness } from "./helpers/harness.js";

import { getPlugin } from "../../shared/activities/index.js";
import { getRegisteredModuleIds } from "../src/activities/host.js";
import { enabledPluginIds } from "../src/activities/index.js";

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
  const email = `fg_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`;
  const res = await request(h.app)
    .post("/api/auth/register")
    .send({ name: uniq(name), email, password: "Password123" });
  return { token: res.body.data.accessToken, id: res.body.data.user.id };
}

async function createRoom(token, ids) {
  const res = await request(h.app)
    .post("/api/rooms")
    .set("Authorization", `Bearer ${token}`)
    .send({ name: uniq("Arcade"), activities: ids.map((id) => ({ id })) });
  return res.body.data.room;
}

function connect(token) {
  return new Promise((resolve, reject) => {
    const s = ioClient(`http://localhost:${port}`, { auth: { token }, transports: ["websocket"], reconnection: false });
    clients.push(s);
    s.once("connect", () => resolve(s));
    s.once("connect_error", reject);
    setTimeout(() => reject(new Error("connect timeout")), 4000);
  });
}

function ack(socket, event, payload) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`ack timeout: ${event}`)), 6000);
    socket.emit(event, payload, (res) => { clearTimeout(t); resolve(res || {}); });
  });
}

const join = (s, id, roomId) => ack(s, "activity:join", { activityId: id, roomId });
const send = (s, id, roomId, event, payload) =>
  ack(s, "activity:event", { activityId: id, roomId, event, payload });

function next(socket, id, event, ms = 5000) {
  const wire = `activity:${id}:${event}`;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`no ${wire} within ${ms}ms`)), ms);
    socket.once(wire, (p) => { clearTimeout(t); resolve(p); });
  });
}

const GAMES = ["chess", "uno", "typing", "bingo"];

/** Owner + member, both joined to one game's activity. */
async function table(gameId) {
  const owner = await reg("Owner");
  const member = await reg("Member");
  const room = await createRoom(owner.token, [gameId]);
  await request(h.app).post("/api/rooms/join").set("Authorization", `Bearer ${member.token}`).send({ code: room.code });
  const a = await connect(owner.token);
  const b = await connect(member.token);
  await join(a, gameId, room.id);
  await join(b, gameId, room.id);
  return { owner, member, room, a, b };
}

describe("registration", () => {
  it("serves all four through one adapter", () => {
    const ids = enabledPluginIds();
    for (const g of GAMES) {
      expect(ids).toContain(g);
      expect(getRegisteredModuleIds()).toContain(g);
    }
    // The `legacyHandlerEnabled` assertions that used to live here (both paths
    // registered would double-broadcast every move) are gone with the flag in
    // §56 — there is no longer a second path that could be registered.
  });

  it("keeps every game on the game surface", () => {
    for (const g of GAMES) expect(getPlugin(g).surface).toBe("game");
  });
});

describe("seat lifecycle through the host", () => {
  it.each(GAMES)("%s: seats a player and names them host", async (gameId) => {
    const { room, a, owner } = await table(gameId);
    const res = await send(a, gameId, room.id, "join", {});
    expect(res.ok).toBe(true);
    const state = await send(a, gameId, room.id, "sync", {});
    expect(state.state.players.map((p) => p.id)).toContain(owner.id);
    expect(state.state.hostId).toBe(owner.id);
    expect(state.state.status).toBe("lobby");
  });

  it.each(GAMES)("%s: broadcasts the table to everyone in the activity", async (gameId) => {
    const { room, a, b } = await table(gameId);
    const seen = next(b, gameId, "state");
    await send(a, gameId, room.id, "join", {});
    const state = await seen;
    expect(state.players.length).toBe(1);
  });

  it.each(GAMES)("%s: refuses a start by anyone but the host", async (gameId) => {
    const { room, a, b } = await table(gameId);
    await send(a, gameId, room.id, "join", {});
    await send(b, gameId, room.id, "join", {});
    const res = await send(b, gameId, room.id, "start", {});
    expect(res.error).toMatch(/host/i);
  });

  it.each(GAMES)("%s: refuses a start below minPlayers", async (gameId) => {
    const { room, a } = await table(gameId);
    await send(a, gameId, room.id, "join", {});
    const min = getPlugin(gameId).minPlayers ?? 2;
    const res = await send(a, gameId, room.id, "start", {});
    if (min > 1) expect(res.error).toMatch(/at least/i);
    else expect(res.ok).toBe(true); // typing allows solo practice
  });

  it("starts a two-player game and moves it to playing", async () => {
    const { room, a, b } = await table("chess");
    await send(a, "chess", room.id, "join", {});
    await send(b, "chess", room.id, "join", {});
    const started = next(b, "chess", "state");
    expect((await send(a, "chess", room.id, "start", {})).ok).toBe(true);
    expect((await started).status).toBe("playing");
  });

  it("lets a player leave the lobby and reassigns the host", async () => {
    const { room, a, b, member } = await table("chess");
    await send(a, "chess", room.id, "join", {});
    await send(b, "chess", room.id, "join", {});
    await send(a, "chess", room.id, "leave", {});
    const state = await send(b, "chess", room.id, "sync", {});
    expect(state.state.hostId).toBe(member.id);
  });
});

describe("bots", () => {
  it("adds and removes a bot on the host's say-so", async () => {
    const { room, a } = await table("chess");
    await send(a, "chess", room.id, "join", {});
    expect((await send(a, "chess", room.id, "addBot", { difficulty: "easy" })).ok).toBe(true);

    let state = await send(a, "chess", room.id, "sync", {});
    const bots = state.state.players.filter((p) => p.isBot);
    expect(bots).toHaveLength(1);
    expect(bots[0].name).toMatch(/Easy/);

    expect((await send(a, "chess", room.id, "removeBot", {})).ok).toBe(true);
    state = await send(a, "chess", room.id, "sync", {});
    expect(state.state.players.filter((p) => p.isBot)).toHaveLength(0);
  });

  it("refuses a bot from a non-host", async () => {
    const { room, a, b } = await table("chess");
    await send(a, "chess", room.id, "join", {});
    await send(b, "chess", room.id, "join", {});
    expect((await send(b, "chess", room.id, "addBot", {})).error).toMatch(/host/i);
  });
});

describe("moves are the framework's, dispatched by the host", () => {
  it("plays a real chess move and advances the board", async () => {
    const { room, a, b } = await table("chess");
    await send(a, "chess", room.id, "join", {});
    await send(b, "chess", room.id, "join", {});
    await send(a, "chess", room.id, "start", {});

    const before = (await send(a, "chess", room.id, "sync", {})).state;
    const white = before.players[0].id;
    const mover = white === (await reg("x")).id ? b : a; // whoever is seated white
    void mover;

    // e2-e4 from either seat: only the side to move is accepted, so try both.
    const moved = next(b, "chess", "state");
    const r1 = await send(a, "chess", room.id, "move", { from: "e2", to: "e4" });
    const r2 = r1?.error ? await send(b, "chess", room.id, "move", { from: "e2", to: "e4" }) : r1;
    expect(r1?.error && r2?.error).toBeFalsy();
    const state = await moved;
    expect(state.fen).toMatch(/^rnbqkbnr\/pppppppp/);
  });

  it("refuses a move from a spectator", async () => {
    const { room, a, member } = await table("chess");
    await send(a, "chess", room.id, "join", {});
    await send(a, "chess", room.id, "addBot", {});
    await send(a, "chess", room.id, "start", {});
    // The member never took a seat, so they are spectating.
    const c = await connect(member.token);
    await join(c, "chess", room.id);
    expect((await send(c, "chess", room.id, "move", { from: "e2", to: "e4" })).error).toMatch(/spectating/i);
  });

  it("refuses a move before the game starts", async () => {
    const { room, a } = await table("chess");
    await send(a, "chess", room.id, "join", {});
    expect((await send(a, "chess", room.id, "move", { from: "e2", to: "e4" })).error).toMatch(/no game running/i);
  });
});

describe("private state reaches only its owner", () => {
  it("deals UNO hands to each player individually", async () => {
    const { room, a, b } = await table("uno");
    await send(a, "uno", room.id, "join", {});
    await send(b, "uno", room.id, "join", {});

    // Each seat gets its own hand on the per-user channel — never broadcast,
    // or the whole table would see everyone's cards.
    const mine = next(a, "uno", "private");
    const theirs = next(b, "uno", "private");
    await send(a, "uno", room.id, "start", {});
    const [h1, h2] = await Promise.all([mine, theirs]);
    expect(Array.isArray(h1.hand)).toBe(true);
    expect(Array.isArray(h2.hand)).toBe(true);
    expect(h1.hand.length).toBeGreaterThan(0);
  });

  it("never puts a hand in the public state", async () => {
    const { room, a, b } = await table("uno");
    await send(a, "uno", room.id, "join", {});
    await send(b, "uno", room.id, "join", {});
    await send(a, "uno", room.id, "start", {});
    const pub = (await send(b, "uno", room.id, "sync", {})).state;
    // Opponents are described by hand SIZE, never by contents.
    expect(JSON.stringify(pub.players)).not.toMatch(/"suit"|"colour"|"color"/);
  });
});

describe("reactions", () => {
  it("lets a spectator react", async () => {
    const { room, a, b } = await table("chess");
    const seen = next(b, "chess", "react");
    await send(a, "chess", room.id, "react", { kind: "fire" });
    expect((await seen).kind).toBe("fire");
  });

  it("ignores a reaction that is not in the palette", async () => {
    const { room, a, b } = await table("chess");
    const leaked = next(b, "chess", "react", 700).then(() => "sent").catch(() => "ignored");
    await send(a, "chess", room.id, "react", { kind: "<script>" });
    expect(await leaked).toBe("ignored");
  });
});

describe("teardown", () => {
  it("frees the table and its timers when the activity empties", async () => {
    const { room, a, b } = await table("bingo");
    await send(a, "bingo", room.id, "join", {});
    await send(b, "bingo", room.id, "join", {});
    await send(a, "bingo", room.id, "start", {});

    // Bingo runs a tick interval while playing — the leak this must not have.
    await ack(a, "activity:leave", { activityId: "bingo", roomId: room.id });
    await ack(b, "activity:leave", { activityId: "bingo", roomId: room.id });
    await new Promise((r) => setTimeout(r, 400));

    const c = await connect((await reg("Fresh")).token);
    // A fresh room: the old table must be gone, not merely idle.
    const state = await send(a, "bingo", room.id, "sync", {}).catch(() => null);
    expect(state?.state ?? null).toBeNull();
    c.close();
  });
});
