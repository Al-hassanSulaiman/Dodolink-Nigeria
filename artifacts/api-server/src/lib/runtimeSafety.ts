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
