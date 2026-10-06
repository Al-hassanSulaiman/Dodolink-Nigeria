import { Router, type IRouter } from "express";
import rateLimit from "express-rate-limit";
import { count, desc, eq, gte, sql } from "drizzle-orm";
import { db, portfolioClientLinksTable as links, portfolioVisitsTable as visits } from "@workspace/db";
import {
  RecordPortfolioVisitBody, CreatePortfolioClientLinkBody,
  DeletePortfolioClientLinkParams, GetPortfolioAnalyticsResponse,
  CreatePortfolioClientLinkResponse,
} from "@workspace/api-zod";

export const portfolioAdminRouter: IRouter = Router();
const router: IRouter = Router();
const limiter = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: "draft-8", legacyHeaders: false });

router.post("/portfolio-analytics/visit", limiter, async (req, res): Promise<void> => {
  if (req.get("DNT") === "1" || req.get("Sec-GPC") === "1") {
    res.sendStatus(204);
    return;
  }
  // Reject cross-site browser submissions, including sendBeacon/simple requests.
  if (req.get("Sec-Fetch-Site") === "cross-site") {
    res.status(403).json({ error: "Cross-site analytics is not accepted" });
    return;
  }
  const parsed = RecordPortfolioVisitBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid visit snapshot" });
    return;
  }
  const data = parsed.data;
  if (!Number.isInteger(data.seconds) ||
      Object.values(data.sections).some(value => value !== undefined && (!Number.isInteger(value) || value > data.seconds))) {
    res.status(400).json({ error: "Durations must be whole seconds within the page duration" });
    return;
  }
  let clientId: string | null = null;
  if (data.clientCode) {
    const [link] = await db.select({ id: links.id }).from(links).where(eq(links.id, data.clientCode));
    clientId = link?.id ?? null;
  }
  // First snapshot starts a pageview at zero. Subsequent cumulative snapshots
  // merge monotonically, so retries and out-of-order beacons never double-count.
  // Cap measured time to server-observed elapsed time and four hours per page.
  const elapsed = sql`LEAST(14400, GREATEST(0, EXTRACT(EPOCH FROM (now() - ${visits.startedAt}))::integer + 5))`;
  const sectionMerge = sql`(
    SELECT COALESCE(jsonb_object_agg(key, LEAST(${elapsed}, GREATEST(
      COALESCE((${visits.sections}->>key)::integer, 0), value::integer
    ))), '{}'::jsonb)
    FROM jsonb_each_text(${JSON.stringify(data.sections)}::jsonb)
  )`;
  const initialSections = Object.fromEntries(Object.keys(data.sections).map(section => [section, 0]));
  await db.insert(visits).values({ id: data.id, clientId, seconds: 0, sections: initialSections })
    .onConflictDoUpdate({
      target: visits.id,
      set: {
        updatedAt: new Date(),
        seconds: sql`GREATEST(${visits.seconds}, LEAST(${data.seconds}, ${elapsed}))`,
        sections: sql`${visits.sections} || ${sectionMerge}`,
      },
    });
  res.sendStatus(204);
});

// Mounted ONLY inside admin.ts, after its existing requireAdmin middleware.
portfolioAdminRouter.get("/admin/portfolio-analytics", async (_req, res): Promise<void> => {
  const since = new Date(Date.now() - 90 * 86400_000);
  const [recentVisits, clientLinks, [totals]] = await Promise.all([
    db.select().from(visits).where(gte(visits.startedAt, since)).orderBy(desc(visits.startedAt)).limit(500),
    db.select().from(links).orderBy(desc(links.createdAt)),
    db.select({ totalVisits: count(), totalSeconds: sql<number>`COALESCE(sum(${visits.seconds}), 0)::integer` })
      .from(visits).where(gte(visits.startedAt, since)),
  ]);
  res.set("Cache-Control", "no-store");
  res.json(GetPortfolioAnalyticsResponse.parse({
    ...totals,
    visits: recentVisits.map(v => ({ ...v, startedAt: v.startedAt.toISOString(), updatedAt: v.updatedAt.toISOString() })),
    links: clientLinks.map(l => ({ ...l, createdAt: l.createdAt.toISOString() })),
  }));
});

portfolioAdminRouter.post("/admin/portfolio-analytics/links", async (req, res): Promise<void> => {
  const parsed = CreatePortfolioClientLinkBody.safeParse(req.body);
  if (!parsed.success || !parsed.data.label.trim()) {
    res.status(400).json({ error: "Enter a client label (1–80 characters)" });
    return;
  }
  const [link] = await db.insert(links).values({ label: parsed.data.label.trim() }).returning();
  res.status(201).json(CreatePortfolioClientLinkResponse.parse({ ...link, createdAt: link.createdAt.toISOString() }));
});

portfolioAdminRouter.delete("/admin/portfolio-analytics/links/:id", async (req, res): Promise<void> => {
  const parsed = DeletePortfolioClientLinkParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid link ID" });
    return;
  }
  await db.delete(links).where(eq(links.id, parsed.data.id));
  res.sendStatus(204);
});

export default router;
