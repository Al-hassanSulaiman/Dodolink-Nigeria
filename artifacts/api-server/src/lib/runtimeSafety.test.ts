import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { isMigrationStaging, readDatabaseSettings } from "@workspace/db/connection-config";
import { readRuntimeSafety, stagingWriteGuard, stagingAuthenticationGuard } from "./runtimeSafety";

const fixtureUrl = "postgresql://fixture:fixture@localhost/fixture";
const iamEnvironment = {
  DATABASE_CONNECTION_MODE: "cloud-sql-iam",
  MIGRATION_STAGING: "false",
  CLOUD_SQL_INSTANCE_CONNECTION_NAME: "test-project:africa-south1:test-instance",
  CLOUD_SQL_IAM_USER: "test-runtime@test-project.iam",
  CLOUD_SQL_DATABASE: "fixture",
};

describe("migration runtime configuration", () => {
  it("preserves normal Replit startup behavior by default", () => {
    expect(readRuntimeSafety({})).toEqual({
      staging: false, backgroundJobsEnabled: true, initializeSchema: true,
    });
    expect(readDatabaseSettings({ DATABASE_URL: fixtureUrl })).toEqual({
      mode: "url", connectionString: fixtureUrl, readOnly: false,
    });
  });

  it("disables all background jobs and startup DDL in staging", () => {
    expect(readRuntimeSafety({ MIGRATION_STAGING: "true" })).toEqual({
      staging: true, backgroundJobsEnabled: false, initializeSchema: false,
    });
  });

  it("never runs owner-only startup DDL under the Cloud SQL IAM runtime role", () => {
    expect(readRuntimeSafety(iamEnvironment)).toEqual({
      staging: false, backgroundJobsEnabled: true, initializeSchema: false,
    });
  });

  it.each(["", "1", "TRUE", "yes"])("fails closed for ambiguous staging flag %j", (value) => {
    expect(() => isMigrationStaging({ MIGRATION_STAGING: value })).toThrow();
  });

  it("uses explicit IAM settings rather than an inherited workspace URL", () => {
    expect(readDatabaseSettings({
      ...iamEnvironment, DATABASE_URL: fixtureUrl, MIGRATION_STAGING: "true",
    })).toEqual({
      mode: "cloud-sql-iam",
      instanceConnectionName: iamEnvironment.CLOUD_SQL_INSTANCE_CONNECTION_NAME,
      user: iamEnvironment.CLOUD_SQL_IAM_USER,
      database: "fixture", readOnly: true,
    });
  });

  it.each(["CLOUD_SQL_INSTANCE_CONNECTION_NAME", "CLOUD_SQL_IAM_USER", "CLOUD_SQL_DATABASE"] as const)(
    "refuses partial IAM config missing %s instead of falling back to DATABASE_URL",
    (key) => {
      const env: Record<string, string | undefined> = {
        ...iamEnvironment, DATABASE_URL: fixtureUrl, [key]: undefined,
      };
      expect(() => readDatabaseSettings(env)).toThrow("Cloud SQL IAM requires");
    },
  );

  it("rejects unsupported connection modes", () => {
    expect(() => readDatabaseSettings({
      DATABASE_CONNECTION_MODE: "typo", DATABASE_URL: fixtureUrl,
    })).toThrow("Unsupported DATABASE_CONNECTION_MODE");
  });

  it("requires an explicit staging decision before Cloud SQL can start", () => {
    expect(() => readDatabaseSettings({
      ...iamEnvironment, MIGRATION_STAGING: undefined,
    })).toThrow("explicit MIGRATION_STAGING");
  });

  it("rejects a service-account username with the untrimmed suffix", () => {
    expect(() => readDatabaseSettings({
      ...iamEnvironment, CLOUD_SQL_IAM_USER: "runtime@test-project.iam.gserviceaccount.com",
    })).toThrow("must omit");
  });

  it("pins URL connections to read-only even if a URL option tried to disable it", () => {
    const settings = readDatabaseSettings({
      DATABASE_URL: fixtureUrl + "?options=-c%20default_transaction_read_only%3Doff",
      MIGRATION_STAGING: "true",
    });
    expect(settings.mode).toBe("url");
    if (settings.mode !== "url") throw new Error("Unexpected fixture mode");
    expect(new URL(settings.connectionString).searchParams.get("options"))
      .toBe("-c default_transaction_read_only=on");
  });
});

describe("migration staging HTTP write gate", () => {
  function server(staging: boolean) {
    const app = express();
    app.use("/api", stagingWriteGuard(staging));
    app.use((_req, res) => { res.json({ handlerReached: true }); });
    return app;
  }

  it.each(["post", "put", "patch", "delete"] as const)(
    "blocks %s before business handlers", async (method) => {
      const response = await request(server(true))[method]("/api/subscriptions/fixture");
      expect(response.status).toBe(503);
      expect(response.body.code).toBe("STAGING_READ_ONLY");
      expect(response.body.handlerReached).toBeUndefined();
      expect(response.headers["cache-control"]).toBe("no-store");
    },
  );

  it("also blocks mutations to the Clerk proxy", async () => {
    const response = await request(server(true)).post("/api/__clerk/v1/client/sessions");
    expect(response.status).toBe(503);
  });

  it.each(["get", "head", "options"] as const)("allows %s reads/preflights", async (method) => {
    const response = await request(server(true))[method]("/api/healthz");
    expect(response.status).toBe(200);
  });

  it("does not block normal writes outside staging", async () => {
    const response = await request(server(false)).post("/api/stores");
    expect(response.status).toBe(200);
    expect(response.body.handlerReached).toBe(true);
  });
});

describe("authentication-pending staging", () => {
  function server() {
    const app = express();
    app.use("/api", stagingAuthenticationGuard({
      MIGRATION_STAGING: "true", MIGRATION_AUTH_PENDING: "true",
    }));
    app.use((_req, res) => { res.json({ handlerReached: true }); });
    return app;
  }
  it("allows infrastructure health without Clerk credentials", async () => {
    expect((await request(server()).get("/api/healthz")).body).toEqual({ status: "ok" });
  });
  it.each(["get", "post", "delete"] as const)("locks %s business access", async (method) => {
    const response = await request(server())[method]("/api/stores");
    expect(response.status).toBe(503);
    expect(response.body.code).toBe("STAGING_AUTH_PENDING");
    expect(response.body.handlerReached).toBeUndefined();
  });
  it("cannot disable authentication in production", () => {
    expect(() => stagingAuthenticationGuard({
      MIGRATION_STAGING: "false", MIGRATION_AUTH_PENDING: "true",
    })).toThrow("only in migration staging");
  });
  it("rejects an ambiguous pending-auth flag", () => {
    expect(() => stagingAuthenticationGuard({
      MIGRATION_STAGING: "true", MIGRATION_AUTH_PENDING: "yes",
    })).toThrow("must be true or false");
  });
});
