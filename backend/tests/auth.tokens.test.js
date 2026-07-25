import { describe, it, expect } from "@jest/globals";
import request from "supertest";
import { startHarness, getRefreshCookie, getRefreshSetCookie } from "./helpers/harness.js";

const h = startHarness();

const USER = { name: "Grace Hopper", email: "grace@example.com", password: "Password123" };

// Register and return the refresh cookie string (name=value) for reuse.
async function registerAndCookie(app) {
  const res = await request(app).post("/api/auth/register").send(USER);
  return getRefreshCookie(res);
}

describe("POST /api/auth/refresh — rotation", () => {
  it("rotates: issues a new token and a different refresh cookie", async () => {
    const cookieA = await registerAndCookie(h.app);

    const res = await request(h.app).post("/api/auth/refresh").set("Cookie", cookieA);
    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toEqual(expect.any(String));

    const cookieB = getRefreshCookie(res);
    expect(cookieB).toBeTruthy();
    expect(cookieB).not.toBe(cookieA); // rotated, not reissued
  });

  it("detects theft: a stolen pre-rotation cookie is dead after a legit refresh", async () => {
    const stolen = await registerAndCookie(h.app);

    // Legitimate user refreshes first → `stolen`'s jti is rotated out of Redis.
    const legit = await request(h.app).post("/api/auth/refresh").set("Cookie", stolen);
    expect(legit.status).toBe(200);
    const fresh = getRefreshCookie(legit);

    // Attacker replays the old cookie → rejected.
    const replay = await request(h.app).post("/api/auth/refresh").set("Cookie", stolen);
    expect(replay.status).toBe(401);

    // The rotated-to cookie still works.
    const ok = await request(h.app).post("/api/auth/refresh").set("Cookie", fresh);
    expect(ok.status).toBe(200);
  });

  it("no cookie → 401", async () => {
    const res = await request(h.app).post("/api/auth/refresh");
    expect(res.status).toBe(401);
  });

  it("garbage cookie → 401", async () => {
    const res = await request(h.app)
      .post("/api/auth/refresh")
      .set("Cookie", "refreshToken=not.a.jwt");
    expect(res.status).toBe(401);
  });
});

describe("POST /api/auth/logout", () => {
  it("clears the cookie and revokes the token (idempotent end state)", async () => {
    const cookie = await registerAndCookie(h.app);

    const res = await request(h.app).post("/api/auth/logout").set("Cookie", cookie);
    expect(res.status).toBe(200);

    // Cookie is expired back to the client.
    const cleared = getRefreshSetCookie(res);
    expect(cleared).toMatch(/refreshToken=;|Max-Age=0|Expires=Thu, 01 Jan 1970/i);

    // The revoked token can no longer refresh.
    const after = await request(h.app).post("/api/auth/refresh").set("Cookie", cookie);
    expect(after.status).toBe(401);
  });

  it("succeeds even with no/invalid cookie", async () => {
    const res = await request(h.app).post("/api/auth/logout");
    expect(res.status).toBe(200);
  });
});
