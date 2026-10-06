/**
 * Development-only real-DB integration check.
 * From workspace root:
 * NODE_ENV=development pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/scripts/verify-portfolio-analytics.ts
 * Creates isolated random fixtures and removes them in finally.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, pool, portfolioVisitsTable as visits, portfolioClientLinksTable as links } from "@workspace/db";
import publicRouter, { portfolioAdminRouter } from "../src/routes/portfolioAnalytics";

if (process.env.NODE_ENV !== "development") throw new Error("Run this check only with NODE_ENV=development");

const app = express();
app.use(express.json());
app.use(publicRouter);
// Isolated test app, not a bypass in the real API server.
app.use(portfolioAdminRouter);
const id = randomUUID();
const clientCode = randomUUID();
const [link] = await db.insert(links).values({ id: clientCode, label: "Analytics integration fixture" }).returning();
try {
  const send = (seconds: number, sections: Record<string, number>) =>
    request(app).post("/portfolio-analytics/visit").send({ id, clientCode, seconds, sections });
  assert.equal((await send(0, { hero: 0 })).status, 204);
  await db.update(visits).set({ startedAt: new Date(Date.now() - 60_000) }).where(eq(visits.id, id));
  assert.equal((await send(30, { hero: 20, about: 10 })).status, 204);
  assert.equal((await send(30, { hero: 20, about: 10 })).status, 204); // Retry.
  assert.equal((await send(10, { hero: 10 })).status, 204); // Out of order.
  const [visit] = await db.select().from(visits).where(eq(visits.id, id));
  assert.equal(visit.seconds, 30);
  assert.equal(visit.clientId, clientCode);
  assert.deepEqual(visit.sections, { hero: 20, about: 10 });
  assert.equal((await send(14400, { hero: 14400 })).status, 204);
  const [capped] = await db.select().from(visits).where(eq(visits.id, id));
  assert.ok(capped.seconds >= 60 && capped.seconds < 70, "Snapshots cannot exceed server elapsed time");
  const dashboard = await request(app).get("/admin/portfolio-analytics");
  assert.equal(dashboard.status, 200);
  assert.ok(dashboard.body.visits.some((v: { id: string }) => v.id === id));
  assert.ok(dashboard.body.links.some((l: { id: string }) => l.id === link.id));
  assert.equal((await request(app).delete(`/admin/portfolio-analytics/links/${clientCode}`)).status, 204);
  assert.deepEqual(await db.select().from(visits).where(eq(visits.id, id)), [], "Deleting a link removes its visits");
  console.log("Portfolio DB integration passed: attribution, monotonic snapshots, elapsed cap, dashboard, deletion cascade.");
} finally {
  await db.delete(visits).where(eq(visits.id, id));
  await db.delete(links).where(eq(links.id, clientCode));
  await pool.end();
}
