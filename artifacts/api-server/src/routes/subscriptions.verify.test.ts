/**
 * Tests for subscription verify price-locking:
 *  - the amount is checked against the quote stored at initialize time, so a
 *    store crossing an engagement tier mid-checkout is NOT rejected
 *  - a stored quote is strictly single-use, even under concurrent verify
 *    requests (atomic conditional consume inside one transaction)
 *  - old references without a stored quote fall back to recomputing the tier
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

const OWNER_ID = "user_owner_1";
const STORE_ID = 7;
const BASIC_KOBO = 200_000;   // ₦2,000
const PREMIUM_KOBO = 500_000; // ₦5,000

function makeStoreRow(overrides: Record<string, unknown> = {}) {
  return {
    id: STORE_ID,
    ownerUserId: OWNER_ID,
    name: "Test Store",
    verificationStatus: "verified",
    subscriptionStatus: "inactive",
    subscriptionDueAt: null,
    subscriptionLastPaidAt: null,
    qualifiedAt: null,
    autoPayEnabled: false,
    paystackAuthCode: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// In-memory quote store shared by the mocked db — lets us simulate the
// database's atomicity guarantee for the conditional consume UPDATE.
// ---------------------------------------------------------------------------

type QuoteRow = {
  id: number;
  reference: string;
  storeId: number;
  quotedAmountKobo: number;
  consumedAt: Date | null;
  createdAt: Date;
};

const quoteRows: QuoteRow[] = [];
let storeUpdateCount = 0;
/** Rows the "stale read" select returns; set per-test to stage race conditions. */
let quoteSelectOverride: (() => QuoteRow[]) | null = null;

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", () => {
  const storesTable = { id: Symbol("stores.id"), $inferSelect: {} };
  const subscriptionPaymentsTable = {
    reference: Symbol("subPay.reference"),
    consumedAt: Symbol("subPay.consumedAt"),
    __isQuotesTable: true,
  };

  function makeTx() {
    return {
      select: () => ({
        from: (table: any) => ({
          where: (cond: any) => {
            if (table.__isQuotesTable) {
              if (quoteSelectOverride) return Promise.resolve(quoteSelectOverride());
              const ref = findRefIn(cond);
              return Promise.resolve(quoteRows.filter((q) => q.reference === ref && true));
            }
            return Promise.resolve([]);
          },
        }),
      }),
      update: (table: any) => ({
        set: (values: any) => ({
          where: (cond: any) => {
            if (table.__isQuotesTable) {
              // Simulate the DB's atomic UPDATE ... WHERE consumed_at IS NULL:
              // this block runs synchronously, so only one caller can win.
              const ref = findRefIn(cond);
              const row = quoteRows.find((q) => q.reference === ref && q.consumedAt === null);
              const consumed = row ? [Object.assign(row, { consumedAt: values.consumedAt })] : [];
              return { returning: () => Promise.resolve(consumed) };
            }
            // stores table update
            storeUpdateCount++;
            return {
              returning: () =>
                Promise.resolve([makeStoreRow({ subscriptionStatus: "active", ...values })]),
            };
          },
        }),
      }),
    };
  }

  const db = {
    select: vi.fn(),
    transaction: vi.fn(async (fn: (tx: any) => Promise<unknown>) => fn(makeTx())),
  };

  function findRefIn(cond: any): string | null {
    if (!cond) return null;
    if (cond.op === "eq" && typeof cond.val === "string") return cond.val;
    if (cond.op === "and") {
      for (const a of cond.args ?? []) {
        const r = findRefIn(a);
        if (r) return r;
      }
    }
    return null;
  }

  return { db, storesTable, subscriptionPaymentsTable };
});

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ op: "eq", col, val })),
  and: vi.fn((...args: unknown[]) => ({ op: "and", args })),
  isNull: vi.fn((col: unknown) => ({ op: "isNull", col })),
}));

const paystackVerifyMock = vi.fn();
vi.mock("../lib/paystack", () => ({
  paystackInitialize: vi.fn(),
  paystackVerify: (...args: unknown[]) => paystackVerifyMock(...args),
  paystackChargeAuthorization: vi.fn(),
}));

const getEngagementCountMock = vi.fn();
const getSubscriptionAmountKoboMock = vi.fn();
vi.mock("../lib/storeSubscription", () => ({
  ENGAGEMENT_THRESHOLD: 3,
  PREMIUM_ENGAGEMENT_THRESHOLD: 12,
  SUBSCRIPTION_LAUNCH_DATE: new Date("2026-01-01T00:00:00Z"),
  getEngagementCount: (...args: unknown[]) => getEngagementCountMock(...args),
  getSubscriptionAmountKobo: (...args: unknown[]) => getSubscriptionAmountKoboMock(...args),
  isPaymentsLive: () => true,
  isStoreHidden: () => false,
  gracePeriodDaysRemaining: () => null,
}));

vi.mock("@clerk/express", () => ({
  getAuth: vi.fn(() => ({ userId: OWNER_ID })),
}));

// ---------------------------------------------------------------------------
// App factory
// ---------------------------------------------------------------------------

async function buildApp() {
  const { default: router } = await import("./subscriptions");
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).log = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };
    next();
  });
  app.use(router);
  return app;
}

async function primeDb(storeRow = makeStoreRow()) {
  const { db } = await import("@workspace/db");
  (db.select as ReturnType<typeof vi.fn>).mockImplementation(() => ({
    from: () => ({ where: () => Promise.resolve([storeRow]) }),
  }));
  return db;
}

function successfulTxn(amount: number) {
  return {
    status: "success",
    amount,
    currency: "NGN",
    authorization: { reusable: false },
    customer: null,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /stores/:storeId/subscription/verify — quoted price locking", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    quoteRows.length = 0;
    storeUpdateCount = 0;
    quoteSelectOverride = null;
    await primeDb();
    // Engagement is ABOVE the premium threshold at verify time in every test,
    // so any acceptance of BASIC_KOBO proves the stored quote was used.
    getEngagementCountMock.mockResolvedValue(20);
    getSubscriptionAmountKoboMock.mockReturnValue(PREMIUM_KOBO);
  });

  function addQuote(reference: string, quotedAmountKobo = BASIC_KOBO, storeId = STORE_ID) {
    quoteRows.push({
      id: quoteRows.length + 1,
      reference,
      storeId,
      quotedAmountKobo,
      consumedAt: null,
      createdAt: new Date("2026-08-01T00:00:00Z"),
    });
  }

  it("accepts the quoted basic-tier amount even after the store crossed into the premium tier", async () => {
    const reference = `dodolink_sub_${STORE_ID}_1754000000000`;
    addQuote(reference, BASIC_KOBO);
    paystackVerifyMock.mockResolvedValue(successfulTxn(BASIC_KOBO));

    const app = await buildApp();
    const res = await request(app)
      .post(`/stores/${STORE_ID}/subscription/verify`)
      .send({ reference });

    expect(res.status).toBe(200);
    expect(res.body.subscriptionStatus).toBe("active");
    expect(storeUpdateCount).toBe(1);
    expect(quoteRows[0].consumedAt).not.toBeNull();
  });

  it("rejects a payment below the stored quote", async () => {
    const reference = `dodolink_sub_${STORE_ID}_1754000000001`;
    addQuote(reference, PREMIUM_KOBO);
    paystackVerifyMock.mockResolvedValue(successfulTxn(BASIC_KOBO));

    const app = await buildApp();
    const res = await request(app)
      .post(`/stores/${STORE_ID}/subscription/verify`)
      .send({ reference });

    expect(res.status).toBe(400);
    expect(storeUpdateCount).toBe(0);
    expect(quoteRows[0].consumedAt).toBeNull();
  });

  it("rejects a second verify of an already-consumed reference", async () => {
    const reference = `dodolink_sub_${STORE_ID}_1754000000002`;
    addQuote(reference, BASIC_KOBO);
    paystackVerifyMock.mockResolvedValue(successfulTxn(BASIC_KOBO));

    const app = await buildApp();
    const first = await request(app)
      .post(`/stores/${STORE_ID}/subscription/verify`)
      .send({ reference });
    expect(first.status).toBe(200);

    const second = await request(app)
      .post(`/stores/${STORE_ID}/subscription/verify`)
      .send({ reference });
    expect(second.status).toBe(400);
    expect(second.body.error).toMatch(/already been used/i);
    expect(storeUpdateCount).toBe(1);
  });

  it("exactly one of two CONCURRENT verifies succeeds; subscription applied once", async () => {
    const reference = `dodolink_sub_${STORE_ID}_1754000000003`;
    addQuote(reference, BASIC_KOBO);
    paystackVerifyMock.mockResolvedValue(successfulTxn(BASIC_KOBO));

    // Both requests read the quote as UNCONSUMED (stale read), reproducing the
    // race. Only the atomic conditional-consume UPDATE decides the winner.
    quoteSelectOverride = () =>
      quoteRows
        .filter((q) => q.reference === reference)
        .map((q) => ({ ...q, consumedAt: null }));

    const app = await buildApp();
    const [a, b] = await Promise.all([
      request(app).post(`/stores/${STORE_ID}/subscription/verify`).send({ reference }),
      request(app).post(`/stores/${STORE_ID}/subscription/verify`).send({ reference }),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 400]);
    const rejected = a.status === 400 ? a : b;
    expect(rejected.body.error).toMatch(/already been used/i);
    expect(storeUpdateCount).toBe(1);
    expect(quoteRows[0].consumedAt).not.toBeNull();
  });

  it("rejects a quote that belongs to a different store", async () => {
    const reference = `dodolink_sub_${STORE_ID}_1754000000004`;
    addQuote(reference, BASIC_KOBO, STORE_ID + 1);
    paystackVerifyMock.mockResolvedValue(successfulTxn(BASIC_KOBO));

    const app = await buildApp();
    const res = await request(app)
      .post(`/stores/${STORE_ID}/subscription/verify`)
      .send({ reference });

    expect(res.status).toBe(400);
    expect(storeUpdateCount).toBe(0);
  });

  it("falls back to the current engagement tier for old references without a stored quote", async () => {
    const reference = `dodolink_sub_${STORE_ID}_1754000000005`;
    // No quote row added.
    paystackVerifyMock.mockResolvedValue(successfulTxn(PREMIUM_KOBO));

    const app = await buildApp();
    const ok = await request(app)
      .post(`/stores/${STORE_ID}/subscription/verify`)
      .send({ reference });
    expect(ok.status).toBe(200);

    // Underpaying against the current tier is rejected in the fallback path.
    const reference2 = `dodolink_sub_${STORE_ID}_1754000000006`;
    paystackVerifyMock.mockResolvedValue(successfulTxn(BASIC_KOBO));
    const bad = await request(app)
      .post(`/stores/${STORE_ID}/subscription/verify`)
      .send({ reference: reference2 });
    expect(bad.status).toBe(400);
  });
});
