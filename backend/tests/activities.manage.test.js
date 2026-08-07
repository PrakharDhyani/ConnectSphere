/**
 * Phase 5 — managing a room's activities after creation.
 *
 * The assertions that earn their place here are the ones about STATE
 * TRANSITIONS, not happy-path CRUD: a legacy room materialising on first edit,
 * an emptied room staying empty, and the active pointer never surviving the
 * removal of what it points at. Each of those is a way a room could end up in
 * a state its owner did not ask for.
 */
import { describe, it, expect } from "@jest/globals";
import request from "supertest";
import { startHarness } from "./helpers/harness.js";
import { resolveInstalled } from "../../shared/activities/index.js";

const h = startHarness();
const uniq = (n) => `${n}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

async function user(name = "U") {
  const email = `mg_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`;
  const res = await request(h.app).post("/api/auth/register").send({ name: uniq(name), email, password: "Password123" });
  return res.body.data.accessToken;
}
const as = (t) => (req) => req.set("Authorization", `Bearer ${t}`);

async function makeRoom(token, body = {}) {
  const res = await as(token)(request(h.app).post("/api/rooms")).send({ name: uniq("Room"), ...body });
  return res.body.data.room;
}
const detail = async (token, id) =>
  (await as(token)(request(h.app).get(`/api/rooms/${id}`))).body.data.room;
const setActivities = (token, id, activities) =>
  as(token)(request(h.app).put(`/api/rooms/${id}/activities`)).send({ activities });

describe("PUT /:id/activities — permissions", () => {
  it("lets the owner change activities", async () => {
    const t = await user("Owner");
    const room = await makeRoom(t);
    expect((await setActivities(t, room.id, [{ id: "chess" }])).status).toBe(200);
  });

  it("refuses a member who is not the owner", async () => {
    const owner = await user("Owner");
    const member = await user("Member");
    const room = await makeRoom(owner);
    await as(member)(request(h.app).post("/api/rooms/join")).send({ code: room.code });
    const res = await setActivities(member, room.id, [{ id: "chess" }]);
    expect(res.status).toBe(403);
  });

  it("refuses a complete outsider", async () => {
    const owner = await user("Owner");
    const outsider = await user("Outsider");
    const room = await makeRoom(owner);
    expect((await setActivities(outsider, room.id, [{ id: "chess" }])).status).toBe(403);
  });
});

describe("legacy rooms materialize on first edit", () => {
  it("starts with no activities field but resolves to everything", async () => {
    const t = await user();
    const room = await makeRoom(t);
    const d = await detail(t, room.id);
    expect(d.activities).toBeUndefined();
    // The compat resolver is what makes the room behave normally meanwhile.
    expect(resolveInstalled(d)).toHaveLength(9);
  });

  it("becomes explicit the moment someone edits it", async () => {
    const t = await user();
    const room = await makeRoom(t);
    await setActivities(t, room.id, [{ id: "whiteboard" }, { id: "poll" }]);
    const d = await detail(t, room.id);
    expect(d.activities.installed).toHaveLength(2);
    expect(d.activities.configured).toBe(true);
  });

  it("carries prior config across the materialization", async () => {
    // A legacy room's "config" is the plugin defaults; those must survive.
    const t = await user();
    const room = await makeRoom(t);
    await setActivities(t, room.id, [{ id: "ludo" }]);
    const ludo = (await detail(t, room.id)).activities.installed[0];
    expect(ludo.config.maxPlayers).toBe(4);
    expect(ludo.config.allowBots).toBe(true);
  });
});

describe("the empty list is a real choice, not a legacy signal", () => {
  /**
   * REGRESSION. `installed: []` means two opposite things — "never configured"
   * (Mongoose materialises a missing array as empty) and "the owner removed
   * everything". Before `activities.configured` existed, removing every
   * activity handed all nine straight back, which is the exact opposite of
   * what was asked. Found by a live API test, not by unit tests.
   */
  it("keeps a room empty after the owner removes everything", async () => {
    const t = await user();
    const room = await makeRoom(t);
    await setActivities(t, room.id, [{ id: "ludo" }]);
    const res = await setActivities(t, room.id, []);
    expect(res.status).toBe(200);

    const d = await detail(t, room.id);
    expect(d.activities.installed).toHaveLength(0);
    expect(d.activities.configured).toBe(true);
    // The resolver must agree — this is where the bug actually lived.
    expect(resolveInstalled(d)).toHaveLength(0);
  });

  it("still treats a never-configured room as having everything", async () => {
    const t = await user();
    const room = await makeRoom(t);
    expect(resolveInstalled(await detail(t, room.id))).toHaveLength(9);
  });

  it("distinguishes the two cases purely by the configured flag", () => {
    expect(resolveInstalled({ activities: { installed: [] } })).toHaveLength(9);
    expect(resolveInstalled({ activities: { installed: [], configured: true } })).toHaveLength(0);
  });
});

describe("config handling on update", () => {
  it("preserves config when an entry is re-sent without one", async () => {
    // Omitting config must mean "leave it alone", not "reset to defaults" —
    // otherwise toggling any activity silently wipes every other one's setup.
    const t = await user();
    const room = await makeRoom(t);
    await setActivities(t, room.id, [{ id: "whiteboard", config: { darkTheme: false } }]);
    await setActivities(t, room.id, [{ id: "whiteboard" }, { id: "poll" }]);
    const wb = (await detail(t, room.id)).activities.installed.find((a) => a.id === "whiteboard");
    expect(wb.config.darkTheme).toBe(false);
  });

  it("clamps and sanitizes on update, not just on create", async () => {
    const t = await user();
    const room = await makeRoom(t);
    await setActivities(t, room.id, [{ id: "ludo", config: { maxPlayers: 9999, evil: "x", allowBots: "yes" } }]);
    const ludo = (await detail(t, room.id)).activities.installed[0];
    expect(ludo.config.maxPlayers).toBe(4);
    expect(ludo.config).not.toHaveProperty("evil");
    expect(ludo.config.allowBots).toBe(true);
  });

  it("keeps the original install metadata across edits", async () => {
    // addedAt/addedBy describe the INSTALL, so re-saving the set must not
    // rewrite history for activities that were already there.
    const t = await user();
    const room = await makeRoom(t);
    await setActivities(t, room.id, [{ id: "chess" }]);
    const first = (await detail(t, room.id)).activities.installed[0];
    await new Promise((r) => setTimeout(r, 20));
    await setActivities(t, room.id, [{ id: "chess" }, { id: "ludo" }]);
    const again = (await detail(t, room.id)).activities.installed.find((a) => a.id === "chess");
    expect(new Date(again.addedAt).getTime()).toBe(new Date(first.addedAt).getTime());
  });

  it("rejects an unknown plugin id", async () => {
    const t = await user();
    const room = await makeRoom(t);
    const res = await setActivities(t, room.id, [{ id: "ghost-plugin" }]);
    expect(res.status).toBe(400);
  });

  it("de-duplicates repeated ids", async () => {
    const t = await user();
    const room = await makeRoom(t);
    await setActivities(t, room.id, [{ id: "ludo" }, { id: "ludo" }, { id: "ludo" }]);
    expect((await detail(t, room.id)).activities.installed).toHaveLength(1);
  });

  it("rejects a malformed body", async () => {
    const t = await user();
    const room = await makeRoom(t);
    const res = await as(t)(request(h.app).put(`/api/rooms/${room.id}/activities`)).send({ activities: "nope" });
    expect(res.status).toBe(400);
  });
});

describe("PUT /:id/activities/active", () => {
  it("lets any member switch the open activity, not just the owner", async () => {
    // Starting a game is participation, not administration. Gating it on
    // ownership would make the room worse for no security gain.
    const owner = await user("Owner");
    const member = await user("Member");
    const room = await makeRoom(owner);
    await as(member)(request(h.app).post("/api/rooms/join")).send({ code: room.code });
    await setActivities(owner, room.id, [{ id: "ludo" }]);

    const res = await as(member)(request(h.app).put(`/api/rooms/${room.id}/activities/active`)).send({ activityId: "ludo" });
    expect(res.status).toBe(200);
    expect((await detail(owner, room.id)).activities.active).toBe("ludo");
  });

  it("refuses to activate something the room does not have", async () => {
    const t = await user();
    const room = await makeRoom(t);
    await setActivities(t, room.id, [{ id: "ludo" }]);
    const res = await as(t)(request(h.app).put(`/api/rooms/${room.id}/activities/active`)).send({ activityId: "chess" });
    expect(res.status).toBe(400);
  });

  it("accepts null to go back to chat", async () => {
    const t = await user();
    const room = await makeRoom(t);
    await setActivities(t, room.id, [{ id: "ludo" }]);
    await as(t)(request(h.app).put(`/api/rooms/${room.id}/activities/active`)).send({ activityId: "ludo" });
    const res = await as(t)(request(h.app).put(`/api/rooms/${room.id}/activities/active`)).send({ activityId: null });
    expect(res.status).toBe(200);
    expect((await detail(t, room.id)).activities.active).toBeNull();
  });

  it("clears the pointer when the active activity is removed", async () => {
    // Otherwise the room opens on a tab that no longer exists — a blank screen
    // with no way back except a refresh.
    const t = await user();
    const room = await makeRoom(t);
    await setActivities(t, room.id, [{ id: "ludo" }, { id: "whiteboard" }]);
    await as(t)(request(h.app).put(`/api/rooms/${room.id}/activities/active`)).send({ activityId: "ludo" });
    await setActivities(t, room.id, [{ id: "whiteboard" }]);
    expect((await detail(t, room.id)).activities.active).toBeNull();
  });

  it("refuses an outsider", async () => {
    const owner = await user("Owner");
    const outsider = await user("Outsider");
    const room = await makeRoom(owner);
    await setActivities(owner, room.id, [{ id: "ludo" }]);
    const res = await as(outsider)(request(h.app).put(`/api/rooms/${room.id}/activities/active`)).send({ activityId: "ludo" });
    expect(res.status).toBe(403);
  });
});
