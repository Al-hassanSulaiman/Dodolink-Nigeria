/**
 * Tests for the shared subscription charging service and the manual charge
 * route (POST /stores/:storeId/subscription/charge).
 *
 * These prove the payment-integrity properties the review demanded:
 *  - ALL charge paths (manual route AND auto-charge worker) serialize on the
 *    same per-store advisory lock, so Paystack is called AT MOST once per
 *    renewal window even when requests race each other.
 *  - An ambiguous charge (timeout/network error) that actually SETTLED remotely
 *    is reconciled via verify and activates the subscription — no second charge.
 *  - An ambiguous charge whose verify is ALSO inconclusive keeps the pending
 *    attempt and does NOT tell the client a retry is safe.
 *  - A later run reconciles a leftover pending attempt (its own deterministic
 *    auto reference included) instead of skipping or double-charging.
 *
 * The mocked db implements pg_advisory_xact_lock semantics with a real
 * in-process mutex keyed on the lock arguments: acquired on tx.execute of the
 * lock statement, released when the surrounding transaction settles. This is
 * exactly the guarantee Postgres provides.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

const OWNER_ID = "user_owner_1";
const STORE_ID = 7;
const BASIC_KOBO = 200_000;

type Row = {
  reference: string;
  storeId: number;
  quotedAmountKobo: number;
  consumedAt: Date | null;
};

// Shared mutable state simulating the subscription_payments table + store.
let paymentRows: Row[] = [];
let storeRow: Record<string, any>;

function makeStoreRow(overrides: Record<string, unknown> = {}) {
  return {
    id: STORE_ID,
    ownerUserId: OWNER_ID,
    name: "Test Store",
    verificationStatus: "verified",
    subscriptionStatus: "active",
    // Due soon (12h) so the renewal-window guard does not block a legitimate charge.
    subscriptionDueAt: new Date(Date.now() + 12 * 60 * 60 * 1000),
    subscriptionLastPaidAt: null,
    qualifiedAt: null,
    autoPayEnabled: true,
    paystackAuthCode: "AUTH_xxx",
    paystackEmail: "seller@example.com",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock @workspace/db with a tiny query-builder over paymentRows + a REAL
// per-key mutex for the advisory lock (pg_advisory_xact_lock semantics).
// ---------------------------------------------------------------------------
vi.mock("@workspace/db", () => {
  const storesTable = { id: Symbol("stores.id"), __kind: "stores", $inferSelect: {} };
  const subscriptionPaymentsTable = {
    reference: Symbol("subPay.reference"),
    storeId: Symbol("subPay.storeId"),
    consumedAt: Symbol("subPay.consumedAt"),
    __kind: "payments",
  };
  const pushTokensTable = { userId: Symbol("push.userId"), token: Symbol("push.token"), __kind: "push" };

  function extractRef(cond: any): string | null {
    if (!cond) return null;
    if (cond.op === "eq" && cond.col === subscriptionPaymentsTable.reference) return cond.val as string;
    if (cond.op === "and") for (const a of cond.args ?? []) { const r = extractRef(a); if (r) return r; }
    return null;
  }

  // Advisory-lock mutex: one holder per key at a time, FIFO.
  const lockChains = new Map<string, Promise<void>>();
  async function acquireLock(key: string): Promise<() => void> {
    const prev = lockChains.get(key) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((r) => { release = r; });
    lockChains.set(key, prev.then(() => next));
    await prev;
    return release;
  }

  function makeQueryApi(): any {
    return {
      select: (_fields?: unknown) => ({
        from: (table: any) => ({
          where: (_cond: any) => {
            if (table.__kind === "stores") return Promise.resolve([storeRow]);
            if (table.__kind === "push") return Promise.resolve([]);
            return Promise.resolve(paymentRows.filter((r) => r.consumedAt === null));
          },
        }),
      }),
      insert: (_table: any) => ({
        values: (vals: Row) => ({
          onConflictDoNothing: () => {
            const exists = paymentRows.some((r) => r.reference === vals.reference);
            if (!exists) paymentRows.push({ ...vals, consumedAt: vals.consumedAt ?? null });
            return { returning: () => Promise.resolve(exists ? [] : [vals]) };
          },
        }),
      }),
      update: (table: any) => ({
        set: (vals: any) => ({
          where: (cond: any) => {
            if (table.__kind === "stores") {
              Object.assign(storeRow, vals);
              return Object.assign(Promise.resolve([storeRow]), { returning: () => Promise.resolve([storeRow]) });
            }
            const ref = extractRef(cond);
            const row = paymentRows.find((r) => r.reference === ref);
            if (row) Object.assign(row, vals);
            return Object.assign(Promise.resolve(row ? [row] : []), { returning: () => Promise.resolve(row ? [row] : []) });
          },
        }),
      }),
      delete: (_table: any) => ({
        where: (cond: any) => {
          const ref = extractRef(cond);
          paymentRows = paymentRows.filter((r) => r.reference !== ref);
          return Promise.resolve();
        },
      }),
    };
  }

  const db: any = {
    ...makeQueryApi(),
    transaction: async (fn: (tx: any) => Promise<unknown>) => {
      const releases: Array<() => void> = [];
      const tx = {
        ...makeQueryApi(),
        execute: async (q: any) => {
          // pg_advisory_xact_lock(namespace, key): block until acquired, hold
          // until this transaction settles.
          if (q?.vals?.length) releases.push(await acquireLock(q.vals.join(":")));
        },
        transaction: async (inner: (t: any) => Promise<unknown>) => inner(tx),
      };
      try {
        return await fn(tx);
      } finally {
        for (const r of releases) r();
      }
    },
    execute: () => Promise.resolve(),
  };

  return { db, storesTable, subscriptionPaymentsTable, pushTokensTable };
});

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ op: "eq", col, val }),
  and: (...args: unknown[]) => ({ op: "and", args }),
  isNull: (col: unknown) => ({ op: "isNull", col }),
  lte: (col: unknown, val: unknown) => ({ op: "lte", col, val }),
  sql: (strings: TemplateStringsArray, ...vals: unknown[]) => ({ op: "sql", strings, vals }),
}));

// ---------------------------------------------------------------------------
// Paystack mock — controllable per test.
// ---------------------------------------------------------------------------
const chargeMock = vi.fn();
const verifyMock = vi.fn();
vi.mock("../lib/paystack", () => ({
  paystackInitialize: vi.fn(),
  paystackVerify: (...a: unknown[]) => verifyMock(...a),
  paystackChargeAuthorization: (...a: unknown[]) => chargeMock(...a),
}));

vi.mock("../lib/storeSubscription", () => ({
  ENGAGEMENT_THRESHOLD: 3,
  PREMIUM_ENGAGEMENT_THRESHOLD: 12,
  SUBSCRIPTION_LAUNCH_DATE: new Date("2026-01-01T00:00:00Z"),
  getEngagementCount: vi.fn(async () => 5),
  getSubscriptionAmountKobo: vi.fn(() => BASIC_KOBO),
  isPaymentsLive: () => true,
  isStoreHidden: () => false,
  gracePeriodDaysRemaining: () => null,
}));

vi.mock("../lib/push", () => ({ notifyTokens: vi.fn() }));

vi.mock("@clerk/express", () => ({
  getAuth: vi.fn(() => ({ userId: OWNER_ID })),
}));

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

function txn(status: string) {
  return { status, amount: BASIC_KOBO, currency: "NGN", reference: "r", authorization: {}, customer: {} };
}

describe("subscription charging — payment integrity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    paymentRows = [];
    storeRow = makeStoreRow();
  });

  it("manual charge: charges exactly once and activates on success", async () => {
    chargeMock.mockResolvedValue(txn("success"));
    const app = await buildApp();
    const res = await request(app).post(`/stores/${STORE_ID}/subscription/charge`).send({});
    expect(res.status).toBe(200);
    expect(res.body.subscriptionStatus).toBe("active");
    expect(chargeMock).toHaveBeenCalledTimes(1);
    expect(paymentRows.every((r) => r.consumedAt !== null)).toBe(true);
  });

  it("two concurrent manual requests call Paystack at most once (advisory lock serializes)", async () => {
    chargeMock.mockImplementation(() => new Promise((r) => setTimeout(() => r(txn("success")), 30)));
    const app = await buildApp();
    const [a, b] = await Promise.all([
      request(app).post(`/stores/${STORE_ID}/subscription/charge`).send({}),
      request(app).post(`/stores/${STORE_ID}/subscription/charge`).send({}),
    ]);
    // Both report success (the loser sees the freshly-renewed window), but only ONE real charge happened.
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(chargeMock).toHaveBeenCalledTimes(1);
  });

  it("auto worker and manual request racing the same store charge at most once", async () => {
    chargeMock.mockImplementation(() => new Promise((r) => setTimeout(() => r(txn("success")), 30)));
    const app = await buildApp();
    const { autoChargeDueSubscriptions } = await import("../lib/subscriptionBilling");
    const [manualRes] = await Promise.all([
      request(app).post(`/stores/${STORE_ID}/subscription/charge`).send({}),
      autoChargeDueSubscriptions(),
    ]);
    expect(manualRes.status).toBe(200);
    expect(chargeMock).toHaveBeenCalledTimes(1);
    expect(storeRow.subscriptionStatus).toBe("active");
    // No unconsumed reservations left dangling from the losing path.
    expect(paymentRows.filter((r) => r.consumedAt === null)).toHaveLength(0);
  });

  it("ambiguous timeout that actually settled is reconciled — no second charge", async () => {
    chargeMock.mockRejectedValue(new Error("timeout"));
    verifyMock.mockResolvedValue(txn("success"));
    const app = await buildApp();
    const res = await request(app).post(`/stores/${STORE_ID}/subscription/charge`).send({});
    expect(res.status).toBe(200);
    expect(res.body.subscriptionStatus).toBe("active");
    expect(chargeMock).toHaveBeenCalledTimes(1);
    expect(verifyMock).toHaveBeenCalledTimes(1);
  });

  it("ambiguous timeout whose verify is also inconclusive keeps pending & refuses a safe-retry claim", async () => {
    chargeMock.mockRejectedValue(new Error("timeout"));
    verifyMock.mockRejectedValue(new Error("gateway timeout")); // NOT a 'not found'
    const app = await buildApp();
    const res = await request(app).post(`/stores/${STORE_ID}/subscription/charge`).send({});
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/being confirmed/i);
    expect(paymentRows).toHaveLength(1);
    expect(paymentRows[0].consumedAt).toBeNull();
  });

  it("a fresh request reconciles a leftover settled pending attempt instead of charging again", async () => {
    paymentRows.push({ reference: `dodolink_manual_${STORE_ID}_1`, storeId: STORE_ID, quotedAmountKobo: BASIC_KOBO, consumedAt: null });
    verifyMock.mockResolvedValue(txn("success"));
    const app = await buildApp();
    const res = await request(app).post(`/stores/${STORE_ID}/subscription/charge`).send({});
    expect(res.status).toBe(200);
    expect(verifyMock).toHaveBeenCalledTimes(1);
    expect(chargeMock).not.toHaveBeenCalled();
  });

  it("a leftover inconclusive pending attempt blocks a new charge", async () => {
    paymentRows.push({ reference: `dodolink_manual_${STORE_ID}_1`, storeId: STORE_ID, quotedAmountKobo: BASIC_KOBO, consumedAt: null });
    verifyMock.mockRejectedValue(new Error("gateway timeout"));
    const app = await buildApp();
    const res = await request(app).post(`/stores/${STORE_ID}/subscription/charge`).send({});
    expect(res.status).toBe(502);
    expect(chargeMock).not.toHaveBeenCalled();
  });

  it("a later auto run reconciles its own timed-out pending reference (settled) instead of skipping", async () => {
    const dueAt = storeRow.subscriptionDueAt as Date;
    const autoRef = `dodolink_auto_${STORE_ID}_${dueAt.getTime()}`;
    // Simulate a prior auto run that reserved and charged but never learned the outcome.
    paymentRows.push({ reference: autoRef, storeId: STORE_ID, quotedAmountKobo: BASIC_KOBO, consumedAt: null });
    verifyMock.mockResolvedValue(txn("success")); // it had actually settled remotely
    const { autoChargeDueSubscriptions } = await import("../lib/subscriptionBilling");
    await autoChargeDueSubscriptions();
    expect(chargeMock).not.toHaveBeenCalled(); // resolved WITHOUT a second charge
    expect(storeRow.subscriptionStatus).toBe("active");
    expect(paymentRows[0].consumedAt).not.toBeNull(); // reservation consumed
  });

  it("a later auto run retries its own pending reference when the charge never reached Paystack", async () => {
    const dueAt = storeRow.subscriptionDueAt as Date;
    const autoRef = `dodolink_auto_${STORE_ID}_${dueAt.getTime()}`;
    paymentRows.push({ reference: autoRef, storeId: STORE_ID, quotedAmountKobo: BASIC_KOBO, consumedAt: null });
    verifyMock.mockRejectedValue(new Error("Transaction not found (404)")); // never charged
    chargeMock.mockResolvedValue(txn("success"));
    const { autoChargeDueSubscriptions } = await import("../lib/subscriptionBilling");
    await autoChargeDueSubscriptions();
    expect(chargeMock).toHaveBeenCalledTimes(1); // safe retry happened
    expect(storeRow.subscriptionStatus).toBe("active");
  });
});
