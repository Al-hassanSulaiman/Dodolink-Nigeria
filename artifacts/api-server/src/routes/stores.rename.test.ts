/**
 * Tests for the store-rename message backfill:
 *   PATCH /api/stores/:storeId — when the name changes, all retailer-type
 *   messages for that store's conversations must have their senderName
 *   updated; customer-type messages must be left untouched.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// --------------------------------------------------------------------------
// Fixtures
// --------------------------------------------------------------------------

const OWNER_USER_ID = "user_owner_abc";
const STORE_ID = 42;
const CONV_ID_A = 100;
const CONV_ID_B = 101;
const OLD_NAME = "Old Store Name";
const NEW_NAME = "New Store Name";

const baseStore = {
  id: STORE_ID,
  ownerUserId: OWNER_USER_ID,
  ownerName: "Test Owner",
  name: OLD_NAME,
  description: "desc",
  category: "cat",
  location: "loc",
  phone: "0800",
  imageUrl: null,
  cacNumber: null,
  avgRating: null,
  totalReviews: 0,
  verificationStatus: "pending",
  detailsLockedByAdmin: false,
  verifiedAt: null,
  verifiedBy: null,
  rejectionReason: null,
  qualifiedAt: null,
  subscriptionStatus: "inactive",
  subscriptionDueAt: null,
  subscriptionLastPaidAt: null,
  paystackCustomerCode: null,
  paystackAuthCode: null,
  paystackEmail: null,
  autoPayEnabled: false,
  hiddenByAdmin: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const storeConversations = [{ id: CONV_ID_A }, { id: CONV_ID_B }];

// --------------------------------------------------------------------------
// Mock helpers
// --------------------------------------------------------------------------

/**
 * Build a drizzle-style SELECT chain that resolves to `rows`.
 * Supports: .from().where()  and  .select({...}).from().where()
 */
function makeSelectResult(rows: unknown[]) {
  const chain: any = {
    from: () => chain,
    where: () => chain,
    $dynamic: () => chain,
    limit: () => chain,
    offset: () => chain,
    orderBy: () => Promise.resolve(rows),
    then: (
      resolve: (value: unknown[]) => unknown,
      reject: (reason: unknown) => unknown,
    ) => Promise.resolve(rows).then(resolve, reject),
  };
  return chain;
}

/**
 * Build a drizzle-style UPDATE chain.
 *
 * The stores route has two different UPDATE call patterns:
 *   1. db.update(t).set(data).where(cond).returning()   ← store row update
 *   2. db.update(t).set(data).where(cond)               ← message backfill (no .returning())
 *
 * To handle both, the chain is itself a thenable (Promise-like) that resolves
 * once .where() has been called, AND exposes a .returning() method.
 *
 * `onReturning` — called when .returning() is invoked; returns its result.
 * `onWhere`     — called when .where() is invoked (the backfill path).
 * `setCapture`  — called with the argument passed to .set().
 */
function makeUpdateChain(opts: {
  returningRows?: unknown[];
  setCapture?: (data: Record<string, unknown>) => void;
  whereCapture?: (condition: unknown) => void;
}) {
  let resolveChain!: (v: unknown) => void;
  // The chain itself is a Promise so `await chain.set(...).where(...)` works.
  const promise = new Promise((res) => { resolveChain = res; });

  const chain: any = Object.assign(promise, {
    set(data: Record<string, unknown>) {
      opts.setCapture?.(data);
      return chain;
    },
    where(condition: unknown) {
      opts.whereCapture?.(condition);
      resolveChain(undefined);          // settle the promise (backfill path)
      return chain;
    },
    returning() {
      resolveChain(opts.returningRows ?? []); // settle the promise (store path)
      return Promise.resolve(opts.returningRows ?? []);
    },
  });

  return chain;
}

// --------------------------------------------------------------------------
// Module mocks
// --------------------------------------------------------------------------

// Capture state for assertions
let selectCallCount = 0;
let updateCallCount = 0;
const capturedSets: Array<Record<string, unknown>> = [];
const capturedWhereConditions: unknown[] = [];

vi.mock("@workspace/db", () => {
  // Minimal table stubs — only their identity matters for drizzle operators.
  const storesTable = {
    id: Symbol("stores.id"),
    ownerUserId: Symbol("stores.ownerUserId"),
    name: Symbol("stores.name"),
    verificationStatus: Symbol("stores.verificationStatus"),
    detailsLockedByAdmin: Symbol("stores.detailsLockedByAdmin"),
  };
  const conversationsTable = {
    id: Symbol("conv.id"),
    storeId: Symbol("conv.storeId"),
  };
  const messagesTable = {
    conversationId: Symbol("msg.conversationId"),
    senderType: Symbol("msg.senderType"),
    senderName: Symbol("msg.senderName"),
  };

  const db = {
    // select() is overridden per-test via mockImplementation
    select: vi.fn(),
    // update() is overridden per-test via mockImplementation
    update: vi.fn(),
  };

  return { db, storesTable, conversationsTable, messagesTable, productsTable: {} };
});

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ op: "eq", col, val })),
  ne: vi.fn((col: unknown, val: unknown) => ({ op: "ne", col, val })),
  inArray: vi.fn((col: unknown, vals: unknown) => ({ op: "inArray", col, vals })),
  and: vi.fn((...args: unknown[]) => ({ op: "and", args })),
  ilike: vi.fn(),
  sql: vi.fn(),
}));

vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  getAuth: vi.fn(() => ({ userId: OWNER_USER_ID })),
}));

vi.mock("../lib/storeSubscription", () => ({
  visibleStoresFilter: vi.fn(() => ({})),
  isStoreHidden: vi.fn(() => false),
}));

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// --------------------------------------------------------------------------
// Test helpers
// --------------------------------------------------------------------------

async function buildApp() {
  // Re-import so the route gets the freshly-mocked db
  const { default: storesRouter } = await import("./stores");
  const app = express();
  app.use(express.json());
  app.use(storesRouter);
  return app;
}

function setupSelectMock(
  db: { select: ReturnType<typeof vi.fn> },
  selectResults: Array<unknown[]>,
) {
  let call = 0;
  db.select.mockImplementation(() => {
    const rows = selectResults[call] ?? [];
    call++;
    return makeSelectResult(rows);
  });
}

function setupUpdateMock(
  db: { update: ReturnType<typeof vi.fn> },
  returningPerCall: Array<unknown[]>,
) {
  updateCallCount = 0;
  capturedSets.length = 0;
  capturedWhereConditions.length = 0;

  db.update.mockImplementation(() => {
    const callIndex = updateCallCount++;
    return makeUpdateChain({
      returningRows: returningPerCall[callIndex] ?? [],
      setCapture: (data) => { capturedSets[callIndex] = data; },
      whereCapture: (cond) => { capturedWhereConditions[callIndex] = cond; },
    });
  });
}

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe("PATCH /stores/:storeId — rename backfill", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    selectCallCount = 0;
    updateCallCount = 0;
    capturedSets.length = 0;
    capturedWhereConditions.length = 0;
  });

  it("updates senderName on retailer messages when the store name changes", async () => {
    const { db } = await import("@workspace/db");

    // SELECT call 0: load existing store
    // SELECT call 1: confirm no verified store owns the proposed name
    // SELECT call 2: load conversations for the store
    setupSelectMock(db as any, [
      [baseStore],
      [],
      storeConversations,
    ]);

    // UPDATE call 0: store row itself  → returns renamed store
    // UPDATE call 1: message backfill → returns void (no .returning())
    setupUpdateMock(db as any, [
      [{ ...baseStore, name: NEW_NAME }],
      [],
    ]);

    const app = await buildApp();
    const res = await request(app)
      .patch(`/stores/${STORE_ID}`)
      .send({ name: NEW_NAME });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe(NEW_NAME);

    // Both the store UPDATE and the message backfill UPDATE must have fired
    expect(updateCallCount).toBe(2);

    // The message backfill must set senderName to the new store name
    expect(capturedSets[1]).toEqual({ senderName: NEW_NAME });
  });

  it("does NOT run the backfill when the name is unchanged", async () => {
    const { db } = await import("@workspace/db");

    setupSelectMock(db as any, [[baseStore], []]);
    setupUpdateMock(db as any, [[{ ...baseStore }]]);

    const app = await buildApp();
    const res = await request(app)
      .patch(`/stores/${STORE_ID}`)
      // Sending the same name — no change
      .send({ name: OLD_NAME });

    expect(res.status).toBe(200);
    // Only the store row UPDATE — no message backfill
    expect(updateCallCount).toBe(1);
  });

  it("does NOT run the backfill when only non-name fields change", async () => {
    const { db } = await import("@workspace/db");

    setupSelectMock(db as any, [[baseStore], []]);
    setupUpdateMock(db as any, [[{ ...baseStore, phone: "0900" }]]);

    const app = await buildApp();
    const res = await request(app)
      .patch(`/stores/${STORE_ID}`)
      .send({ phone: "0900" });

    expect(res.status).toBe(200);
    expect(updateCallCount).toBe(1);
  });

  it("skips the message UPDATE when the store has no conversations", async () => {
    const { db } = await import("@workspace/db");

    setupSelectMock(db as any, [
      [baseStore],
      [],              // no verified-name conflict
      [],              // empty conversations
    ]);
    setupUpdateMock(db as any, [
      [{ ...baseStore, name: NEW_NAME }],
    ]);

    const app = await buildApp();
    const res = await request(app)
      .patch(`/stores/${STORE_ID}`)
      .send({ name: NEW_NAME });

    expect(res.status).toBe(200);
    // Only the store UPDATE — no message backfill because there are no convs
    expect(updateCallCount).toBe(1);
  });

  it("backfill WHERE clause targets senderType='retailer' and scopes to the store's conversation IDs", async () => {
    /**
     * This test verifies the WHERE condition on the message backfill UPDATE:
     * AND(
     *   inArray(messages.conversationId, [CONV_ID_A, CONV_ID_B]),
     *   eq(messages.senderType, "retailer")
     * )
     * Customer messages live in the same conversations but are NOT touched
     * because the senderType filter excludes them.
     */
    const { db } = await import("@workspace/db");
    const { and, eq, inArray } = await import("drizzle-orm");

    setupSelectMock(db as any, [
      [baseStore],
      [],              // no verified-name conflict
      storeConversations,
    ]);
    setupUpdateMock(db as any, [
      [{ ...baseStore, name: NEW_NAME }],
      [],
    ]);

    const app = await buildApp();
    await request(app)
      .patch(`/stores/${STORE_ID}`)
      .send({ name: NEW_NAME });

    // The backfill must have happened (two updates)
    expect(updateCallCount).toBe(2);

    // Inspect the drizzle operator calls to confirm senderType scoping.
    // eq() must have been called with value "retailer"
    const eqCalls = (eq as ReturnType<typeof vi.fn>).mock.calls;
    const retailerEqCall = eqCalls.find((args) => args[1] === "retailer");
    expect(retailerEqCall).toBeDefined();

    // inArray() must have been called with the two conversation IDs
    const inArrayCalls = (inArray as ReturnType<typeof vi.fn>).mock.calls;
    const convIdCall = inArrayCalls.find(
      (args) =>
        Array.isArray(args[1]) &&
        (args[1] as number[]).includes(CONV_ID_A) &&
        (args[1] as number[]).includes(CONV_ID_B),
    );
    expect(convIdCall).toBeDefined();

    // and() must have wrapped both conditions together
    const andCalls = (and as ReturnType<typeof vi.fn>).mock.calls;
    const backfillAnd = andCalls.find((args) =>
      args.some((a: any) => a?.op === "inArray") &&
      args.some((a: any) => a?.op === "eq" && a?.val === "retailer"),
    );
    expect(backfillAnd).toBeDefined();
  });

  it("rejects a name already owned by another verified store", async () => {
    const { db } = await import("@workspace/db");

    setupSelectMock(db as any, [
      [baseStore],
      [{ id: 99 }],
    ]);
    setupUpdateMock(db as any, []);

    const app = await buildApp();
    const res = await request(app)
      .patch(`/stores/${STORE_ID}`)
      .send({ name: "  NEW   STORE NAME " });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      code: "STORE_NAME_ALREADY_EXISTS",
      error: "A verified store with this name already exists",
    });
    expect(updateCallCount).toBe(0);
  });
});
