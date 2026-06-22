import { Router, type IRouter } from "express";
import { ilike, or, eq } from "drizzle-orm";
import { db, storesTable, productsTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/search", async (req, res): Promise<void> => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (!q) { res.json({ stores: [], products: [], query: q }); return; }

  const pattern = `%${q}%`;

  const stores = await db
    .select()
    .from(storesTable)
    .where(or(ilike(storesTable.name, pattern), ilike(storesTable.category, pattern), ilike(storesTable.location, pattern)));

  const productRows = await db
    .select({
      id: productsTable.id,
      storeId: productsTable.storeId,
      storeName: storesTable.name,
      name: productsTable.name,
      description: productsTable.description,
      price: productsTable.price,
      category: productsTable.category,
      imageUrl: productsTable.imageUrl,
      inStock: productsTable.inStock,
      createdAt: productsTable.createdAt,
    })
    .from(productsTable)
    .leftJoin(storesTable, eq(productsTable.storeId, storesTable.id))
    .where(or(ilike(productsTable.name, pattern), ilike(productsTable.category, pattern), ilike(productsTable.description, pattern)));

  res.json({ stores, products: productRows.map(p => ({ ...p, storeName: p.storeName ?? "" })), query: q });
});

export default router;
