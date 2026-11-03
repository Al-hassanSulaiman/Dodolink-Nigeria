import { logger } from "./logger";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";
// Expo makes delivery receipts (the real answer from Apple/Google) available
// some minutes after a send, so they are read later.
const RECEIPT_DELAY_MS = 15 * 60 * 1000;

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
      data?: Array<{ status?: string; id?: string; message?: string; details?: unknown }>;
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

    // A ticket with status "ok" only means Expo accepted the message. Failures
    // from Apple (APNs) or Google (FCM), such as a wrong push key or a stale
    // token, only appear later in the receipt, so log those too.
    const receiptIds = (payload?.data ?? [])
      .filter((ticket) => ticket.status === "ok" && typeof ticket.id === "string")
      .map((ticket) => ticket.id as string);
    if (receiptIds.length > 0) {
      const timer = setTimeout(() => void logPushReceipts(receiptIds), RECEIPT_DELAY_MS);
      timer.unref?.();
    }
  } catch (err) {
    logger.error({ err }, "Failed to send push notification");
  }
}

async function logPushReceipts(ids: string[]): Promise<void> {
  try {
    const res = await fetch(EXPO_RECEIPTS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ ids }),
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, "Expo push receipts API returned non-200");
      return;
    }
    const payload = await res.json().catch(() => null) as {
      data?: Record<string, { status?: string; message?: string; details?: unknown }>;
    } | null;
    const failures = Object.values(payload?.data ?? {}).filter((receipt) => receipt.status === "error");
    if (failures.length > 0) {
      logger.warn(
        {
          checked: ids.length,
          failed: failures.length,
          failures: failures.map(({ message, details }) => ({ message, details })),
        },
        "Push delivery failed after Expo accepted it (see details.error, for example DeviceNotRegistered or InvalidCredentials)",
      );
    }
  } catch (err) {
    logger.error({ err }, "Failed to read push receipts");
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
