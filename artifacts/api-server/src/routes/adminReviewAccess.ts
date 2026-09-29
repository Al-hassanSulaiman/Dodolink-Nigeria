import { Router, type IRouter } from "express";
import { clerkClient } from "@clerk/express";
import { eq } from "drizzle-orm";
import { db, adminsTable } from "@workspace/db";
import {
  AdminGetReviewAccessQueryParams,
  AdminGetReviewAccessResponse,
  AdminCreateReviewAccessBody,
  AdminCreateReviewAccessResponse,
  AdminRevokeReviewAccessParams,
  AdminRevokeReviewAccessResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();
const REVIEW_MARKER = "dodolinkAppReview";

function isReviewAccount(user: { privateMetadata: Record<string, unknown> }): boolean {
  return user.privateMetadata[REVIEW_MARKER] === true;
}

async function isAdminEmail(email: string): Promise<boolean> {
  const [admin] = await db
    .select({ id: adminsTable.id })
    .from(adminsTable)
    .where(eq(adminsTable.email, email))
    .limit(1);
  return !!admin;
}

router.get("/admin/review-access", async (req, res): Promise<void> => {
  const parsed = AdminGetReviewAccessQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a valid review email address" });
    return;
  }

  const email = parsed.data.email.trim().toLowerCase();
  const { data } = await clerkClient.users.getUserList({ emailAddress: [email], limit: 10 });
  const user = data.find((candidate) =>
    candidate.emailAddresses.some((address) => address.emailAddress.toLowerCase() === email),
  );
  if (!user || !isReviewAccount(user)) {
    res.status(404).json({ error: "No dedicated review account found for this email" });
    return;
  }

  res.json(AdminGetReviewAccessResponse.parse({ id: user.id, email, revoked: user.banned }));
});

router.post("/admin/review-access", async (req, res): Promise<void> => {
  const parsed = AdminCreateReviewAccessBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Provide a valid email and a unique password of at least 16 characters" });
    return;
  }
  const email = parsed.data.email.trim().toLowerCase();
  if (await isAdminEmail(email)) {
    res.status(400).json({ error: "An admin email cannot be used for app review" });
    return;
  }

  const { data: existing } = await clerkClient.users.getUserList({ emailAddress: [email], limit: 10 });
  if (existing.some((user) =>
    user.emailAddresses.some((address) => address.emailAddress.toLowerCase() === email),
  )) {
    res.status(409).json({ error: "An account already exists with this email. Use a new review-only address." });
    return;
  }

  // The installed Clerk SDK predates this per-user field. Use the documented
  // Backend API rather than a client-side bypass or a global Device Trust change.
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    res.status(503).json({ error: "Clerk is not configured on this server" });
    return;
  }

  let response: globalThis.Response;
  try {
    response = await fetch("https://api.clerk.com/v1/users", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email_address: [email],
        password: parsed.data.password,
        bypass_client_trust: true,
        private_metadata: { [REVIEW_MARKER]: true },
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    req.log.error("Clerk review-account creation request failed");
    res.status(503).json({ error: "Clerk could not be reached. Please try again." });
    return;
  }

  if (!response.ok) {
    req.log.warn({ status: response.status }, "Clerk rejected review-account creation");
    res.status(response.status === 422 || response.status === 400 ? 422 : 503).json({
      error: response.status === 422 || response.status === 400
        ? "Clerk rejected this account. Use an unused email and a stronger password."
        : "Clerk could not create the account. Please try again later.",
    });
    return;
  }

  type CreatedReviewUser = {
    id?: string;
    bypass_client_trust?: boolean;
    private_metadata?: Record<string, unknown>;
  };
  let created: CreatedReviewUser | null = null;
  try {
    const value: unknown = await response.json();
    if (value && typeof value === "object") {
      created = value as CreatedReviewUser;
    }
  } catch {
    req.log.error("Clerk returned an unreadable review-account creation response");
  }
  if (!created?.id || created.bypass_client_trust !== true ||
      created.private_metadata?.[REVIEW_MARKER] !== true) {
    // Never report success for an account that may still ask reviewers for OTPs.
    let disabled = false;
    try {
      // A 2xx POST means this email was just created (existing users were
      // rejected first). Recover its ID even if the response body was invalid.
      let id = created?.id;
      if (!id) {
        const { data } = await clerkClient.users.getUserList({ emailAddress: [email], limit: 10 });
        id = data.find((user) =>
          user.emailAddresses.some((address) => address.emailAddress.toLowerCase() === email),
        )?.id;
      }
      if (id) {
        await clerkClient.users.banUser(id);
        disabled = true;
      }
    } catch {
      req.log.error("Could not verify or ban incompletely configured review account");
    }
    res.status(503).json({
      error: disabled
        ? "Review account setup was incomplete, so its access was revoked. Use a different email to try again."
        : "Clerk may have created this account, but its status could not be confirmed. Do not share its credentials; contact an administrator to resolve it.",
    });
    return;
  }

  req.log.info({ reviewUserId: created.id }, "Dedicated review account created");
  res.status(201).json(AdminCreateReviewAccessResponse.parse({ id: created.id, email, revoked: false }));
});

router.delete("/admin/review-access/:userId", async (req, res): Promise<void> => {
  const parsed = AdminRevokeReviewAccessParams.safeParse(req.params);
  if (!parsed.success || !parsed.data.userId.startsWith("user_")) {
    res.status(400).json({ error: "Invalid review account ID" });
    return;
  }

  const user = await clerkClient.users.getUser(parsed.data.userId);
  if (!isReviewAccount(user)) {
    res.status(404).json({ error: "Not a dedicated review account" });
    return;
  }
  const email = user.emailAddresses[0]?.emailAddress.toLowerCase();
  if (!email || (await Promise.all(
    user.emailAddresses.map((address) => isAdminEmail(address.emailAddress.toLowerCase())),
  )).some(Boolean)) {
    res.status(403).json({ error: "Admin accounts cannot be revoked here" });
    return;
  }

  if (!user.banned) await clerkClient.users.banUser(user.id);
  req.log.info({ reviewUserId: user.id }, "Dedicated review account revoked");
  res.json(AdminRevokeReviewAccessResponse.parse({ id: user.id, email, revoked: true }));
});

export default router;