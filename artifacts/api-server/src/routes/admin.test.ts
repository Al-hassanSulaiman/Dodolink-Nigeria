/**
 * Tests for admin access control:
 *   - requireAdmin middleware: a user whose email is in the admins table
 *     passes; one who isn't gets 403; unauthenticated gets 401.
 *   - DELETE /admin/admins/:adminId protections: cannot remove the last
 *     admin, cannot remove your own admin access, can remove another admin.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// --------------------------------------------------------------------------
// Fixtures
// --------------------------------------------------------------------------

const ADMIN_USER_ID = "user_admin_1";
const ADMIN_EMAIL = "admin@example.com";
const OTHER_ADMIN_ID = 2;
const OTHER_ADMIN_EMAIL = "other@example.com";

// --------------------------------------------------------------------------
// Mock helpers
// --------------------------------------------------------------------------

/**
 * Build a drizzle-style SELECT chain that is itself a thenable resolving to
 * `rows`, so any of these shapes work:
 *   await db.select({...}).from(t)
 *   await db.select().from(t).where(c).limit(n)
 *   await db.select().from(t).orderBy(o)
 */
function makeSelectChain(rows: unknown[]) {
  const chain: any = {
    from: () => chain,
    where: () => chain,
    limit: () => chain,
    offset: () => chain,
    orderBy: () => chain,
    $dynamic: () => chain,
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject),
  };
  return chain;
}

/** Thenable DELETE chain: await db.delete(t).where(c) */
function makeDeleteChain(onWhere?: (cond: unknown) => void) {
  const chain: any = {
    where: (cond: unknown) => {
      onWhere?.(cond);
      return chain;
    },
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(undefined).then(resolve, reject),
  };
  return chain;
}

/** INSERT chain: db.insert(t).values(v).onConflictDoNothing() / .returning() */
function makeInsertChain(returningRows: unknown[] = []) {
  const chain: any = {
    values: () => chain,
    onConflictDoNothing: () => Promise.resolve(undefined),
    returning: () => Promise.resolve(returningRows),
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(undefined).then(resolve, reject),
  };
  return chain;
}

// --------------------------------------------------------------------------
// Module mocks
// --------------------------------------------------------------------------

vi.mock("@workspace/db", () => {
  const table = (name: string) => ({
    id: Symbol(`${name}.id`),
    email: Symbol(`${name}.email`),
    createdAt: Symbol(`${name}.createdAt`),
  });
  const db = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
  return {
    db,
    adminsTable: table("admins"),
    storesTable: table("stores"),
    productsTable: table("products"),
    conversationsTable: table("conversations"),
    supportMessagesTable: table("supportMessages"),
    pushTokensTable: table("pushTokens"),
  };
});

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ op: "eq", col, val })),
  inArray: vi.fn((col: unknown, vals: unknown) => ({ op: "inArray", col, vals })),
  and: vi.fn((...args: unknown[]) => ({ op: "and", args })),
  asc: vi.fn(),
  desc: vi.fn(),
  count: vi.fn(() => ({ op: "count" })),
  sql: vi.fn(),
}));

const getAuthMock = vi.fn();
const getUserMock = vi.fn();

vi.mock("@clerk/express", () => ({
  getAuth: (req: unknown) => getAuthMock(req),
  clerkClient: { users: { getUser: (id: string) => getUserMock(id) } },
}));

vi.mock("@workspace/api-zod", () => {
  const passthrough = { safeParse: (v: unknown) => ({ success: true, data: v }) };
  // Lightweight stand-in for the real zod schema: requires a string email
  // that looks like an address, mirroring z.object({ email: z.string().email() }).
  const addAdminBody = {
    safeParse: (v: unknown) => {
      const email = (v as any)?.email;
      if (typeof email !== "string" || !email.includes("@")) {
        return { success: false, error: { message: "Invalid email" } };
      }
      return { success: true, data: { email } };
    },
  };
  return {
    AdminRejectStoreBody: passthrough,
    AdminUpdateStoreBody: passthrough,
    SendSupportMessageBody: passthrough,
    AdminAddAdminBody: addAdminBody,
  };
});

vi.mock("../lib/push", () => ({ notifyTokens: vi.fn() }));

// --------------------------------------------------------------------------
// Test helpers
// --------------------------------------------------------------------------

async function buildApp() {
  // Fresh import each test so module-level `bootstrapChecked` resets
  const { default: adminRouter } = await import("./admin");
  const app = express();
  app.use(express.json());
  app.use(adminRouter);
  return app;
}

/** Queue up SELECT results in call order. Unlisted calls resolve to []. */
function setupSelectMock(db: { select: ReturnType<typeof vi.fn> }, results: Array<unknown[]>) {
  let call = 0;
  db.select.mockImplementation(() => makeSelectChain(results[call++] ?? []));
}

function authedAs(userId: string | null, emails: string[] = []) {
  getAuthMock.mockReturnValue({ userId });
  getUserMock.mockResolvedValue({
    emailAddresses: emails.map((emailAddress) => ({ emailAddress })),
  });
}

// Bootstrap count SELECT (non-empty table → no seed insert)
const BOOTSTRAP_COUNT = [{ total: 2 }];

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe("requireAdmin middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("returns 401 when unauthenticated", async () => {
    authedAs(null);
    const app = await buildApp();
    const res = await request(app).get("/admin/admins");
    expect(res.status).toBe(401);
  });

  it("returns 403 when the user's email is not in the admins table", async () => {
    authedAs("user_not_admin", ["stranger@example.com"]);
    const { db } = await import("@workspace/db");
    setupSelectMock(db as any, [
      BOOTSTRAP_COUNT,               // ensureBootstrapAdmins count
      [{ email: ADMIN_EMAIL }],      // cached admin email set → no match
    ]);

    const app = await buildApp();
    const res = await request(app).get("/admin/admins");
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/not an admin/i);
  });

  it("lets a user whose email IS in the admins table through (200)", async () => {
    authedAs(ADMIN_USER_ID, [ADMIN_EMAIL]);
    const { db } = await import("@workspace/db");
    const adminRows = [
      { id: 1, email: ADMIN_EMAIL, addedBy: "bootstrap", createdAt: new Date().toISOString() },
    ];
    setupSelectMock(db as any, [
      BOOTSTRAP_COUNT,          // bootstrap count
      [{ email: ADMIN_EMAIL }], // admin email set → match
      adminRows,                // GET /admin/admins listing
    ]);

    const app = await buildApp();
    const res = await request(app).get("/admin/admins");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].email).toBe(ADMIN_EMAIL);
  });

  it("returns 403 when the Clerk user lookup fails", async () => {
    getAuthMock.mockReturnValue({ userId: ADMIN_USER_ID });
    getUserMock.mockRejectedValue(new Error("clerk down"));
    const { db } = await import("@workspace/db");
    setupSelectMock(db as any, [BOOTSTRAP_COUNT]);

    const app = await buildApp();
    const res = await request(app).get("/admin/admins");
    expect(res.status).toBe(403);
  });
});

describe("POST /admin/admins", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("returns 400 for an invalid body (missing/bad email)", async () => {
    authedAs(ADMIN_USER_ID, [ADMIN_EMAIL]);
    const { db } = await import("@workspace/db");
    setupSelectMock(db as any, [
      BOOTSTRAP_COUNT, // bootstrap count
      [{ id: 1 }],     // requireAdmin match
    ]);
    (db as any).insert.mockImplementation(() => makeInsertChain());

    const app = await buildApp();
    const res = await request(app).post("/admin/admins").send({ email: "not-an-email" });
    expect(res.status).toBe(400);
    expect((db as any).insert).not.toHaveBeenCalled();
  });

  it("returns 409 when the email is already an admin", async () => {
    authedAs(ADMIN_USER_ID, [ADMIN_EMAIL]);
    const { db } = await import("@workspace/db");
    setupSelectMock(db as any, [
      BOOTSTRAP_COUNT,                              // bootstrap count
      [{ id: 1 }],                                  // requireAdmin match
      [{ id: OTHER_ADMIN_ID, email: OTHER_ADMIN_EMAIL }], // existing-admin lookup → found
    ]);
    (db as any).insert.mockImplementation(() => makeInsertChain());

    const app = await buildApp();
    const res = await request(app).post("/admin/admins").send({ email: OTHER_ADMIN_EMAIL });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already an admin/i);
    expect((db as any).insert).not.toHaveBeenCalled();
  });

  it("treats a duplicate as duplicate even with different case/whitespace (409)", async () => {
    authedAs(ADMIN_USER_ID, [ADMIN_EMAIL]);
    const { db } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    setupSelectMock(db as any, [
      BOOTSTRAP_COUNT,
      [{ id: 1 }],
      [{ id: OTHER_ADMIN_ID, email: OTHER_ADMIN_EMAIL }], // lookup with normalized email → found
    ]);
    (db as any).insert.mockImplementation(() => makeInsertChain());

    const app = await buildApp();
    const res = await request(app)
      .post("/admin/admins")
      .send({ email: `  ${OTHER_ADMIN_EMAIL.toUpperCase()}  ` });
    expect(res.status).toBe(409);
    // The duplicate lookup must use the normalized (trimmed, lowercased) email
    const eqCalls = (eq as any).mock.calls.map((c: unknown[]) => c[1]);
    expect(eqCalls).toContain(OTHER_ADMIN_EMAIL);
    expect((db as any).insert).not.toHaveBeenCalled();
  });

  it("inserts with a trimmed, lowercased email (201)", async () => {
    authedAs(ADMIN_USER_ID, [ADMIN_EMAIL]);
    const { db } = await import("@workspace/db");
    setupSelectMock(db as any, [
      BOOTSTRAP_COUNT,
      [{ id: 1 }],
      [],              // existing-admin lookup → none
    ]);
    let insertedValues: any;
    (db as any).insert.mockImplementation(() => {
      const chain: any = {
        values: (v: unknown) => {
          insertedValues = v;
          return chain;
        },
        returning: () =>
          Promise.resolve([{ id: 3, email: insertedValues.email, addedBy: insertedValues.addedBy }]),
      };
      return chain;
    });

    const app = await buildApp();
    const res = await request(app)
      .post("/admin/admins")
      .send({ email: "  New.Admin@Example.COM  " });
    expect(res.status).toBe(201);
    expect(insertedValues.email).toBe("new.admin@example.com");
    expect(insertedValues.addedBy).toBe(ADMIN_USER_ID);
    expect(res.body.email).toBe("new.admin@example.com");
  });
});

describe("DELETE /admin/admins/:adminId protections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("refuses to remove the last remaining admin (400)", async () => {
    authedAs(ADMIN_USER_ID, [ADMIN_EMAIL]);
    const { db } = await import("@workspace/db");
    setupSelectMock(db as any, [
      BOOTSTRAP_COUNT,                       // bootstrap count
      [{ email: ADMIN_EMAIL }],              // admin email set → match
      [{ id: 1, email: ADMIN_EMAIL }],       // target admin lookup
      [{ total: 1 }],                        // total admins = 1 → last admin
    ]);
    (db as any).delete.mockImplementation(() => makeDeleteChain());

    const app = await buildApp();
    const res = await request(app).delete("/admin/admins/1");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/last admin/i);
    expect((db as any).delete).not.toHaveBeenCalled();
  });

  it("refuses to let an admin revoke their own access (400)", async () => {
    authedAs(ADMIN_USER_ID, [ADMIN_EMAIL]);
    const { db } = await import("@workspace/db");
    setupSelectMock(db as any, [
      BOOTSTRAP_COUNT,                       // bootstrap count
      [{ email: ADMIN_EMAIL }],              // admin email set → match
      [{ id: 1, email: ADMIN_EMAIL }],       // target = caller's own email
      [{ total: 2 }],                        // more than one admin exists
    ]);
    (db as any).delete.mockImplementation(() => makeDeleteChain());

    const app = await buildApp();
    const res = await request(app).delete("/admin/admins/1");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/own admin access/i);
    expect((db as any).delete).not.toHaveBeenCalled();
  });

  it("removes a DIFFERENT admin when protections don't apply (200)", async () => {
    authedAs(ADMIN_USER_ID, [ADMIN_EMAIL]);
    const { db } = await import("@workspace/db");
    setupSelectMock(db as any, [
      BOOTSTRAP_COUNT,                             // bootstrap count
      [{ email: ADMIN_EMAIL }],                    // admin email set → match
      [{ id: OTHER_ADMIN_ID, email: OTHER_ADMIN_EMAIL }], // target ≠ caller
      [{ total: 2 }],                              // not the last admin
    ]);
    (db as any).delete.mockImplementation(() => makeDeleteChain());

    const app = await buildApp();
    const res = await request(app).delete(`/admin/admins/${OTHER_ADMIN_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect((db as any).delete).toHaveBeenCalledTimes(1);
  });

  it("returns 404 when the target admin does not exist (delete)", async () => {
    authedAs(ADMIN_USER_ID, [ADMIN_EMAIL]);
    const { db } = await import("@workspace/db");
    setupSelectMock(db as any, [
      BOOTSTRAP_COUNT,          // bootstrap count
      [{ email: ADMIN_EMAIL }], // admin email set → match
      [],                       // target lookup → not found
    ]);
    (db as any).delete.mockImplementation(() => makeDeleteChain());

    const app = await buildApp();
    const res = await request(app).delete("/admin/admins/999");
    expect(res.status).toBe(404);
    expect((db as any).delete).not.toHaveBeenCalled();
  });
});

describe("admin email cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("reuses the cached admin set on subsequent requests within the TTL", async () => {
    authedAs(ADMIN_USER_ID, [ADMIN_EMAIL]);
    const { db } = await import("@workspace/db");
    setupSelectMock(db as any, [
      BOOTSTRAP_COUNT,          // bootstrap count (request 1)
      [{ email: ADMIN_EMAIL }], // admin email set fetch (request 1)
      [],                       // GET /admin/admins listing (request 1)
      [],                       // GET /admin/admins listing (request 2, cache hit)
    ]);

    const app = await buildApp();
    expect((await request(app).get("/admin/admins")).status).toBe(200);
    expect((await request(app).get("/admin/admins")).status).toBe(200);
    // 4 selects total: the second request skipped bootstrap + email set fetch.
    expect((db as any).select).toHaveBeenCalledTimes(4);
  });

  it("invalidates the cache when an admin is removed, locking them out immediately", async () => {
    authedAs(ADMIN_USER_ID, [ADMIN_EMAIL]);
    const { db } = await import("@workspace/db");
    setupSelectMock(db as any, [
      BOOTSTRAP_COUNT,                                     // bootstrap count
      [{ email: ADMIN_EMAIL }, { email: OTHER_ADMIN_EMAIL }], // email set (both admins)
      [{ id: OTHER_ADMIN_ID, email: OTHER_ADMIN_EMAIL }],  // target lookup
      [{ total: 2 }],                                      // not the last admin
      // After delete the cache was invalidated → next requireAdmin re-fetches:
      [{ email: ADMIN_EMAIL }],                            // fresh email set (other removed)
    ]);
    (db as any).delete.mockImplementation(() => makeDeleteChain());

    const app = await buildApp();
    const del = await request(app).delete(`/admin/admins/${OTHER_ADMIN_ID}`);
    expect(del.status).toBe(200);

    // The removed admin is denied on their very next request.
    authedAs("user_other", [OTHER_ADMIN_EMAIL]);
    const res = await request(app).get("/admin/admins");
    expect(res.status).toBe(403);
  });

  it("refetches the admin set after the TTL expires", async () => {
    vi.useFakeTimers();
    try {
      authedAs(ADMIN_USER_ID, [ADMIN_EMAIL]);
      const { db } = await import("@workspace/db");
      setupSelectMock(db as any, [
        BOOTSTRAP_COUNT,          // bootstrap count
        [{ email: ADMIN_EMAIL }], // email set (request 1)
        [],                       // listing (request 1)
        [],                       // email set (request 2, after expiry) → revoked
      ]);

      const app = await buildApp();
      expect((await request(app).get("/admin/admins")).status).toBe(200);

      vi.advanceTimersByTime(61_000); // past the TTL

      const res = await request(app).get("/admin/admins");
      expect(res.status).toBe(403);
    } finally {
      vi.useRealTimers();
    }
  });
});
