import { describe, it, expect } from "@jest/globals";
import request from "supertest";
import { startHarness, getRefreshSetCookie } from "./helpers/harness.js";

const h = startHarness();

const VALID = { name: "Ada Lovelace", email: "ada@example.com", password: "Password123" };

async function registerValid(app, overrides = {}) {
  return request(app).post("/api/auth/register").send({ ...VALID, ...overrides });
}

describe("POST /api/auth/register", () => {
  it("creates a user, returns access token + safe user, sets httpOnly refresh cookie", async () => {
    const res = await registerValid(h.app);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.accessToken).toEqual(expect.any(String));

    const { user } = res.body.data;
    expect(user).toMatchObject({
      name: VALID.name,
      email: VALID.email,
      role: "user",
      emailVerified: false,
    });
    // Never leak the password hash, even implicitly.
    expect(user).not.toHaveProperty("password");

    const cookie = getRefreshSetCookie(res);
    expect(cookie).toBeTruthy();
    expect(cookie).toMatch(/HttpOnly/i);
  });

  it("sends a verification email on register", async () => {
    await registerValid(h.app);
    expect(h.emails.verifications).toHaveLength(1);
    expect(h.emails.verifications[0].to).toBe(VALID.email);
    expect(h.emails.verifications[0].url).toContain("/api/auth/verify-email?token=");
  });

  it("rejects a duplicate email with 409", async () => {
    await registerValid(h.app);
    const res = await registerValid(h.app);
    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
  });

  it("rejects a weak password with 400", async () => {
    const res = await registerValid(h.app, { password: "weak" });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/password/i);
  });

  it("rejects a malformed email with 400", async () => {
    const res = await registerValid(h.app, { email: "not-an-email" });
    expect(res.status).toBe(400);
  });

  it("rejects missing fields with 400", async () => {
    const res = await request(h.app).post("/api/auth/register").send({ email: VALID.email });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/auth/login", () => {
  it("logs in with correct credentials → 200 + token + cookie", async () => {
    await registerValid(h.app);

    const res = await request(h.app)
      .post("/api/auth/login")
      .send({ email: VALID.email, password: VALID.password });

    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    expect(res.body.data.user.email).toBe(VALID.email);
    expect(getRefreshSetCookie(res)).toBeTruthy();
  });

  it("wrong password → generic 401", async () => {
    await registerValid(h.app);
    const res = await request(h.app)
      .post("/api/auth/login")
      .send({ email: VALID.email, password: "WrongPassword1" });

    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe("Invalid email or password");
  });

  it("unknown email → identical generic 401 (no enumeration oracle)", async () => {
    const res = await request(h.app)
      .post("/api/auth/login")
      .send({ email: "nobody@example.com", password: "Password123" });

    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe("Invalid email or password");
  });

  it("missing password → 400 validation", async () => {
    const res = await request(h.app).post("/api/auth/login").send({ email: VALID.email });
    expect(res.status).toBe(400);
  });
});
