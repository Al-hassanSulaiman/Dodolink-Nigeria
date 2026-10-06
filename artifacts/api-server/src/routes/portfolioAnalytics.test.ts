import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const mocks = vi.hoisted(() => ({
  insert: vi.fn(), select: vi.fn(), delete: vi.fn(), values: vi.fn(), conflict: vi.fn(),
}));
vi.mock("@workspace/db", async () => ({
  ...(await import("../../../../lib/db/src/schema/portfolio_analytics")),
  db: { insert: mocks.insert, select: mocks.select, delete: mocks.delete },
}));
import publicRouter, { portfolioAdminRouter } from "./portfolioAnalytics";

const visitId = "8ab35504-5338-4d51-b853-9cddc5747451";
const clientId = "2bb35504-5338-4d51-b853-9cddc5747451";
const snapshot = { id: visitId, seconds: 5, sections: { hero: 5 } };

function app() {
  const server = express();
  server.use(express.json());
  server.use(publicRouter);
  // Only for testing route behavior; production mounts this behind requireAdmin.
  server.use(portfolioAdminRouter);
  return server;
}

function chain(result: unknown[]) {
  const q: any = { from: () => q, where: () => q, orderBy: () => q, limit: () => q,
    then: (resolve: (value: unknown[]) => void) => Promise.resolve(result).then(resolve) };
  return q;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.conflict.mockResolvedValue(undefined);
  mocks.values.mockReturnValue({ onConflictDoUpdate: mocks.conflict, returning: async () => [{ id: clientId, label: "Acme", createdAt: new Date() }] });
  mocks.insert.mockReturnValue({ values: mocks.values });
  mocks.select.mockReturnValue(chain([]));
  mocks.delete.mockReturnValue({ where: async () => undefined });
});

describe("portfolio snapshots", () => {
  it("records a pageview without accepting personal data and merges on page ID", async () => {
    const res = await request(app()).post("/portfolio-analytics/visit").send({ ...snapshot, email: "never-store@example.test" });
    expect(res.status).toBe(204);
    expect(mocks.values).toHaveBeenCalledWith({ id: visitId, clientId: null, seconds: 0, sections: { hero: 0 } });
    expect(mocks.conflict).toHaveBeenCalledOnce();
    expect(res.headers["set-cookie"]).toBeUndefined();
  });
  it.each(["DNT", "Sec-GPC"])("respects %s before any database write", async header => {
    expect((await request(app()).post("/portfolio-analytics/visit").set(header, "1").send(snapshot)).status).toBe(204);
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.select).not.toHaveBeenCalled();
  });
  it("rejects cross-site browser submissions", async () => {
    expect((await request(app()).post("/portfolio-analytics/visit").set("Sec-Fetch-Site", "cross-site").send(snapshot)).status).toBe(403);
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it.each([
    { ...snapshot, id: "bad-id" },
    { ...snapshot, seconds: -1 },
    { ...snapshot, seconds: 14401 },
    { ...snapshot, seconds: 1.5 },
    { ...snapshot, sections: { hero: 5.5 } },
    { ...snapshot, sections: { hero: 10 } },
    { ...snapshot, clientCode: "Acme" },
  ])("rejects invalid snapshots %j", async body => {
    expect((await request(app()).post("/portfolio-analytics/visit").send(body)).status).toBe(400);
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it("associates only known opaque client codes", async () => {
    mocks.select.mockReturnValue(chain([{ id: clientId }]));
    expect((await request(app()).post("/portfolio-analytics/visit").send({ ...snapshot, clientCode: clientId })).status).toBe(204);
    expect(mocks.values.mock.calls[0][0].clientId).toBe(clientId);
  });
  it("treats invalidated links as anonymous", async () => {
    await request(app()).post("/portfolio-analytics/visit").send({ ...snapshot, clientCode: clientId });
    expect(mocks.values.mock.calls[0][0].clientId).toBeNull();
  });
});

describe("admin analytics routes (mounted behind existing auth)", () => {
  it("rejects empty and oversized labels", async () => {
    for (const label of [" ", "x".repeat(81)]) {
      expect((await request(app()).post("/admin/portfolio-analytics/links").send({ label })).status).toBe(400);
    }
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it("creates private labels independently of link code", async () => {
    const res = await request(app()).post("/admin/portfolio-analytics/links").send({ label: " Acme " });
    expect(res.status).toBe(201);
    expect(res.body.label).toBe("Acme");
    expect(res.body.id).toBe(clientId);
    expect(mocks.values).toHaveBeenCalledWith({ label: "Acme" });
  });
  it("validates deletion IDs", async () => {
    expect((await request(app()).delete("/admin/portfolio-analytics/links/not-uuid")).status).toBe(400);
    expect(mocks.delete).not.toHaveBeenCalled();
    expect((await request(app()).delete(`/admin/portfolio-analytics/links/${clientId}`)).status).toBe(204);
  });
  it("returns the exact dashboard contract with no browser caching", async () => {
    mocks.select.mockReturnValueOnce(chain([])).mockReturnValueOnce(chain([]))
      .mockReturnValueOnce(chain([{ totalVisits: 0, totalSeconds: 0 }]));
    const res = await request(app()).get("/admin/portfolio-analytics");
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toEqual({ visits: [], links: [], totalVisits: 0, totalSeconds: 0 });
  });
});
