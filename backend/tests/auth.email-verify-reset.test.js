import { describe, it, expect } from "@jest/globals";
import request from "supertest";
import { startHarness, getRefreshCookie } from "./helpers/harness.js";
import { User } from "../src/models/User.js";

const h = startHarness();

const USER = { name: "Alan Turing", email: "alan@example.com", password: "Password123" };

const tokenFromUrl = (url) => new URL(url).searchParams.get("token");

async function register(app, overrides = {}) {
  return request(app).post("/api/auth/register").send({ ...USER, ...overrides });
}

describe("email verification", () => {
  it("verifies via the emailed link, then rejects reuse (single-use)", async () => {
    await register(h.app);
    const token = tokenFromUrl(h.emails.verifications[0].url);

    const res = await request(h.app).get("/api/auth/verify-email").query({ token });
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("status=success");

    const user = await User.findOne({ email: USER.email });
    expect(user.emailVerified).toBe(true);

    // Reusing the consumed token → invalid.
    const reuse = await request(h.app).get("/api/auth/verify-email").query({ token });
    expect(reuse.status).toBe(302);
    expect(reuse.headers.location).toContain("status=invalid");
  });

  it("bad token → redirect with status=invalid", async () => {
    const res = await request(h.app).get("/api/auth/verify-email").query({ token: "bogus" });
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("status=invalid");
  });

  it("missing token → redirect with status=invalid", async () => {
    const res = await request(h.app).get("/api/auth/verify-email");
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("status=invalid");
  });
});

describe("POST /api/auth/resend-verification (generic, no oracle)", () => {
  it("resends for an existing unverified account", async () => {
    await register(h.app);
    h.emails.verifications.length = 0; // ignore the one from register

    const res = await request(h.app)
      .post("/api/auth/resend-verification")
      .send({ email: USER.email });

    expect(res.status).toBe(200);
    expect(h.emails.verifications).toHaveLength(1);
  });

  it("returns the same 200 for an unknown email but sends nothing", async () => {
    const res = await request(h.app)
      .post("/api/auth/resend-verification")
      .send({ email: "nobody@example.com" });

    expect(res.status).toBe(200);
    expect(h.emails.verifications).toHaveLength(0);
  });

  it("sends nothing for an already-verified account", async () => {
    await register(h.app);
    await User.updateOne({ email: USER.email }, { emailVerified: true });
    h.emails.verifications.length = 0;

    const res = await request(h.app)
      .post("/api/auth/resend-verification")
      .send({ email: USER.email });

    expect(res.status).toBe(200);
    expect(h.emails.verifications).toHaveLength(0);
  });
});

describe("password reset flow", () => {
  it("forgot-password returns identical 200 for real and unknown emails", async () => {
    await register(h.app);
    h.emails.resets.length = 0;

    const real = await request(h.app)
      .post("/api/auth/forgot-password")
      .send({ email: USER.email });
    const unknown = await request(h.app)
      .post("/api/auth/forgot-password")
      .send({ email: "nobody@example.com" });

    expect(real.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(real.body.message).toBe(unknown.body.message);
    // Only the real account triggers an email.
    expect(h.emails.resets).toHaveLength(1);
    expect(h.emails.resets[0].to).toBe(USER.email);
  });

  it("resets the password: new password works, old fails", async () => {
    await register(h.app);
    await request(h.app).post("/api/auth/forgot-password").send({ email: USER.email });
    const token = tokenFromUrl(h.emails.resets[0].url);

    const reset = await request(h.app)
      .post("/api/auth/reset-password")
      .send({ token, password: "NewPassword123" });
    expect(reset.status).toBe(200);

    const withNew = await request(h.app)
      .post("/api/auth/login")
      .send({ email: USER.email, password: "NewPassword123" });
    expect(withNew.status).toBe(200);

    const withOld = await request(h.app)
      .post("/api/auth/login")
      .send({ email: USER.email, password: USER.password });
    expect(withOld.status).toBe(401);
  });

  it("reset revokes all existing sessions", async () => {
    // The register response's refresh cookie is an active session.
    const reg = await register(h.app);
    const oldCookie = getRefreshCookie(reg);

    await request(h.app).post("/api/auth/forgot-password").send({ email: USER.email });
    const token = tokenFromUrl(h.emails.resets[0].url);
    await request(h.app)
      .post("/api/auth/reset-password")
      .send({ token, password: "NewPassword123" });

    // Pre-reset refresh token must be dead.
    const refresh = await request(h.app)
      .post("/api/auth/refresh")
      .set("Cookie", oldCookie);
    expect(refresh.status).toBe(401);
  });

  it("invalid reset token → 400", async () => {
    const res = await request(h.app)
      .post("/api/auth/reset-password")
      .send({ token: "bogus", password: "NewPassword123" });
    expect(res.status).toBe(400);
  });

  it("weak new password → 400 validation", async () => {
    const res = await request(h.app)
      .post("/api/auth/reset-password")
      .send({ token: "whatever", password: "weak" });
    expect(res.status).toBe(400);
  });
});
