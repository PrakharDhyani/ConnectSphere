import { describe, it, expect } from "@jest/globals";
import request from "supertest";
import jwt from "jsonwebtoken";
import { startHarness } from "./helpers/harness.js";

const h = startHarness();

const USER = { name: "Katherine Johnson", email: "katherine@example.com", password: "Password123" };

// Register and return a valid access token.
async function registerAndToken(app) {
  const res = await request(app).post("/api/auth/register").send(USER);
  return { token: res.body.data.accessToken, userId: res.body.data.user.id };
}

const signAccess = (payload, opts) =>
  jwt.sign(payload, process.env.JWT_ACCESS_SECRET, opts);

describe("GET /api/users/me", () => {
  it("valid token → 200 with the caller's user", async () => {
    const { token } = await registerAndToken(h.app);

    const res = await request(h.app)
      .get("/api/users/me")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.user).toMatchObject({ email: USER.email, role: "user" });
    expect(res.body.data.user).not.toHaveProperty("password");
  });

  it("no Authorization header → 401", async () => {
    const res = await request(h.app).get("/api/users/me");
    expect(res.status).toBe(401);
  });

  it("malformed header (not Bearer) → 401", async () => {
    const res = await request(h.app)
      .get("/api/users/me")
      .set("Authorization", "Token abc.def.ghi");
    expect(res.status).toBe(401);
  });

  it("garbage bearer token → 401", async () => {
    const res = await request(h.app)
      .get("/api/users/me")
      .set("Authorization", "Bearer not.a.jwt");
    expect(res.status).toBe(401);
  });

  it("token signed with the wrong secret → 401", async () => {
    const forged = jwt.sign({ sub: "abc", role: "user" }, "wrong-secret", { expiresIn: "15m" });
    const res = await request(h.app)
      .get("/api/users/me")
      .set("Authorization", `Bearer ${forged}`);
    expect(res.status).toBe(401);
  });

  it("expired token → 401 (manufactured via negative TTL)", async () => {
    const expired = signAccess({ sub: "abc", role: "user" }, { expiresIn: "-10s" });
    const res = await request(h.app)
      .get("/api/users/me")
      .set("Authorization", `Bearer ${expired}`);
    expect(res.status).toBe(401);
  });

  it("valid token but the user was deleted → 404", async () => {
    // Well-formed token for a non-existent user id.
    const orphan = signAccess({ sub: "64b7f0000000000000000000", role: "user" }, { expiresIn: "15m" });
    const res = await request(h.app)
      .get("/api/users/me")
      .set("Authorization", `Bearer ${orphan}`);
    expect(res.status).toBe(404);
  });
});
