import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { sql } from "drizzle-orm";
import { db, storesTable, productsTable, storeFollowsTable } from "@workspace/db";
import { visibleStoresFilter } from "../lib/storeSubscription";

const router: IRouter = Router();
for (const kind of ["stores", "products"] as const) {
  router.get(`/home/${kind}`, async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    const limit = req.query.limit === undefined ? 20 : Number(req.query.limit);
    const offset = req.query.offset === undefined ? 0 : Number(req.query.offset);
    const seed = req.query.seed ?? new Date().toISOString().slice(0, 10);
    if (!Number.isInteger(limit) || limit < 1 || limit > 40 ||
        !Number.isSafeInteger(offset) || offset < 0 ||
        typeof seed !== "string" || !seed.length || seed.length > 100) {
      res.status(400).json({ error: "Invalid feed pagination" }); return;
    }
    const { userId } = getAuth(req);
    const following = userId ? sql`EXISTS (
      SELECT 1 FROM ${storeFollowsTable} f WHERE f.store_id = ${storesTable.id} AND f.user_id = ${userId}
    )` : sql`false`;
    const followers = sql`(SELECT count(*)::integer FROM ${storeFollowsTable} f WHERE f.store_id = ${storesTable.id})`;
    const id = kind === "stores" ? storesTable.id : productsTable.id;
    const shuffle = sql`(('x' || substr(md5(${seed} || ':' || ${id}::text), 1, 8))::bit(32)::bigint)::double precision / 4294967296`;
    const columns = kind === "stores" ? sql`
      ${storesTable.id} AS id, ${storesTable.name} AS name, ${storesTable.imageUrl} AS "imageUrl"
    ` : sql`
      ${productsTable.id} AS id, ${productsTable.storeId} AS "storeId", ${storesTable.name} AS "storeName",
      ${storesTable.imageUrl} AS "storeImageUrl",
      ${productsTable.name} AS name, ${productsTable.description} AS description,
      ${productsTable.price}::double precision AS price, ${productsTable.category} AS category,
      ${productsTable.imageUrl} AS "imageUrl", ${productsTable.imageUrls} AS "imageUrls",
      ${productsTable.inStock} AS "inStock", ${productsTable.createdAt} AS "createdAt"
    `;
    const source = kind === "stores" ? sql`FROM ${storesTable}` :
      sql`FROM ${productsTable} INNER JOIN ${storesTable} ON ${storesTable.id} = ${productsTable.storeId}`;
    const diversity = kind === "products" ?
      sql`row_number() OVER (PARTITION BY "storeId" ORDER BY shuffle DESC, id)` : sql`1`;
    // Four followed results per discovery result when both pools have enough
    // inventory. All eligible items remain reachable; popularity is a modest,
    // capped boost rather than a fixed shortlist. Seed stays stable per refresh.
    const result = await db.execute(sql`
      WITH base AS (
        SELECT ${columns}, ${following} AS "isFollowing", ${followers} AS "followerCount", ${shuffle} AS shuffle
        ${source} WHERE ${visibleStoresFilter()}
      ), diversified AS (
        SELECT *, ${diversity} AS store_rank FROM base
      ), ranked AS (
        SELECT *, row_number() OVER (
          PARTITION BY "isFollowing"
          ORDER BY store_rank, (shuffle + least(0.4, ln(1 + "followerCount") * 0.08)) DESC, id
        ) AS group_rank FROM diversified
      )
      SELECT * FROM ranked
      ORDER BY CASE WHEN "isFollowing" THEN group_rank - 1 ELSE (group_rank - 1) * 4 + 3.5 END, id
      LIMIT ${limit + 1} OFFSET ${offset}
    `);
    const items = result.rows.slice(0, limit).map(row => {
      const { shuffle, store_rank, group_rank, ...item } = row;
      return item;
    });
    res.json({ items, nextOffset: result.rows.length > limit ? offset + limit : null });
  });
}
export default router;
