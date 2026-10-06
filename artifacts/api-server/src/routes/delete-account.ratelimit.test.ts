import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sendMail: vi.fn(),
  requireUser: vi.fn(),
  requestAccountDeletion: vi.fn(),
}));

vi.mock("nodemailer", () => ({
  default: { createTransport: () => ({ sendMail: mocks.sendMail }) },
}));
vi.mock("../lib/auth", () => ({ requireUser: mocks.requireUser }));
vi.mock("../lib/accountDeletion", () => ({
  requestAccountDeletion: mocks.requestAccountDeletion,
}));

async function buildApp() {
  const { default: router } = await import("./delete-account");
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  app.use("/api", router);
  return app;
}

type App = Awaited<ReturnType<typeof buildApp>>;
function submit(app: App, ip = "198.51.100.1", email = "user@example.com") {
  return request(app)
    .post("/api/delete-account-request")
    .set("X-Forwarded-For", ip)
    .send({ email });
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-06T12:00:00Z"));
  vi.stubEnv("GMAIL_APP_PASSWORD", "test-only-not-a-credential");
  mocks.sendMail.mockResolvedValue({ messageId: "test-message" });
  mocks.requireUser.mockReturnValue("test-user");
  mocks.requestAccountDeletion.mockResolvedValue(true);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("deletion request rate limit", () => {
  it("allows three requests and blocks further emails with a clear 429 and retry header", async () => {
    const app = await buildApp();
    for (let i = 0; i < 3; i++) {
      const response = await submit(app);
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ok: true });
    }
    for (let i = 0; i < 2; i++) {
      const response = await submit(app);
      expect(response.status).toBe(429);
      expect(response.body.error).toBe("Too many deletion requests. Please try again in an hour.");
      expect(response.headers["retry-after"]).toBe("3600");
    }
    expect(mocks.sendMail).toHaveBeenCalledTimes(3);
  });

  it("keeps limits separate for different visitors", async () => {
    const app = await buildApp();
    for (let i = 0; i < 3; i++) await submit(app);
    expect((await submit(app)).status).toBe(429);
    expect((await submit(app, "198.51.100.2")).status).toBe(200);
    expect(mocks.sendMail).toHaveBeenCalledTimes(4);
  });

  it("does not let changing emails or authorization headers bypass the IP limit", async () => {
    const app = await buildApp();
    for (let i = 0; i < 3; i++) await submit(app, undefined, `user${i}@example.com`);
    const response = await submit(app, undefined, "another@example.com")
      .set("Authorization", "Bearer different-user");
    expect(response.status).toBe(429);
    expect(mocks.sendMail).toHaveBeenCalledTimes(3);
  });

  it("does not trust an attacker-controlled earlier forwarded IP", async () => {
    const app = await buildApp();
    for (let i = 0; i < 3; i++) {
      await submit(app, `203.0.113.${i + 1}, 198.51.100.1`);
    }
    expect((await submit(app, "203.0.113.99, 198.51.100.1")).status).toBe(429);
  });

  it("maintains the hour-long limit and allows requests again when it expires", async () => {
    const app = await buildApp();
    for (let i = 0; i < 3; i++) await submit(app);
    vi.setSystemTime(new Date("2026-10-06T12:59:59Z"));
    const blocked = await submit(app);
    expect(blocked.status).toBe(429);
    expect(blocked.headers["retry-after"]).toBe("1");
    vi.setSystemTime(new Date("2026-10-06T13:00:00Z"));
    expect((await submit(app)).status).toBe(200);
    expect(mocks.sendMail).toHaveBeenCalledTimes(4);
  });

  it("still rejects invalid email addresses without sending mail", async () => {
    const app = await buildApp();
    const response = await submit(app, undefined, "not-an-email");
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Please provide a valid email address.");
    expect(mocks.sendMail).not.toHaveBeenCalled();
  });

  it("leaves authenticated account deletion unaffected by the form limit", async () => {
    const app = await buildApp();
    for (let i = 0; i < 3; i++) await submit(app);
    expect((await submit(app)).status).toBe(429);
    const response = await request(app)
      .delete("/api/account")
      .set("X-Forwarded-For", "198.51.100.1")
      .send({ confirmation: "DELETE" });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "deleted" });
    expect(mocks.requestAccountDeletion).toHaveBeenCalledWith("test-user");
  });
});
