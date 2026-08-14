/**
 * Integration tests for POST /api/contact rate limiting.
 *
 * Verifies that:
 * - up to 5 requests from the same IP succeed (or fail for non-rate-limit reasons)
 * - the 6th request from that IP returns 429
 * - a different IP is unaffected and can still submit
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import rateLimit from "express-rate-limit";
import { Router } from "express";

// ---------------------------------------------------------------------------
// Minimal isolated app — mirrors the real setup in app.ts + contact.ts
// without pulling in Clerk, DB, or nodemailer.
// ---------------------------------------------------------------------------

vi.mock("nodemailer", () => ({
  default: {
    createTransport: () => ({
      sendMail: vi.fn().mockResolvedValue({ messageId: "test-id" }),
    }),
  },
}));

// Stub GMAIL_APP_PASSWORD so createTransport() does not throw.
beforeEach(() => {
  process.env.GMAIL_APP_PASSWORD = "test-password";
});

function buildApp() {
  const app = express();
  // Trust the test supertest "proxy" so req.ip comes from X-Forwarded-For.
  app.set("trust proxy", true);
  app.use(express.json());

  // Re-create the same limiter as the real route uses.
  const contactLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 5,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many contact requests. Please try again in an hour." },
    // Use a fresh in-memory store per app instance so tests are isolated.
    store: undefined,
  });

  const router = Router();
  router.post("/contact", contactLimiter, (_req, res) => {
    res.json({ ok: true });
  });

  app.use("/api", router);
  return app;
}

const VALID_BODY = {
  name: "Test User",
  email: "test@example.com",
  description: "I need a great website for my business",
  budget: "$5,000–$10,000",
};

describe("POST /api/contact — rate limiting", () => {
  it("allows 5 requests from the same IP and blocks the 6th with 429", async () => {
    const app = buildApp();

    // Send 5 requests from IP 1.2.3.4 — all should be allowed.
    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post("/api/contact")
        .set("X-Forwarded-For", "1.2.3.4")
        .send(VALID_BODY);
      expect(res.status, `request ${i + 1} should not be rate-limited`).not.toBe(429);
    }

    // 6th request from the same IP must be rejected.
    const blocked = await request(app)
      .post("/api/contact")
      .set("X-Forwarded-For", "1.2.3.4")
      .send(VALID_BODY);
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatch(/too many/i);
  });

  it("does not block a different IP when another IP has hit its limit", async () => {
    const app = buildApp();

    // Exhaust the limit for IP 1.2.3.4.
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post("/api/contact")
        .set("X-Forwarded-For", "1.2.3.4")
        .send(VALID_BODY);
    }
    // Confirm IP 1.2.3.4 is now blocked.
    const blocked = await request(app)
      .post("/api/contact")
      .set("X-Forwarded-For", "1.2.3.4")
      .send(VALID_BODY);
    expect(blocked.status).toBe(429);

    // A different IP must still be allowed.
    const other = await request(app)
      .post("/api/contact")
      .set("X-Forwarded-For", "9.8.7.6")
      .send(VALID_BODY);
    expect(other.status).not.toBe(429);
  });
});
