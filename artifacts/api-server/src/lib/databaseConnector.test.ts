import { describe, expect, it, vi } from "vitest";
import { createPoolOptions, readDatabaseSettings } from "@workspace/db/connection-config";

describe("PostgreSQL pool connection selection", () => {
  const iamSettings = () => readDatabaseSettings({
    DATABASE_CONNECTION_MODE: "cloud-sql-iam",
    CLOUD_SQL_INSTANCE_CONNECTION_NAME: "test-project:africa-south1:test-instance",
    CLOUD_SQL_IAM_USER: "runtime@test-project.iam",
    CLOUD_SQL_DATABASE: "fixture",
    MIGRATION_STAGING: "true",
    DATABASE_URL: "postgresql://fixture:fixture@localhost/fixture",
  });

  it("retains the URL pool and does not initialize an IAM connection", async () => {
    const connect = vi.fn();
    const options = await createPoolOptions(readDatabaseSettings({
      DATABASE_URL: "postgresql://fixture:fixture@localhost/fixture",
    }), connect);
    expect(options).toEqual({
      connectionString: "postgresql://fixture:fixture@localhost/fixture",
    });
    expect(connect).not.toHaveBeenCalled();
  });

  it("preserves connector transport and creates a read-only IAM pool without a password or URL", async () => {
    const stream = vi.fn();
    const connect = vi.fn().mockResolvedValue({ stream });
    const options = await createPoolOptions(iamSettings(), connect);
    expect(connect).toHaveBeenCalledWith(iamSettings());
    expect(options).toMatchObject({
      stream, user: "runtime@test-project.iam",
      database: "fixture", max: 5, options: "-c default_transaction_read_only=on",
    });
    expect(options).not.toHaveProperty("password");
    expect(options).not.toHaveProperty("connectionString");
  });

  it("propagates an IAM connection failure without returning URL fallback settings", async () => {
    const connect = vi.fn().mockRejectedValue(new Error("fixture connection failure"));
    await expect(createPoolOptions(iamSettings(), connect))
      .rejects.toThrow("fixture connection failure");
    expect(connect).toHaveBeenCalledOnce();
  });
});
