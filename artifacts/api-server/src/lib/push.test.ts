import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { logger } = vi.hoisted(() => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock("./logger", () => ({ logger }));

import { notifyTokens } from "./push";

describe("notifyTokens", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ data: [{ status: "ok" }] }),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends chat alerts at high priority through the messages channel", async () => {
    await notifyTokens(
      ["not-a-token", "ExpoPushToken[registered-phone]"],
      "Reply from Bullets phones",
      "Hello!",
      { conversationId: 42 },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    const payload = JSON.parse(init.body);

    expect(payload).toEqual([expect.objectContaining({
      to: "ExpoPushToken[registered-phone]",
      channelId: "messages",
      priority: "high",
      sound: "default",
      data: { conversationId: 42 },
    })]);
  });

  it("logs provider ticket errors without exposing device tokens", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        data: [{ status: "error", message: "DeviceNotRegistered", details: { error: "DeviceNotRegistered" } }],
      }),
    });

    await notifyTokens(["ExponentPushToken[old-device]"], "New message", "Hello");

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ rejected: 1 }),
      "Expo rejected one or more push notifications",
    );
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("ExponentPushToken");
  });
});