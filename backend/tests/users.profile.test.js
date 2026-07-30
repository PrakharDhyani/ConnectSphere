import { describe, it, expect } from "@jest/globals";
import request from "supertest";
import { startHarness } from "./helpers/harness.js";
import { User } from "../src/models/User.js";

const h = startHarness();

const USER = { name: "Marie Curie", email: "marie@example.com", password: "Password123" };

async function registerAndToken(app) {
  const res = await request(app).post("/api/auth/register").send(USER);
  return res.body.data.accessToken;
}

// A tiny valid-enough PNG payload (content isn't parsed — mimetype drives handling).
const PNG_BYTES = Buffer.from("89504e470d0a1a0a", "hex");

describe("PATCH /api/users/me", () => {
  it("updates the name and persists it", async () => {
    const token = await registerAndToken(h.app);

    const res = await request(h.app)
      .patch("/api/users/me")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Marie Skłodowska-Curie" });

    expect(res.status).toBe(200);
    expect(res.body.data.user.name).toBe("Marie Skłodowska-Curie");

    const inDb = await User.findOne({ email: USER.email });
    expect(inDb.name).toBe("Marie Skłodowska-Curie");
  });

  it("rejects an unauthenticated request → 401", async () => {
    const res = await request(h.app).patch("/api/users/me").send({ name: "X Y" });
    expect(res.status).toBe(401);
  });

  it("rejects a too-short name → 400", async () => {
    const token = await registerAndToken(h.app);
    const res = await request(h.app)
      .patch("/api/users/me")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "x" });
    expect(res.status).toBe(400);
  });

  it("rejects an empty body → 400 (must change something)", async () => {
    const token = await registerAndToken(h.app);
    const res = await request(h.app)
      .patch("/api/users/me")
      .set("Authorization", `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it("strips smuggled fields — role cannot be escalated", async () => {
    const token = await registerAndToken(h.app);

    const res = await request(h.app)
      .patch("/api/users/me")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Still Marie", role: "admin", emailVerified: true });

    expect(res.status).toBe(200);
    const inDb = await User.findOne({ email: USER.email });
    expect(inDb.role).toBe("user"); // unknown field silently dropped
    expect(inDb.emailVerified).toBe(false);
  });
});

describe("POST /api/users/me/avatar", () => {
  it("uploads an image, stores the returned URL on the user", async () => {
    const token = await registerAndToken(h.app);

    const res = await request(h.app)
      .post("/api/users/me/avatar")
      .set("Authorization", `Bearer ${token}`)
      .attach("avatar", PNG_BYTES, { filename: "me.png", contentType: "image/png" });

    expect(res.status).toBe(200);
    expect(res.body.data.user.avatarUrl).toContain("/avatars/");

    // The storage layer was actually called with the file's bytes…
    expect(h.uploads).toHaveLength(1);
    expect(h.uploads[0].mimetype).toBe("image/png");
    expect(h.uploads[0].size).toBe(PNG_BYTES.length);

    // …and the URL survived the round-trip to Mongo.
    const inDb = await User.findOne({ email: USER.email });
    expect(inDb.avatarUrl).toBe(h.uploads[0].url);
  });

  it("rejects a non-image mimetype → 400", async () => {
    const token = await registerAndToken(h.app);

    const res = await request(h.app)
      .post("/api/users/me/avatar")
      .set("Authorization", `Bearer ${token}`)
      .attach("avatar", Buffer.from("hello"), { filename: "notes.txt", contentType: "text/plain" });

    expect(res.status).toBe(400);
    expect(h.uploads).toHaveLength(0);
  });

  it("rejects a missing file → 400", async () => {
    const token = await registerAndToken(h.app);
    const res = await request(h.app)
      .post("/api/users/me/avatar")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it("rejects an oversized file (>2MB) → 400", async () => {
    const token = await registerAndToken(h.app);
    const big = Buffer.alloc(2 * 1024 * 1024 + 1, 1);

    const res = await request(h.app)
      .post("/api/users/me/avatar")
      .set("Authorization", `Bearer ${token}`)
      .attach("avatar", big, { filename: "huge.png", contentType: "image/png" });

    expect(res.status).toBe(400);
    expect(h.uploads).toHaveLength(0);
  });

  it("rejects an unauthenticated upload → 401", async () => {
    const res = await request(h.app)
      .post("/api/users/me/avatar")
      .attach("avatar", PNG_BYTES, { filename: "me.png", contentType: "image/png" });
    expect(res.status).toBe(401);
  });
});
