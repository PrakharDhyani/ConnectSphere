import { describe, it, expect } from "@jest/globals";
import request from "supertest";
import { startHarness } from "./helpers/harness.js";

const h = startHarness();

describe("infrastructure", () => {
  it("GET /api/health → 200 with ok status", async () => {
    const res = await request(h.app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: "ok",
      service: "connectsphere-backend",
    });
  });

  it("unknown route → 404 with error envelope", async () => {
    const res = await request(h.app).get("/api/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.message).toMatch(/route not found/i);
  });

  it("GET /api/auth/google → 501 when OAuth is not configured", async () => {
    const res = await request(h.app).get("/api/auth/google");
    expect(res.status).toBe(501);
    expect(res.body.success).toBe(false);
  });
});
