import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, productsTable, storesTable } from "@workspace/db";
import { CreateProductBody, UpdateProductBody } from "@workspace/api-zod";

const router: IRouter = Router();

const productSelect = {
  id: productsTable.id,
  storeId: productsTable.storeId,
  storeName: storesTable.name,
  name: productsTable.name,
  description: productsTable.description,
  price: productsTable.price,
  category: productsTable.category,
  imageUrl: productsTable.imageUrl,
  imageUrls: productsTable.imageUrls,
  inStock: productsTable.inStock,
  createdAt: productsTable.createdAt,
};

router.get("/products", async (req, res): Promise<void> => {
  const { limit = 30, offset = 0 } = req.query;

  const rows = await db
    .select(productSelect)
    .from(productsTable)
    .leftJoin(storesTable, eq(productsTable.storeId, storesTable.id))
    .limit(Number(limit))
    .offset(Number(offset));

  res.json(rows.map(r => ({ ...r, storeName: r.storeName ?? "" })));
});

router.get("/stores/:storeId/products", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.storeId) ? req.params.storeId[0] : req.params.storeId;
  const storeId = parseInt(raw, 10);
  if (isNaN(storeId)) { res.status(400).json({ error: "Invalid storeId" }); return; }

  const [store] = await db.select({ name: storesTable.name }).from(storesTable).where(eq(storesTable.id, storeId));

  const rows = await db.select().from(productsTable).where(eq(productsTable.storeId, storeId));
  res.json(rows.map(r => ({ ...r, storeName: store?.name ?? "" })));
});

router.post("/stores/:storeId/products", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.storeId) ? req.params.storeId[0] : req.params.storeId;
  const storeId = parseInt(raw, 10);
  if (isNaN(storeId)) { res.status(400).json({ error: "Invalid storeId" }); return; }

  const parsed = CreateProductBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [store] = await db.select({ name: storesTable.name }).from(storesTable).where(eq(storesTable.id, storeId));
  if (!store) { res.status(404).json({ error: "Store not found" }); return; }

  const { imageUrls, ...rest } = parsed.data;
  const [product] = await db.insert(productsTable).values({
    ...rest,
    storeId,
    imageUrls: imageUrls ?? [],
    imageUrl: (imageUrls && imageUrls[0]) ?? rest.imageUrl ?? null,
  }).returning();
  res.status(201).json({ ...product, storeName: store.name });
});

router.get("/products/:productId", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.productId) ? req.params.productId[0] : req.params.productId;
  const productId = parseInt(raw, 10);
  if (isNaN(productId)) { res.status(400).json({ error: "Invalid productId" }); return; }

  const rows = await db
    .select(productSelect)
    .from(productsTable)
    .leftJoin(storesTable, eq(productsTable.storeId, storesTable.id))
    .where(eq(productsTable.id, productId));

  if (!rows[0]) { res.status(404).json({ error: "Product not found" }); return; }
  res.json({ ...rows[0], storeName: rows[0].storeName ?? "" });
});

router.patch("/products/:productId", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.productId) ? req.params.productId[0] : req.params.productId;
  const productId = parseInt(raw, 10);
  if (isNaN(productId)) { res.status(400).json({ error: "Invalid productId" }); return; }

  const parsed = UpdateProductBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const { imageUrls, ...rest } = parsed.data;
  const updateData: Record<string, unknown> = { ...rest };
  if (imageUrls !== undefined) {
    updateData.imageUrls = imageUrls;
    updateData.imageUrl = imageUrls[0] ?? null;
  }

  const rows = await db
    .update(productsTable).set(updateData).where(eq(productsTable.id, productId)).returning();
  if (!rows[0]) { res.status(404).json({ error: "Product not found" }); return; }

  const [store] = await db.select({ name: storesTable.name }).from(storesTable).where(eq(storesTable.id, rows[0].storeId));
  res.json({ ...rows[0], storeName: store?.name ?? "" });
});

router.delete("/products/:productId", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.productId) ? req.params.productId[0] : req.params.productId;
  const productId = parseInt(raw, 10);
  if (isNaN(productId)) { res.status(400).json({ error: "Invalid productId" }); return; }

  await db.delete(productsTable).where(eq(productsTable.id, productId));
  res.sendStatus(204);
});

export default router;
