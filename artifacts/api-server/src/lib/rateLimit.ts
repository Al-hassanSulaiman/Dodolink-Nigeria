import type { Request, Response, NextFunction } from "express";
import { getAuth } from "@clerk/express";

/**
 * Lightweight in-memory sliding-window rate limiter, keyed per user (falls
 * back to IP for unauthenticated requests). Suitable for a single-instance
 * deployment; swap for a shared store if the API ever scales horizontally.
 */
const buckets = new Map<string, number[]>();

// Periodically drop stale buckets so the map doesn't grow unbounded.
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
setInterval(() => {
  const cutoff = Date.now() - CLEANUP_INTERVAL_MS;
  for (const [key, timestamps] of buckets) {
    const fresh = timestamps.filter((t) => t > cutoff);
    if (fresh.length === 0) buckets.delete(key);
    else buckets.set(key, fresh);
  }
}, CLEANUP_INTERVAL_MS).unref();

export function rateLimit(opts: { max: number; windowMs: number; name: string }) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const { userId } = getAuth(req);
    const key = `${opts.name}:${userId ?? req.ip ?? "anon"}`;
    const now = Date.now();
    const windowStart = now - opts.windowMs;

    const timestamps = (buckets.get(key) ?? []).filter((t) => t > windowStart);
    if (timestamps.length >= opts.max) {
      res.status(429).json({ error: "Too many requests. Please slow down and try again shortly." });
      return;
    }

    timestamps.push(now);
    buckets.set(key, timestamps);
    next();
  };
}
