import { Router, type IRouter } from "express";
import { db, pushTokensTable } from "@workspace/db";
import {
  RegisterPushTokenBody,
  ReportPushRegistrationDiagnosticBody,
} from "@workspace/api-zod";
import { requireUser } from "../lib/auth";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const DIAGNOSTIC_WINDOW_MS = 60_000;
const MAX_DIAGNOSTICS_PER_WINDOW = 40;
const diagnosticBuckets = new Map<string, { count: number; startedAt: number }>();

function allowDiagnostic(userId: string): boolean {
  const now = Date.now();
  const current = diagnosticBuckets.get(userId);

  if (!current || now - current.startedAt >= DIAGNOSTIC_WINDOW_MS) {
    diagnosticBuckets.set(userId, { count: 1, startedAt: now });
    return true;
  }

  if (current.count >= MAX_DIAGNOSTICS_PER_WINDOW) return false;
  current.count += 1;
  return true;
}

router.post("/push-registration-diagnostics", (req, res): void => {
  const authUserId = requireUser(req, res);
  if (!authUserId) return;

  const parsed = ReportPushRegistrationDiagnosticBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  if (allowDiagnostic(authUserId)) {
    logger.info(
      { userId: authUserId, ...parsed.data },
      "Push registration diagnostic",
    );
  }

  res.json({ status: "ok" });
});

router.post("/push-tokens", async (req, res): Promise<void> => {
  const authUserId = requireUser(req, res);
  if (!authUserId) return;

  const parsed = RegisterPushTokenBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { userId, token, attemptId } = parsed.data;
  if (userId !== authUserId) {
    logger.warn(
      { authUserId, requestedUserId: userId, attemptId },
      "Push token registration rejected: user mismatch",
    );
    res.status(403).json({ error: "userId must match the authenticated user" });
    return;
  }

  logger.info({ userId, attemptId }, "Push token registration received");

  try {
    await db
      .insert(pushTokensTable)
      .values({ userId, token })
      .onConflictDoUpdate({
        target: pushTokensTable.token,
        set: { userId, updatedAt: new Date() },
      });
    logger.info(
      { userId, attemptId },
      "Push token registered or refreshed",
    );
  } catch (error) {
    logger.error(
      { userId, attemptId, err: error },
      "Push token persistence failed",
    );
    res.status(500).json({ error: "Could not save notification registration" });
    return;
  }

  res.json({ status: "ok" });
});

export default router;
