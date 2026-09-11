import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

function makeSelectChain(rows: unknown[]) {
  const chain: any = {
    from: () => chain,
    leftJoin: () => chain,
    where: () => chain,
    then: (resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject),
  };
  return chain;
}

const selectMock = vi.fn();
const getAuthMock = vi.fn();

vi.mock("@workspace/db", () => ({
  db: {
    select: selectMock,
  },
  productsTable: {
    id: Symbol("products.id"),
    storeId: Symbol("products.storeId"),
    name: Symbol("products.name"),
    description: Symbol("products.description"),
    price: Symbol("products.price"),
    category: Symbol("products.category"),
    imageUrl: Symbol("products.imageUrl"),
    imageUrls: Symbol("products.imageUrls"),
    inStock: Symbol("products.inStock"),
    createdAt: Symbol("products.createdAt"),
  },
  storesTable: {
    id: Symbol("stores.id"),
    name: Symbol("stores.name"),
    ownerUserId: Symbol("stores.ownerUserId"),
    totalReviews: Symbol("stores.totalReviews"),
    avgRating: Symbol("stores.avgRating"),
    createdAt: Symbol("stores.createdAt"),
  },
}));

vi.mock("@clerk/express", () => ({
  getAuth: (req: unknown) => getAuthMock(req),
}));

vi.mock("@workspace/api-zod", () => ({
  CreateProductBody: { safeParse: vi.fn() },
  UpdateProductBody: { safeParse: vi.fn() },
}));

vi.mock("../lib/auth", () => ({
  requireUser: vi.fn(),
}));

vi.mock("../lib/storeSubscription", () => ({
  visibleStoresFilter: vi.fn(),
  isStoreHidden: vi.fn(() => true),
}));

async function buildApp() {
  const { default: productsRouter } = await import("./products");
  const app = express();
  app.use(express.json());
  app.use(productsRouter);
  return app;
}

describe("hidden store product visibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("does not expose a hidden store's catalog to the public", async () => {
    getAuthMock.mockReturnValue({ userId: null });
    selectMock.mockImplementationOnce(() =>
      makeSelectChain([{ id: 7, name: "Hidden Store", ownerUserId: "owner_7" }]),
    );

    const app = await buildApp();
    const res = await request(app).get("/stores/7/products");

    expect(res.status).toBe(404);
    expect(selectMock).toHaveBeenCalledTimes(1);
  });

  it("still lets the authenticated owner manage the hidden store's catalog", async () => {
    getAuthMock.mockReturnValue({ userId: "owner_7" });
    selectMock
      .mockImplementationOnce(() =>
        makeSelectChain([{ id: 7, name: "Hidden Store", ownerUserId: "owner_7" }]),
      )
      .mockImplementationOnce(() =>
        makeSelectChain([{ id: 3, storeId: 7, name: "Product" }]),
      );

    const app = await buildApp();
    const res = await request(app).get("/stores/7/products");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { id: 3, storeId: 7, name: "Product", storeName: "Hidden Store" },
    ]);
  });
});