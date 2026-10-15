import type { RequestHandler } from "express";
import { isMigrationStaging } from "@workspace/db/connection-config";

type Environment = Readonly<Record<string, string | undefined>>;

export function readRuntimeSafety(env: Environment) {
  const staging = isMigrationStaging(env);
  return {
    staging,
    backgroundJobsEnabled: !staging,
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

export function stagingWriteGuard(staging: boolean): RequestHandler {
  return (req, res, next) => {
    if (!staging || ["GET", "HEAD", "OPTIONS"].includes(req.method)) {
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
