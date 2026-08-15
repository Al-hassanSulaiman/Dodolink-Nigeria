/**
 * Resilience tests for POST /api/contact.
 *
 * Verifies the two critical guarantees introduced by the DB-save feature:
 *   1. Email failure after a successful DB insert → lead is preserved, response is 200
 *   2. DB insert failure → no silent data loss, response is 500
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import { Router } from "express";

// ---------------------------------------------------------------------------
// Mocks — must be hoisted before any imports that pull in the real modules
// ---------------------------------------------------------------------------

const mockInsert = vi.fn();
vi.mock("@workspace/db", () => ({
  db: {
    insert: () => ({
      values: mockInsert,
    }),
  },
  contactLeadsTable: {},
}));

const mockSendMail = vi.fn();
vi.mock("nodemailer", () => ({
  default: {
    createTransport: () => ({
      sendMail: mockSendMail,
    }),
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

beforeEach(() => {
  process.env.GMAIL_APP_PASSWORD = "test-password";
  vi.clearAllMocks();
});

async function buildApp() {
  // Dynamic import so vi.mock() hoisting takes effect before the module loads.
  const { default: contactRouter } = await import("./contact");
  const app = express();
  app.use(express.json());
  app.use("/api", contactRouter);
  return app;
}

const VALID_BODY = {
  name: "Alice",
  email: "alice@example.com",
  description: "Need a portfolio site",
  budget: "$3,000",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/contact — DB + email resilience", () => {
  it("returns 200 and keeps the lead when the email send fails", async () => {
    // DB succeeds, email throws
    mockInsert.mockResolvedValue(undefined);
    mockSendMail.mockRejectedValue(new Error("SMTP timeout"));

    const app = await buildApp();
    const res = await request(app).post("/api/contact").send(VALID_BODY);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    // The DB insert must have been called exactly once
    expect(mockInsert).toHaveBeenCalledTimes(1);
  });

  it("returns 500 when the DB insert fails", async () => {
    // DB throws, email would succeed (but should never be called)
    mockInsert.mockRejectedValue(new Error("DB connection refused"));
    mockSendMail.mockResolvedValue({ messageId: "test-id" });

    const app = await buildApp();
    const res = await request(app).post("/api/contact").send(VALID_BODY);

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/could not save/i);
    // Email must NOT have been attempted — the lead was not persisted
    expect(mockSendMail).not.toHaveBeenCalled();
  });
});
