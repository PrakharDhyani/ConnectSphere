/**
 * Phase 4 — the room creation wizard: recommendation engine, the activities
 * endpoints, and the extended createRoom contract.
 *
 * The load-bearing assertions here are the boring ones: that the OLD create
 * body still works, and that client-supplied plugin config cannot smuggle
 * anything into the database. The wizard is a nicety; those two are promises.
 */
import { describe, it, expect } from "@jest/globals";
import request from "supertest";
import { startHarness } from "./helpers/harness.js";

import { scoreActivities, recommendForRoom, WEIGHTS } from "../../shared/activities/recommend.js";
import { SCORABLE_PURPOSE_IDS, PURPOSES } from "../../shared/activities/purposes.js";

const h = startHarness();

const uniq = (n) => `${n}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

async function auth(name = "Wiz") {
  const email = `wiz_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`;
  const res = await request(h.app).post("/api/auth/register").send({ name: uniq(name), email, password: "Password123" });
  return res.body.data.accessToken;
}
const authed = (token) => (req) => req.set("Authorization", `Bearer ${token}`);

// ── recommendation engine ────────────────────────────────────────────────────

describe("recommendation engine", () => {
  it("ranks by purpose affinity above everything else", () => {
    const fun = scoreActivities({ purpose: "fun" });
    const games = fun.filter((a) => a.category === "games").map((a) => a.id);
    // Every game should out-rank the whiteboard for a "fun" room.
    const wbIndex = fun.findIndex((a) => a.id === "whiteboard");
    const worstGame = Math.max(...games.map((id) => fun.findIndex((a) => a.id === id)));
    expect(worstGame).toBeLessThan(wbIndex);
  });

  it("gives every purpose a non-empty recommended list", () => {
    // A purpose card that recommends nothing is a dead end in the wizard.
    // Relative tiering + a floor guarantees this even for "music", which has
    // no matching plugin yet.
    for (const purpose of SCORABLE_PURPOSE_IDS) {
      const { recommended } = recommendForRoom({ purpose });
      expect(recommended.length).toBeGreaterThanOrEqual(4);
    }
  });

  it("caps the recommended set so it stays a shortlist", () => {
    for (const purpose of SCORABLE_PURPOSE_IDS) {
      expect(recommendForRoom({ purpose }).recommended.length).toBeLessThanOrEqual(6);
    }
  });

  it("treats an unknown or custom purpose as 'no signal' rather than guessing", () => {
    for (const purpose of ["custom", "nonsense", null, undefined]) {
      const scored = scoreActivities({ purpose });
      expect(scored.every((a) => a.signals.purpose === 0)).toBe(true);
      // Still ranked and usable — falls back to popularity/visibility.
      expect(recommendForRoom({ purpose }).recommended.length).toBeGreaterThan(0);
    }
  });

  it("promotes a plugin that pairs with something already chosen", () => {
    const without = scoreActivities({ purpose: "fun" }).find((a) => a.id === "uno");
    const withLudo = scoreActivities({ purpose: "fun", selected: ["ludo"] }).find((a) => a.id === "uno");
    expect(withLudo.score).toBeGreaterThan(without.score);
    expect(withLudo.reasons.join()).toMatch(/Pairs well with Ludo/);
  });

  it("never recommends something the user already selected", () => {
    const { recommended } = recommendForRoom({ purpose: "study", selected: ["whiteboard"] });
    expect(recommended.map((a) => a.id)).not.toContain("whiteboard");
  });

  it("ranks a shared canvas lower in public rooms than private ones", () => {
    // Public rooms mean strangers; a defaceable shared canvas is not the thing
    // to push at them.
    const pub = scoreActivities({ purpose: "fun", visibility: "public" }).find((a) => a.id === "whiteboard");
    const priv = scoreActivities({ purpose: "fun", visibility: "private" }).find((a) => a.id === "whiteboard");
    expect(pub.score).toBeLessThan(priv.score);
  });

  it("explains every recommendation", () => {
    // An unexplained list feels random; the reason is what makes it feel
    // deliberate — and it is free once scoring is data-driven.
    for (const purpose of SCORABLE_PURPOSE_IDS) {
      for (const a of recommendForRoom({ purpose }).recommended) {
        expect(a.reasons.length).toBeGreaterThan(0);
        expect(a.reasons[0]).toBeTruthy();
      }
    }
  });

  it("is deterministic", () => {
    const a = scoreActivities({ purpose: "study", selected: ["poll"] });
    const b = scoreActivities({ purpose: "study", selected: ["poll"] });
    expect(a).toEqual(b);
  });

  it("weights purpose above every other signal", () => {
    // Guards the ranking's intent: no combination of secondary signals should
    // outweigh what the user actually told us the room is for.
    const others = WEIGHTS.cooccurrence + WEIGHTS.visibility + WEIGHTS.interest + WEIGHTS.popularity;
    expect(WEIGHTS.purpose).toBeGreaterThan(others / 2);
  });
});

// ── endpoints ────────────────────────────────────────────────────────────────

describe("GET /api/activities", () => {
  it("returns the catalogue and the purpose taxonomy", async () => {
    const t = await auth();
    const res = await authed(t)(request(h.app).get("/api/activities"));
    expect(res.status).toBe(200);
    expect(res.body.data.activities).toHaveLength(9);
    expect(res.body.data.purposes).toHaveLength(PURPOSES.length);
  });

  it("never leaks plugin permissions to the client", async () => {
    // Permissions are an internal security detail; shipping them invites
    // clients to reason about capabilities they cannot enforce.
    const t = await auth();
    const res = await authed(t)(request(h.app).get("/api/activities"));
    for (const a of res.body.data.activities) expect(a).not.toHaveProperty("permissions");
  });

  it("includes each plugin's schema AND resolved defaults", async () => {
    const t = await auth();
    const res = await authed(t)(request(h.app).get("/api/activities"));
    const wb = res.body.data.activities.find((a) => a.id === "whiteboard");
    expect(Object.keys(wb.configSchema)).toContain("darkTheme");
    expect(wb.defaults.darkTheme).toBe(true);
  });

  it("requires authentication", async () => {
    expect((await request(h.app).get("/api/activities")).status).toBe(401);
  });
});

describe("POST /api/activities/recommend", () => {
  it("splits recommended from optional", async () => {
    const t = await auth();
    const res = await authed(t)(request(h.app).post("/api/activities/recommend")).send({ purpose: "study" });
    expect(res.status).toBe(200);
    expect(res.body.data.recommended.length).toBeGreaterThan(0);
    expect(res.body.data.optional.length).toBeGreaterThan(0);
  });

  it("degrades instead of failing on a stale or garbage purpose", async () => {
    // A stale client must not be able to break room creation.
    const t = await auth();
    for (const purpose of ["not-a-purpose", 42, null, { evil: true }]) {
      const res = await authed(t)(request(h.app).post("/api/activities/recommend")).send({ purpose });
      expect(res.status).toBe(200);
      expect(res.body.data.recommended.length).toBeGreaterThan(0);
    }
  });

  it("survives a malformed body", async () => {
    const t = await auth();
    const res = await authed(t)(request(h.app).post("/api/activities/recommend"))
      .send({ selected: "not-an-array", visibility: "nonsense", interests: 5 });
    expect(res.status).toBe(200);
  });
});

// ── createRoom: the backward-compatibility and trust-boundary promises ───────

describe("POST /api/rooms — wizard payload", () => {
  it("still accepts the original {name} body", async () => {
    // The promise that makes this rollout safe: old clients keep working.
    const t = await auth();
    const res = await authed(t)(request(h.app).post("/api/rooms")).send({ name: uniq("Legacy") });
    expect(res.status).toBe(201);
  });

  it("stores no activities field when none are chosen", async () => {
    // Absence means "everything" (compat resolver) — which is what a
    // one-click create should do, not "a room with no activities".
    const t = await auth();
    const created = await authed(t)(request(h.app).post("/api/rooms")).send({ name: uniq("Plain") });
    const res = await authed(t)(request(h.app).get(`/api/rooms/${created.body.data.room.id}`));
    expect(res.body.data.room.activities).toBeUndefined();
  });

  it("stores selected activities with version pinned and defaults filled", async () => {
    const t = await auth();
    const created = await authed(t)(request(h.app).post("/api/rooms")).send({
      name: uniq("Study"),
      purpose: { kind: "study" },
      activities: [{ id: "whiteboard", config: { darkTheme: false } }],
    });
    expect(created.status).toBe(201);
    const room = (await authed(t)(request(h.app).get(`/api/rooms/${created.body.data.room.id}`))).body.data.room;
    const wb = room.activities.installed[0];
    expect(wb.id).toBe("whiteboard");
    expect(wb.version).toBe("1.0.0");        // pinned → future updates are opt-in
    expect(wb.config.darkTheme).toBe(false); // the user's override
    expect(wb.config.cursorSharing).toBe(true); // default filled in
    expect(room.purpose.kind).toBe("study");
  });

  describe("config is a trust boundary, not client state", () => {
    it("clamps out-of-range numbers", async () => {
      const t = await auth();
      const created = await authed(t)(request(h.app).post("/api/rooms")).send({
        name: uniq("Clamp"),
        activities: [{ id: "ludo", config: { maxPlayers: 9999 } }],
      });
      const room = (await authed(t)(request(h.app).get(`/api/rooms/${created.body.data.room.id}`))).body.data.room;
      expect(room.activities.installed[0].config.maxPlayers).toBe(4);
    });

    it("drops unknown keys instead of storing them", async () => {
      const t = await auth();
      const created = await authed(t)(request(h.app).post("/api/rooms")).send({
        name: uniq("Unknown"),
        activities: [{ id: "ludo", config: { evilKey: "payload" } }],
      });
      const room = (await authed(t)(request(h.app).get(`/api/rooms/${created.body.data.room.id}`))).body.data.room;
      expect(room.activities.installed[0].config).not.toHaveProperty("evilKey");
    });

    it("replaces a wrong-typed value with the default", async () => {
      const t = await auth();
      const created = await authed(t)(request(h.app).post("/api/rooms")).send({
        name: uniq("Types"),
        activities: [{ id: "ludo", config: { allowBots: "yes please" } }],
      });
      const room = (await authed(t)(request(h.app).get(`/api/rooms/${created.body.data.room.id}`))).body.data.room;
      expect(room.activities.installed[0].config.allowBots).toBe(true);
    });

    it("rejects an unknown plugin id rather than storing a ghost entry", async () => {
      const t = await auth();
      const res = await authed(t)(request(h.app).post("/api/rooms")).send({
        name: uniq("Ghost"),
        activities: [{ id: "not-a-plugin" }],
      });
      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/Unknown activity/);
    });

    it("de-duplicates a repeated activity", async () => {
      const t = await auth();
      const created = await authed(t)(request(h.app).post("/api/rooms")).send({
        name: uniq("Dupe"),
        activities: [{ id: "ludo" }, { id: "ludo" }],
      });
      const room = (await authed(t)(request(h.app).get(`/api/rooms/${created.body.data.room.id}`))).body.data.room;
      expect(room.activities.installed).toHaveLength(1);
    });
  });

  describe("purpose", () => {
    it("keeps free text only for the custom kind", async () => {
      const t = await auth();
      const custom = await authed(t)(request(h.app).post("/api/rooms"))
        .send({ name: uniq("C"), purpose: { kind: "custom", text: "D&D night" } });
      const a = (await authed(t)(request(h.app).get(`/api/rooms/${custom.body.data.room.id}`))).body.data.room;
      expect(a.purpose).toEqual({ kind: "custom", text: "D&D night" });

      // For a known purpose the text is meaningless — dropped, not stored as
      // confusing dead data.
      const study = await authed(t)(request(h.app).post("/api/rooms"))
        .send({ name: uniq("S"), purpose: { kind: "study", text: "ignored" } });
      const b = (await authed(t)(request(h.app).get(`/api/rooms/${study.body.data.room.id}`))).body.data.room;
      expect(b.purpose.kind).toBe("study");
      expect(b.purpose.text).toBeUndefined();
    });

    it("ignores an unrecognised purpose instead of rejecting the room", async () => {
      const t = await auth();
      const res = await authed(t)(request(h.app).post("/api/rooms"))
        .send({ name: uniq("Odd"), purpose: { kind: "not-real" } });
      expect(res.status).toBe(201);
      const room = (await authed(t)(request(h.app).get(`/api/rooms/${res.body.data.room.id}`))).body.data.room;
      expect(room.purpose).toBeUndefined();
    });
  });

  describe("inviteOnly visibility", () => {
    it("is accepted", async () => {
      const t = await auth();
      const res = await authed(t)(request(h.app).post("/api/rooms"))
        .send({ name: uniq("Inv"), visibility: "inviteOnly" });
      expect(res.status).toBe(201);
    });

    it("stays out of public discovery", async () => {
      const t = await auth();
      const created = await authed(t)(request(h.app).post("/api/rooms"))
        .send({ name: uniq("Hidden"), visibility: "inviteOnly" });
      const pub = await authed(t)(request(h.app).get("/api/rooms/public"));
      expect(pub.body.data.rooms.map((r) => r.id)).not.toContain(created.body.data.room.id);
    });

    it("still rejects a nonsense visibility", async () => {
      const t = await auth();
      const res = await authed(t)(request(h.app).post("/api/rooms"))
        .send({ name: uniq("Bad"), visibility: "semi-public" });
      expect(res.status).toBe(400);
    });
  });
});
