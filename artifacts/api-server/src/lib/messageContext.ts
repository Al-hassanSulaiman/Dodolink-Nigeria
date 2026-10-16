import { and, eq } from "drizzle-orm";
import { db, messagesTable, productsTable } from "@workspace/db";

type ContextInput = { replyToMessageId?: number | null; productId?: number | null };
type ContextValues = Pick<typeof messagesTable.$inferInsert,
  "replyToMessageId" | "replyPreview" | "productId" | "productPreview">;

/** Resolve references server-side; clients cannot forge a quoted message/product. */
export async function resolveMessageContext(
  conversationId: number, storeId: number, input: ContextInput,
): Promise<{ ok: true; values: ContextValues } | { ok: false; error: string }> {
  for (const value of [input.replyToMessageId, input.productId]) {
    if (value != null && (!Number.isInteger(value) || value < 1 || value > 2147483647)) {
      return { ok: false, error: "Invalid message or product reference" };
    }
  }
  if (input.replyToMessageId != null && input.productId != null) {
    return { ok: false, error: "Choose either a message reply or a product" };
  }
  if (input.replyToMessageId != null) {
    const [original] = await db.select().from(messagesTable).where(and(
      eq(messagesTable.id, input.replyToMessageId),
      eq(messagesTable.conversationId, conversationId),
    ));
    if (!original) return { ok: false, error: "That message is not available in this conversation" };
    return { ok: true, values: {
      replyToMessageId: original.id,
      replyPreview: {
        id: original.id, senderId: original.senderId, senderName: original.senderName,
        body: original.body.slice(0, 500), mediaUrl: original.mediaUrl,
      },
    } };
  }
  if (input.productId != null) {
    const [product] = await db.select().from(productsTable).where(and(
      eq(productsTable.id, input.productId), eq(productsTable.storeId, storeId),
    ));
    if (!product) return { ok: false, error: "That product is not available in this store" };
    return { ok: true, values: {
      productId: product.id,
      productPreview: {
        id: product.id, name: product.name, price: Number(product.price),
        imageUrl: product.imageUrls?.[0] ?? product.imageUrl ?? null,
      },
    } };
  }
  return { ok: true, values: {} };
}
