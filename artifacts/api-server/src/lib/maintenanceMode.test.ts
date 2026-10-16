import { describe, expect, it } from "vitest";
import { readMaintenanceKind } from "./maintenanceMode";
const ready = {
  DATABASE_CONNECTION_MODE: "cloud-sql-iam", MIGRATION_STAGING: "false",
  BACKGROUND_JOBS_ENABLED: "false", MAINTENANCE_JOBS_ENABLED: "true",
};
describe("Cloud Run maintenance handoff", () => {
  it("does not change ordinary web startup", () => {
    expect(readMaintenanceKind({})).toBeUndefined();
  });
  it.each(["daily", "retention", "deletions"])("allows explicit task %s after handoff", (kind) => {
    expect(readMaintenanceKind({ ...ready, MAINTENANCE_JOB_KIND: kind })).toBe(kind);
  });
  it.each([
    { MAINTENANCE_JOBS_ENABLED: "false" }, { MAINTENANCE_JOBS_ENABLED: undefined },
    { MIGRATION_STAGING: "true" }, { BACKGROUND_JOBS_ENABLED: "true" },
    { DATABASE_CONNECTION_MODE: "url" }, { MAINTENANCE_JOB_KIND: "unknown" },
  ])("fails closed for unsafe maintenance configuration", (override) => {
    expect(() => readMaintenanceKind({ ...ready, MAINTENANCE_JOB_KIND: "daily", ...override })).toThrow();
  });
});
