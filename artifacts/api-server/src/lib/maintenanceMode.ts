type Environment = Readonly<Record<string, string | undefined>>;
export type MaintenanceKind = "daily" | "retention" | "deletions";

export function readMaintenanceKind(env: Environment): MaintenanceKind | undefined {
  const kind = env.MAINTENANCE_JOB_KIND;
  if (kind === undefined) return undefined;
  if (!["daily", "retention", "deletions"].includes(kind)) {
    throw new Error("Unknown maintenance job kind.");
  }
  if (env.DATABASE_CONNECTION_MODE !== "cloud-sql-iam" ||
      env.MIGRATION_STAGING !== "false" ||
      env.BACKGROUND_JOBS_ENABLED !== "false" ||
      env.MAINTENANCE_JOBS_ENABLED !== "true") {
    throw new Error("Cloud maintenance is disabled until the explicit source-job handoff.");
  }
  return kind as MaintenanceKind;
}
