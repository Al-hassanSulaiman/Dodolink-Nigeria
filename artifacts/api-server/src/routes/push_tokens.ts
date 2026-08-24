import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, pushTokensTable } from "@workspace/db";
import { RegisterPushTokenBody } from "@workspace/api-zod";
import { requireUser } from "../lib/auth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.post("/push-tokens", async (req, res): Promise<void> => {
  const authUserId = requireUser(req, res);
  if (!authUserId) return;

  const parsed = RegisterPushTokenBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { userId, token } = parsed.data;
  if (userId !== authUserId) {
    logger.warn(
      { authUserId, requestedUserId: userId },
      "Push token registration rejected: user mismatch",
    );
    res.status(403).json({ error: "userId must match the authenticated user" });
    return;
  }

  logger.info({ userId }, "Push token registration received");

  // Upsert: if token already registered for user, update; otherwise insert
  const existing = await db
    .select()
    .from(pushTokensTable)
    .where(eq(pushTokensTable.userId, userId));

  const tokenExists = existing.find((r) => r.token === token);
  if (tokenExists) {
    await db
      .update(pushTokensTable)
      .set({ updatedAt: new Date() })
      .where(eq(pushTokensTable.id, tokenExists.id));
    logger.info({ userId, tokenCount: existing.length }, "Push token refreshed");
  } else {
    await db.insert(pushTokensTable).values({ userId, token });
    logger.info({ userId, tokenCount: existing.length + 1 }, "Push token registered");
  }

  res.json({ status: "ok" });
});

export default router;
