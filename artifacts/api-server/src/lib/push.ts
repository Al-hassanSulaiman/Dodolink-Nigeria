import { logger } from "./logger";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

interface PushMessage {
  to: string | string[];
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: "default" | null;
  badge?: number;
  channelId?: string;
  priority?: "default" | "normal" | "high";
}

export async function sendPushNotification(messages: PushMessage[]): Promise<void> {
  if (messages.length === 0) return;
  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(messages),
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, "Expo push API returned non-200");
      return;
    }

    const payload = await res.json().catch(() => null) as {
      data?: Array<{ status?: string; message?: string; details?: unknown }>;
    } | null;
    const rejected = payload?.data?.filter((ticket) => ticket.status === "error") ?? [];
    if (rejected.length > 0) {
      logger.warn(
        {
          rejected: rejected.length,
          failures: rejected.map(({ message, details }) => ({ message, details })),
        },
        "Expo rejected one or more push notifications",
      );
    }
  } catch (err) {
    logger.error({ err }, "Failed to send push notification");
  }
}

export async function notifyTokens(
  tokens: string[],
  title: string,
  body: string,
  data?: Record<string, unknown>,
): Promise<void> {
  if (tokens.length === 0) return;
  const valid = tokens.filter((t) => t.startsWith("ExponentPushToken[") || t.startsWith("ExpoPushToken["));
  if (valid.length === 0) return;
  await sendPushNotification(valid.map((to) => ({
    to,
    title,
    body,
    data,
    sound: "default",
    // The mobile app defines this channel at maximum importance. Without the
    // channel ID Android can place a chat notification on a low-priority
    // default channel and not show a heads-up alert.
    channelId: "messages",
    priority: "high",
  })));
}
