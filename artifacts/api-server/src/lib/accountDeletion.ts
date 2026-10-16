import { clerkClient, getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { storeFollowsTable } from "@workspace/db";
import { accountDeletionsTable, mediaUploadsTable, storesTable, productsTable, conversationsTable, messagesTable, reviewsTable, pushTokensTable, supportMessagesTable, subscriptionPaymentsTable } from "@workspace/db";
import { eq, or, inArray, sql, isNull, lt } from "drizzle-orm";
import type { RequestHandler } from "express";
import { ObjectStorageService, ObjectNotFoundError } from "./objectStorage";
import { SUBSCRIPTION_LOCK_NAMESPACE } from "./subscriptionBilling";
import { logger } from "./logger";
import { getObjectAclPolicy } from "./objectAcl";
import { sendDeletionConfirmation } from "./deletionMail";

export const ACCOUNT_DELETION_LOCK_NAMESPACE = 4243;
export function storedMediaPath(value: string | null): string | null {
  if (!value) return null;
  try {
    const path = new URL(value, "https://local.invalid").pathname;
    const index = path.indexOf("/objects/");
    const objectPath = index >= 0 ? path.slice(index) : "";
    // Only our upload namespace, not arbitrary bucket paths or external URLs.
    return /^\/objects\/uploads\/[a-zA-Z0-9_-]+$/.test(objectPath) ? objectPath : null;
  } catch { return null; }
}

export async function initializeAccountDeletion() {
  // Additive, idempotent initialization, including on a freshly published server.
  await db.execute(sql`CREATE TABLE IF NOT EXISTS account_deletions (
    user_id text PRIMARY KEY, media_paths jsonb NOT NULL DEFAULT '[]'::jsonb,
    requested_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
    contact_email text, uploads_expire_at timestamptz
  )`);
  await db.execute(sql`ALTER TABLE account_deletions ADD COLUMN IF NOT EXISTS contact_email text,
    ADD COLUMN IF NOT EXISTS uploads_expire_at timestamptz`);
  await db.execute(sql`CREATE TABLE IF NOT EXISTS media_uploads (
    path text PRIMARY KEY, user_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
  )`);
}

export const preventDeletedAccountWrites: RequestHandler = async (req, res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method) ||
      (req.method === "DELETE" && req.path === "/account")) { next(); return; }
  const { userId } = getAuth(req);
  if (!userId) { next(); return; }
  try {
    const [job] = await db.select({ userId: accountDeletionsTable.userId })
      .from(accountDeletionsTable).where(eq(accountDeletionsTable.userId, userId));
    if (job) { res.status(403).json({ error: "Account deletion is in progress. Please sign out." }); return; }
    next();
  } catch (err) { next(err); }
};

export async function requestAccountDeletion(userId: string) {
  const [existing] = await db.select().from(accountDeletionsTable).where(eq(accountDeletionsTable.userId, userId));
  if (!existing) {
    const user = await clerkClient.users.getUser(userId);
    const email = user.emailAddresses.find(e => e.id === user.primaryEmailAddressId)?.emailAddress;
    await db.insert(accountDeletionsTable).values({ userId, contactEmail: email ?? null }).onConflictDoNothing();
  }
  return completeAccountDeletion(userId);
}

export async function completeAccountDeletion(userId: string): Promise<boolean> {
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${ACCOUNT_DELETION_LOCK_NAMESPACE}, hashtext(${userId}))`);
      const [job] = await tx.select().from(accountDeletionsTable).where(eq(accountDeletionsTable.userId, userId));
      if (!job || job.completedAt) return;
      const stores = await tx.select().from(storesTable).where(eq(storesTable.ownerUserId, userId));
      const storeIds = stores.map(s => s.id).sort((a, b) => a - b);
      for (const id of storeIds) {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${SUBSCRIPTION_LOCK_NAMESPACE}, ${id})`);
      }
      const conversations = await tx.select({ id: conversationsTable.id }).from(conversationsTable)
        .where(storeIds.length ? or(eq(conversationsTable.customerId, userId), inArray(conversationsTable.storeId, storeIds)) : eq(conversationsTable.customerId, userId));
      const conversationIds = conversations.map(c => c.id);
      const products = storeIds.length ? await tx.select().from(productsTable).where(inArray(productsTable.storeId, storeIds)) : [];
      const uploads = await tx.select().from(mediaUploadsTable).where(eq(mediaUploadsTable.userId, userId));
      const messages = await tx.select({ mediaUrl: messagesTable.mediaUrl }).from(messagesTable)
        .where(eq(messagesTable.senderId, userId));
      const media = [...stores.map(s => s.imageUrl), ...products.flatMap(p => [p.imageUrl, ...p.imageUrls]), ...messages.map(m => m.mediaUrl)];
      const paths = [...new Set([...job.mediaPaths, ...uploads.map(u => u.path), ...media.map(storedMediaPath).filter((p): p is string => !!p)])];
      const expires = Math.max(job.uploadsExpireAt?.getTime() ?? 0, ...uploads.map(u => u.createdAt.getTime() + 16 * 60000));
      await tx.update(accountDeletionsTable).set({ mediaPaths: paths, uploadsExpireAt: expires ? new Date(expires) : null }).where(eq(accountDeletionsTable.userId, userId));
      await tx.delete(messagesTable).where(eq(messagesTable.senderId, userId));
      await tx.delete(storeFollowsTable).where(eq(storeFollowsTable.userId, userId));
      // Other people's replies can survive a legacy store-ownership transfer.
      // Remove copied identity/body/media from their quote, not their own text.
      // Do this after deleting originals: the reply FK prevents a concurrent
      // insert from reintroducing a snapshot after the parent's deletion.
      await tx.update(messagesTable).set({ replyToMessageId: null, replyPreview: null })
        .where(sql`${messagesTable.replyPreview}->>'senderId' = ${userId}`);
      if (conversationIds.length) await tx.delete(conversationsTable).where(inArray(conversationsTable.id, conversationIds));
      // Recompute public ratings after removing the deleted user's reviews.
      const reviewed = await tx.select({ storeId: reviewsTable.storeId }).from(reviewsTable).where(eq(reviewsTable.reviewerId, userId));
      await tx.delete(reviewsTable).where(eq(reviewsTable.reviewerId, userId));
      for (const { storeId } of reviewed) {
        await tx.execute(sql`UPDATE stores SET avg_rating = (SELECT avg(rating) FROM reviews WHERE store_id = ${storeId}),
          total_reviews = (SELECT count(*) FROM reviews WHERE store_id = ${storeId}) WHERE id = ${storeId}`);
      }
      await tx.delete(pushTokensTable).where(eq(pushTokensTable.userId, userId));
      await tx.delete(supportMessagesTable).where(eq(supportMessagesTable.userId, userId));
      if (storeIds.length) {
        await tx.delete(subscriptionPaymentsTable).where(inArray(subscriptionPaymentsTable.storeId, storeIds));
        // Cascades to store products/reviews/chats; also removes automatic-charge credentials.
        await tx.delete(storesTable).where(inArray(storesTable.id, storeIds));
      }
    });
    const [job] = await db.select().from(accountDeletionsTable).where(eq(accountDeletionsTable.userId, userId));
    if (!job || job.completedAt) return true;
    try { await clerkClient.users.deleteUser(userId); }
    catch (err) { if ((err as { status?: number }).status !== 404) throw err; }
    // Presigned PUT URLs live for 15 minutes. Sweep again after expiry so a
    // late upload cannot re-create personal media after deletion has finished.
    if (job.uploadsExpireAt && job.uploadsExpireAt.getTime() > Date.now()) return false;
    const storage = new ObjectStorageService();
    const registered = job.mediaPaths.length
      ? await db.select().from(mediaUploadsTable).where(inArray(mediaUploadsTable.path, job.mediaPaths)) : [];
    const owners = new Map(registered.map(u => [u.path, u.userId]));
    for (const path of job.mediaPaths) {
      const owner = owners.get(path);
      // Removing a borrowed reference is sufficient; never remove the other
      // uploader's file or make this deletion wait for their account.
      if (owner && owner !== userId) continue;
      try {
        const file = await storage.getObjectEntityFile(path);
        if (owner !== userId) {
          const policy = await getObjectAclPolicy(file);
          if (policy?.owner !== userId) throw new Error("Legacy media ownership needs review before safe deletion");
        }
        await file.delete({ ignoreNotFound: true });
      } catch (err) { if (!(err instanceof ObjectNotFoundError)) throw err; }
    }
    if (job.contactEmail) await sendDeletionConfirmation(job.contactEmail);
    await db.delete(mediaUploadsTable).where(eq(mediaUploadsTable.userId, userId));
    await db.update(accountDeletionsTable).set({ completedAt: new Date(), mediaPaths: [], contactEmail: null }).where(eq(accountDeletionsTable.userId, userId));
    return true;
  } catch (err) {
    logger.error({ err }, "Account deletion queued for automatic retry");
    return false;
  }
}

let retrying = false;
export async function retryAccountDeletions() {
  if (retrying) return;
  retrying = true;
  try {
    const pending = await db.select({ userId: accountDeletionsTable.userId }).from(accountDeletionsTable).where(isNull(accountDeletionsTable.completedAt));
    for (const job of pending) await completeAccountDeletion(job.userId);
    await db.delete(accountDeletionsTable).where(lt(accountDeletionsTable.completedAt, new Date(Date.now() - 86400000)));
  } catch (err) { logger.error({ err }, "Account deletion retry failed"); }
  finally { retrying = false; }
}
