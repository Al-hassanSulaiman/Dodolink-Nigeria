import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const getAuthMock = vi.fn();
const loggerInfoMock = vi.fn();
const loggerWarnMock = vi.fn();
const loggerErrorMock = vi.fn();

function makeSelectChain(rows: unknown[]) {
  const chain: any = {
    from: () => chain,
    where: () => Promise.resolve(rows),
  };
  return chain;
}

const dbMock = {
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
};

vi.mock("@clerk/express", () => ({
  getAuth: (req: unknown) => getAuthMock(req),
}));

vi.mock("@workspace/db", () => ({
  db: dbMock,
  pushTokensTable: {
    id: Symbol("pushTokens.id"),
    userId: Symbol("pushTokens.userId"),
    token: Symbol("pushTokens.token"),
    updatedAt: Symbol("pushTokens.updatedAt"),
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((column: unknown, value: unknown) => ({ column, value })),
}));

vi.mock("../lib/logger", () => ({
  logger: {
    info: loggerInfoMock,
    warn: loggerWarnMock,
    error: loggerErrorMock,
  },
}));

async function buildApp() {
  const { default: router } = await import("./push_tokens");
  const app = express();
  app.use(express.json());
  app.use(router);
  return app;
}

describe("push registration routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthMock.mockReturnValue({ userId: "user_123" });
  });

  it("requires authentication for registration diagnostics", async () => {
    getAuthMock.mockReturnValue({ userId: null });
    const response = await request(await buildApp())
      .post("/push-registration-diagnostics")
      .send({
        attemptId: "attempt-1",
        stage: "started",
        outcome: "started",
        platform: "android",
        appVersion: "1.0.0",
        buildVersion: "9",
      });

    expect(response.status).toBe(401);
    expect(loggerInfoMock).not.toHaveBeenCalled();
  });

  it("rejects malformed registration diagnostics", async () => {
    const response = await request(await buildApp())
      .post("/push-registration-diagnostics")
      .send({
        attemptId: "attempt-2",
        stage: "unknown-stage",
        outcome: "success",
        platform: "android",
        appVersion: "1.0.0",
        buildVersion: "9",
      });

    expect(response.status).toBe(400);
    expect(loggerInfoMock).not.toHaveBeenCalled();
  });

  it("logs safe correlated registration diagnostics", async () => {
    const response = await request(await buildApp())
      .post("/push-registration-diagnostics")
      .send({
        attemptId: "attempt-3",
        stage: "expo-token",
        outcome: "timeout",
        platform: "android",
        appVersion: "1.0.0",
        buildVersion: "9",
        errorCode: "expo-token-timeout",
      });

    expect(response.status).toBe(200);
    expect(loggerInfoMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user_123",
        attemptId: "attempt-3",
        stage: "expo-token",
        outcome: "timeout",
        errorCode: "expo-token-timeout",
      }),
      "Push registration diagnostic",
    );
    expect(JSON.stringify(loggerInfoMock.mock.calls)).not.toContain("ExpoPushToken[");
  });

  it("rejects a token registered for a different authenticated user", async () => {
    const response = await request(await buildApp())
      .post("/push-tokens")
      .send({
        userId: "user_other",
        token: "ExpoPushToken[secret-device-token]",
        attemptId: "attempt-4",
      });

    expect(response.status).toBe(403);
    expect(dbMock.select).not.toHaveBeenCalled();
    expect(JSON.stringify(loggerWarnMock.mock.calls)).not.toContain(
      "ExpoPushToken[secret-device-token]",
    );
  });

  it("persists a new token while keeping it out of logs", async () => {
    const onConflictDoUpdateMock = vi.fn().mockResolvedValue(undefined);
    const valuesMock = vi.fn().mockReturnValue({
      onConflictDoUpdate: onConflictDoUpdateMock,
    });
    dbMock.insert.mockReturnValue({ values: valuesMock });

    const response = await request(await buildApp())
      .post("/push-tokens")
      .send({
        userId: "user_123",
        token: "ExpoPushToken[secret-device-token]",
        attemptId: "attempt-5",
      });

    expect(response.status).toBe(200);
    expect(valuesMock).toHaveBeenCalledWith({
      userId: "user_123",
      token: "ExpoPushToken[secret-device-token]",
    });
    expect(onConflictDoUpdateMock).toHaveBeenCalledWith({
      target: expect.anything(),
      set: {
        userId: "user_123",
        updatedAt: expect.any(Date),
      },
    });
    expect(dbMock.select).not.toHaveBeenCalled();
    expect(loggerInfoMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user_123",
        attemptId: "attempt-5",
      }),
      "Push token registered or refreshed",
    );
    expect(JSON.stringify(loggerInfoMock.mock.calls)).not.toContain(
      "ExpoPushToken[secret-device-token]",
    );
  });
});