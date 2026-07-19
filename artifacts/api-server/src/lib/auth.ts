import { getAuth } from "@clerk/express";
import type { Request, Response } from "express";

/**
 * Returns the authenticated Clerk userId, or sends a 401 response and
 * returns null when the request carries no valid session.
 */
export function requireUser(req: Request, res: Response): string | null {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return null;
  }
  return userId;
}
