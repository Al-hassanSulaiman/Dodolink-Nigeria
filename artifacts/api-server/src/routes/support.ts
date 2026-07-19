import { Router, type IRouter } from "express";
import { and, asc, eq } from "drizzle-orm";
import { clerkClient } from "@clerk/express";
import { db, supportMessagesTable } from "@workspace/db";
import { SendSupportMessageBody } from "@workspace/api-zod";
import { requireUser } from "../lib/auth";

const router: IRouter = Router();

router.get("/support/messages", async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;

  const messages = await db
    .select()
    .from(supportMessagesTable)
    .where(eq(supportMessagesTable.userId, userId))
    .orderBy(asc(supportMessagesTable.createdAt));

  res.json(messages);
});

router.post("/support/messages", async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;

  const parsed = SendSupportMessageBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const body = parsed.data.body.trim();
  if (!body) { res.status(400).json({ error: "Message cannot be empty" }); return; }

  let userName = "Dodolink user";
  let userEmail: string | null = null;
  try {
    const user = await clerkClient.users.getUser(userId);
    const fullName = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
    userEmail = user.emailAddresses[0]?.emailAddress ?? null;
    userName = fullName || userEmail || userName;
  } catch (err) {
    req.log.warn({ err }, "Could not fetch Clerk user for support message; using fallback name");
  }

  const [message] = await db
    .insert(supportMessagesTable)
    .values({
      userId,
      userName,
      userEmail,
      senderRole: "user",
      body,
      readByUser: true,
      readByAdmin: false,
    })
    .returning();

  res.status(201).json(message);
});

router.post("/support/read", async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;

  await db
    .update(supportMessagesTable)
    .set({ readByUser: true })
    .where(and(eq(supportMessagesTable.userId, userId), eq(supportMessagesTable.senderRole, "admin")));

  res.json({ status: "ok" });
});

export default router;
