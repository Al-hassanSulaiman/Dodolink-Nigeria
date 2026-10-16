/**
 * Tests confirming that push notifications use the current (post-rename) store
 * name when a retailer sends a reply after the store has been renamed.
 *
 * The push-notification title is built from resolvedSenderName, which is
 * fetched live from the stores table at send time — so a rename takes effect
 * immediately for all future messages without any cache invalidation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CUSTOMER_ID   = "user_customer_001";
const RETAILER_ID   = "user_retailer_002";
const STORE_ID      = 7;
const CONV_ID       = 55;
const OLD_NAME      = "Old Store Name";
const NEW_NAME      = "Renamed Store";
const CUSTOMER_EMAIL = "buyer@example.com";
const PUSH_TOKEN    = "ExponentPushToken[customer-device-abc]";

const baseConversation = {
  id: CONV_ID,
  customerId: CUSTOMER_ID,
  customerName: CUSTOMER_EMAIL,
  storeId: STORE_ID,
  lastMessage: null,
  lastMessageAt: null,
  unreadCount: 0,
  storeUnreadCount: 0,
  createdAt: new Date(),
};

const baseStore = {
  id: STORE_ID,
  ownerUserId: RETAILER_ID,
  name: NEW_NAME, // already renamed
};

const insertedMessage = {
  id: 999,
  conversationId: CONV_ID,
  senderId: RETAILER_ID,
  senderName: NEW_NAME,
  senderType: "retailer",
  body: "Here is your reply!",
  mediaUrl: null,
  createdAt: new Date(),
};

// ---------------------------------------------------------------------------
// Mock helpers (mirrors stores.rename.test.ts patterns)
// ---------------------------------------------------------------------------

function makeSelectResult(rows: unknown[]) {
  const chain: any = {
    from: () => chain,
    where: () => Promise.resolve(rows),
    $dynamic: () => chain,
    limit: () => chain,
    offset: () => chain,
    orderBy: () => Promise.resolve(rows),
  };
  return chain;
}

function makeInsertChain(returningRows: unknown[]) {
  const chain: any = {
    values: () => chain,
    returning: () => Promise.resolve(returningRows),
  };
  return chain;
}

function makeUpdateChain() {
  let resolveChain!: (v: unknown) => void;
  const promise = new Promise((res) => { resolveChain = res; });
  const chain: any = Object.assign(promise, {
    set: () => chain,
    where() {
      resolveChain(undefined);
      return chain;
    },
    returning() {
      resolveChain([]);
      return Promise.resolve([]);
    },
  });
  return chain;
}

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const notifyTokensMock = vi.fn().mockResolvedValue(undefined);

vi.mock("../lib/push", () => ({
  notifyTokens: notifyTokensMock,
  sendPushNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@workspace/db", () => {
  const storesTable = {
    id: Symbol("stores.id"),
    ownerUserId: Symbol("stores.ownerUserId"),
    name: Symbol("stores.name"),
  };
  const conversationsTable = {
    id: Symbol("conv.id"),
    customerId: Symbol("conv.customerId"),
    storeId: Symbol("conv.storeId"),
    lastMessage: Symbol("conv.lastMessage"),
    lastMessageAt: Symbol("conv.lastMessageAt"),
    unreadCount: Symbol("conv.unreadCount"),
    storeUnreadCount: Symbol("conv.storeUnreadCount"),
    customerName: Symbol("conv.customerName"),
  };
  const messagesTable = {
    id: Symbol("msg.id"),
    conversationId: Symbol("msg.conversationId"),
    senderId: Symbol("msg.senderId"),
    senderName: Symbol("msg.senderName"),
    senderType: Symbol("msg.senderType"),
    body: Symbol("msg.body"),
    mediaUrl: Symbol("msg.mediaUrl"),
  };
  const pushTokensTable = {
    userId: Symbol("push.userId"),
    token: Symbol("push.token"),
  };

  const db = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  };

  return {
    db,
    storesTable,
    conversationsTable,
    messagesTable,
    pushTokensTable,
  };
});

vi.mock("drizzle-orm", () => ({
  eq:      vi.fn((col: unknown, val: unknown) => ({ op: "eq", col, val })),
  and:     vi.fn((...args: unknown[]) => ({ op: "and", args })),
  inArray: vi.fn((col: unknown, vals: unknown) => ({ op: "inArray", col, vals })),
  sql:     vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ op: "sql", strings, values })),
  ilike:   vi.fn(),
}));

vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  getAuth: vi.fn(() => ({ userId: RETAILER_ID })),
  clerkClient: {
    users: {
      getUser: vi.fn().mockResolvedValue({
        primaryEmailAddressId: "eid_1",
        emailAddresses: [{ id: "eid_1", emailAddress: CUSTOMER_EMAIL }],
      }),
    },
  },
}));

vi.mock("../lib/rateLimit", () => ({
  rateLimit: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../lib/storeSubscription", () => ({
  checkAndSetQualifiedAt: vi.fn().mockResolvedValue(undefined),
  visibleStoresFilter: vi.fn(() => ({})),
  isStoreHidden: vi.fn(() => false),
}));

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock("../lib/objectStorage", () => ({
  ObjectStorageService: class {
    getObjectEntityFile = vi.fn();
  },
  ObjectNotFoundError: class extends Error {},
}));

vi.mock("../lib/mediaLimits", () => ({
  validateStoredMedia: vi.fn().mockResolvedValue({ ok: true }),
}));

// ---------------------------------------------------------------------------
// App factory
// ---------------------------------------------------------------------------

async function buildApp(authUserId = RETAILER_ID) {
  const { getAuth } = await import("@clerk/express");
  (getAuth as ReturnType<typeof vi.fn>).mockReturnValue({ userId: authUserId });

  const { default: messagesRouter } = await import("./messages");
  const app = express();
  app.use(express.json());
  app.use(messagesRouter);
  return app;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Wire up db.select to return `selectResults[call]` on successive calls.
 * The select mock is used by multiple code paths in the route; the order
 * below matches the execution order for each scenario.
 */
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /conversations/:id/messages — push notification sender name", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notifyTokensMock.mockResolvedValue(undefined);
  });

  it("uses the NEW store name in the push title when retailer replies after a rename", async () => {
    /**
     * Sequence of db.select() calls inside the route handler for a retailer reply:
     *  [0] loadConversationIfParticipant  → conversation row
     *  [1] loadConversationIfParticipant  → store (ownerUserId check)
     *  [2] resolvedSenderName             → store { name: NEW_NAME }   ← post-rename
     *  [3] push block                     → conversation row (re-fetched)
     *  [4] push block                     → store { ownerUserId }
     *  [5] push block (senderIsRetailer)  → customer push tokens
     */
    const { db } = await import("@workspace/db");

    setupSelectMock(db as any, [
      [baseConversation],                            // [0] conv
      [{ ownerUserId: RETAILER_ID }],                // [1] store (auth check)
      [{ name: NEW_NAME }],                          // [2] store name for resolvedSenderName
      [baseConversation],                            // [3] conv for push
      [{ ownerUserId: RETAILER_ID }],                // [4] store for push
      [{ token: PUSH_TOKEN }],                       // [5] customer push tokens
    ]);

    (db as any).insert.mockImplementation(() => makeInsertChain([insertedMessage]));
    (db as any).update.mockImplementation(() => makeUpdateChain());

    const app = await buildApp(RETAILER_ID);
    const res = await request(app)
      .post(`/conversations/${CONV_ID}/messages`)
      .send({
        senderId: RETAILER_ID,
        senderName: OLD_NAME,   // client sends stale name — should be ignored
        senderType: "retailer",
        body: "Here is your reply!",
      });

    expect(res.status).toBe(201);

    // notifyTokens must have been called exactly once (to the customer)
    expect(notifyTokensMock).toHaveBeenCalledTimes(1);

    const [tokens, title, body, data] = notifyTokensMock.mock.calls[0];

    // The push goes to the customer's device
    expect(tokens).toContain(PUSH_TOKEN);

    // The title must reference the RENAMED store, not the old name or the
    // client-submitted senderName
    expect(title).toBe(`Reply from ${NEW_NAME}`);
    expect(title).not.toContain(OLD_NAME);

    // Body and routing data are also correct
    expect(body).toBe("Here is your reply!");
    expect(data).toEqual({ conversationId: CONV_ID });
  });

  it("notifyTokens is NOT called when there are no push tokens registered for the recipient", async () => {
    const { db } = await import("@workspace/db");

    setupSelectMock(db as any, [
      [baseConversation],
      [{ ownerUserId: RETAILER_ID }],
      [{ name: NEW_NAME }],
      [baseConversation],
      [{ ownerUserId: RETAILER_ID }],
      [],                                            // no push tokens → skip notification
    ]);

    (db as any).insert.mockImplementation(() => makeInsertChain([insertedMessage]));
    (db as any).update.mockImplementation(() => makeUpdateChain());

    const app = await buildApp(RETAILER_ID);
    const res = await request(app)
      .post(`/conversations/${CONV_ID}/messages`)
      .send({ senderId: RETAILER_ID, senderName: NEW_NAME, senderType: "retailer", body: "Hey!" });

    expect(res.status).toBe(201);
    // notifyTokens receives an empty array and returns early without sending
    // (validated inside notifyTokens itself), so the mock may or may not be
    // called — what matters is no push was actually dispatched.
    const sentToNonEmpty = notifyTokensMock.mock.calls.some(
      ([toks]) => Array.isArray(toks) && toks.length > 0,
    );
    expect(sentToNonEmpty).toBe(false);
  });

  it.each([
    { ownedStores: [], expectedName: CUSTOMER_EMAIL },
    { ownedStores: [{ id: 12, ownerUserId: CUSTOMER_ID, name: "Buyer's Store" }], expectedName: "Buyer's Store" },
  ])("uses the customer's resolved identity in recipient notifications: $expectedName", async ({ ownedStores, expectedName }) => {
    /**
     * Sequence of db.select() calls for a customer-sent message:
     *  [0] loadConversationIfParticipant  → conversation (customerId === authUserId → allowed, no second select)
     *  [1] customer identity              → owned stores (email fallback if none)
     *  [2] push block                     → conversation row (re-fetched)
     *  [3] push block                     → store { ownerUserId }
     *  [4] push block (senderIsCustomer)  → store owner push tokens
     */
    const OWNER_TOKEN = "ExponentPushToken[owner-device-xyz]";

    const { db } = await import("@workspace/db");
    const { getAuth, clerkClient } = await import("@clerk/express");

    (getAuth as ReturnType<typeof vi.fn>).mockReturnValue({ userId: CUSTOMER_ID });
    (clerkClient.users.getUser as ReturnType<typeof vi.fn>).mockResolvedValue({
      primaryEmailAddressId: "eid_1",
      emailAddresses: [{ id: "eid_1", emailAddress: CUSTOMER_EMAIL }],
    });

    setupSelectMock(db as any, [
      [baseConversation],                            // [0] conv (customer path — returns early)
      ownedStores,
      [baseConversation],                            // [1] conv for push
      [{ ownerUserId: RETAILER_ID }],                // [2] store for push
      [{ token: OWNER_TOKEN }],                      // [3] owner push tokens
    ]);

    const customerMessage = {
      id: 1000,
      conversationId: CONV_ID,
      senderId: CUSTOMER_ID,
      senderName: expectedName,
      senderType: "customer",
      body: "Hello store!",
      mediaUrl: null,
      createdAt: new Date(),
    };

    (db as any).insert.mockImplementation(() => {
      const chain = makeInsertChain([customerMessage]);
      vi.spyOn(chain, "values");
      return chain;
    });
    (db as any).update.mockImplementation(() => makeUpdateChain());

    const app = await buildApp(CUSTOMER_ID);
    const res = await request(app)
      .post(`/conversations/${CONV_ID}/messages`)
      .send({ senderId: CUSTOMER_ID, senderName: CUSTOMER_EMAIL, senderType: "customer", body: "Hello store!" });

    expect(res.status).toBe(201);
    expect((db as any).insert.mock.results[0].value.values).toHaveBeenCalledWith(expect.objectContaining({
      senderName: expectedName,
    }));

    expect(notifyTokensMock).toHaveBeenCalledTimes(1);
    const [tokens, title, body] = notifyTokensMock.mock.calls[0];

    // Push goes to the store owner's device
    expect(tokens).toContain(OWNER_TOKEN);

    // Both stored messages and notifications ignore the client-submitted name.
    expect(title).toBe(`New message from ${expectedName}`);
    expect(body).toBe("Hello store!");
  });
});
