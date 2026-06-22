import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, pushTokensTable } from "@workspace/db";
import { RegisterPushTokenBody } from "@workspace/api-zod";

const router: IRouter = Router();

router.post("/push-tokens", async (req, res): Promise<void> => {
  const parsed = RegisterPushTokenBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { userId, token } = parsed.data;

  // Upsert: if token already registered for user, update; otherwise insert
  const existing = await db
    .select()
    .from(pushTokensTable)
    .where(eq(pushTokensTable.userId, userId));

  const tokenExists = existing.find((r) => r.token === token);
  if (!tokenExists) {
    await db.insert(pushTokensTable).values({ userId, token });
  }

  res.json({ status: "ok" });
});

export default router;
