import type { RequestHandler } from "express";
import { isMigrationStaging } from "@workspace/db/connection-config";

type Environment = Readonly<Record<string, string | undefined>>;

export function readProxyHopCount(env: Environment): 1 | 2 {
  const value = env.TRUST_PROXY_HOPS ?? "1";
  if (value !== "1" && value !== "2") throw new Error("TRUST_PROXY_HOPS must be 1 or 2.");
  return value === "2" ? 2 : 1;
}

export function readRuntimeSafety(env: Environment) {
  const staging = isMigrationStaging(env);
  const jobs = env.BACKGROUND_JOBS_ENABLED;
  if (jobs !== undefined && jobs !== "true" && jobs !== "false") {
    throw new Error("BACKGROUND_JOBS_ENABLED must be true or false.");
  }
  if (!staging && env.DATABASE_CONNECTION_MODE === "cloud-sql-iam" && jobs === undefined) {
    throw new Error("Writable Cloud SQL deployments require explicit BACKGROUND_JOBS_ENABLED.");
  }
  if (staging && jobs === "true") {
    throw new Error("Background jobs cannot be enabled in migration staging.");
  }
  if (env.MIGRATION_ALLOW_AUTH !== undefined &&
      !["true", "false"].includes(env.MIGRATION_ALLOW_AUTH)) {
    throw new Error("MIGRATION_ALLOW_AUTH must be true or false.");
  }
  if (!staging && env.MIGRATION_ALLOW_AUTH === "true") {
    throw new Error("MIGRATION_ALLOW_AUTH is only for read-only staging.");
  }
  return {
    staging,
    backgroundJobsEnabled: !staging && jobs !== "false",
    initializeSchema: !staging && env.DATABASE_CONNECTION_MODE !== "cloud-sql-iam",
  };
}

export const runtimeSafety = readRuntimeSafety(process.env);

export function stagingAuthenticationGuard(env: Environment): RequestHandler {
  const pending = env.MIGRATION_AUTH_PENDING === "true";
  if (env.MIGRATION_AUTH_PENDING !== undefined &&
      !["true", "false"].includes(env.MIGRATION_AUTH_PENDING)) {
    throw new Error("MIGRATION_AUTH_PENDING must be true or false.");
  }
  if (pending && !isMigrationStaging(env)) {
    throw new Error("Pending authentication is allowed only in migration staging.");
  }
  return (req, res, next) => {
    if (!pending) { next(); return; }
    res.setHeader("Cache-Control", "no-store");
    // Infrastructure health only. Never simulate Clerk or anonymous auth:
    // every business endpoint stays locked until real authentication is ready.
    if (req.path === "/healthz" && ["GET", "HEAD"].includes(req.method)) {
      res.json({ status: "ok" });
      return;
    }
    res.status(503).json({
      error: "Staging authentication is not configured. Application access is disabled.",
      code: "STAGING_AUTH_PENDING",
    });
  };
}

export function stagingWriteGuard(staging: boolean, allowAuthentication = false): RequestHandler {
  return (req, res, next) => {
    const authProxy = req.path === "/__clerk" || req.path.startsWith("/__clerk/");
    if (!staging || ["GET", "HEAD", "OPTIONS"].includes(req.method) ||
        (allowAuthentication && authProxy)) {
      next();
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    res.status(503).json({
      error: "This migration staging API is read-only. Payments, uploads, and other changes are disabled.",
      code: "STAGING_READ_ONLY",
    });
  };
}
