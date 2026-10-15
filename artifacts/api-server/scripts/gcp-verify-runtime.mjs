// Run with pnpm exec tsx so the shared TypeScript configuration is reused.
// Only the isolated Google Cloud database is reachable through this probe.
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { Connector, AuthTypes, IpAddressTypes } from "@google-cloud/cloud-sql-connector";
import { createPoolOptions, readDatabaseSettings } from "@workspace/db/connection-config";

const PROJECT = "project-3a919f28-1462-4a1d-a2c";
const ROLE = `cloudrun-for-dodolink@${PROJECT}.iam`;
const ACCOUNT = `${ROLE}.gserviceaccount.com`;
const require = createRequire(import.meta.url);
const sdkRequire = createRequire(require.resolve("@google-cloud/cloud-sql-connector"));
// Use the connector's own auth-library version, not a different SDK's copy.
const { OAuth2Client } = sdkRequire("google-auth-library");
const databaseRequire = createRequire(new URL("../../../lib/db/package.json", import.meta.url));
const { Pool } = databaseRequire("pg");
let phase = "runtime_identity_token";
let connector;
const pools = [];

// Never let an SDK's raw error dump tokens, request headers, or customer data.
process.on("unhandledRejection", () => {
  process.stderr.write(JSON.stringify({ status: "blocked", phase, reason: "sdk_rejection_redacted" }) + "\n");
  process.exitCode = 1;
});

async function verify() {
  const token = execFileSync("gcloud", [
    "auth", "print-access-token", "--project", PROJECT,
    "--impersonate-service-account", ACCOUNT,
    "--scopes=https://www.googleapis.com/auth/cloud-platform,https://www.googleapis.com/auth/sqlservice.login",
    "--quiet",
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 }).trim();
  const auth = new OAuth2Client();
  auth.setCredentials({ access_token: token, expiry_date: Date.now() + 45 * 60_000 });
  connector = new Connector({ auth });
  phase = "iam_connection";
  const environment = {
    DATABASE_CONNECTION_MODE: "cloud-sql-iam",
    CLOUD_SQL_INSTANCE_CONNECTION_NAME: `${PROJECT}:africa-south1:wordpress-db`,
    CLOUD_SQL_IAM_USER: ROLE,
    CLOUD_SQL_DATABASE: "dodolink",
    MIGRATION_STAGING: "false",
  };
  const connect = (settings) => connector.getOptions({
    instanceConnectionName: settings.instanceConnectionName,
    authType: AuthTypes.IAM, ipType: IpAddressTypes.PUBLIC,
  });
  const options = await createPoolOptions(readDatabaseSettings(environment), connect);
  const pool = new Pool({ ...options, max: 1, query_timeout: 20_000 });
  pools.push(pool);
  const client = await pool.connect();
  const probeId = randomUUID();
  try {
    const { rows } = await client.query(
      "SELECT current_database() = 'dodolink' AS database_matches, current_user = $1 AS identity_matches",
      [ROLE],
    );
    if (rows[0]?.database_matches !== true || rows[0]?.identity_matches !== true) {
      throw new Error("Target identity mismatch");
    }
    phase = "rolled_back_write";
    await client.query("BEGIN");
    try {
      await client.query(
        "INSERT INTO public.portfolio_client_links (id, label) VALUES ($1, $2)",
        [probeId, "__migration_rollback_probe__"],
      );
      const written = await client.query(
        "SELECT id FROM public.portfolio_client_links WHERE id = $1", [probeId],
      );
      if (written.rowCount !== 1) throw new Error("Write was not visible inside its transaction");
    } finally {
      // No COMMIT path exists. Explicit UUIDs also avoid consuming a sequence.
      await client.query("ROLLBACK");
    }
    const remaining = await client.query(
      "SELECT count(*)::int AS remaining FROM public.portfolio_client_links WHERE id = $1", [probeId],
    );
    if (remaining.rows[0]?.remaining !== 0) throw new Error("Probe row was not rolled back");
  } finally {
    client.release();
  }

  phase = "staging_read_only";
  const stagingOptions = await createPoolOptions(
    readDatabaseSettings({ ...environment, MIGRATION_STAGING: "true" }), connect,
  );
  const stagingPool = new Pool({ ...stagingOptions, max: 1, query_timeout: 20_000 });
  pools.push(stagingPool);
  const stagingClient = await stagingPool.connect();
  try {
    const setting = await stagingClient.query("SHOW default_transaction_read_only");
    if (setting.rows[0]?.default_transaction_read_only !== "on") throw new Error("Read-only mode missing");
    await stagingClient.query("BEGIN");
    let denied = false;
    try {
      await stagingClient.query(
        "INSERT INTO public.portfolio_client_links (id, label) VALUES ($1, $2)",
        [probeId, "__migration_readonly_probe__"],
      );
    } catch (error) {
      if (error.code !== "25006") throw error;
      denied = true;
    } finally {
      await stagingClient.query("ROLLBACK");
    }
    if (!denied) throw new Error("Staging unexpectedly accepted a write");
  } finally {
    stagingClient.release();
  }
  process.stdout.write(JSON.stringify({
    status: "verified", runtime_iam_identity: true, rolled_back_write: true,
    staging_rejects_writes: true, persisted_probe_rows: 0, source_accessed: false,
  }) + "\n");
}

try {
  await verify();
} catch (error) {
  const detail = String(error?.stderr ?? "").toLowerCase();
  const reasons = [
    ["iam.serviceaccounts.getaccesstoken", "impersonation_permission_missing"],
    ["invalid oauth scope", "invalid_token_scope"],
    ["invalid_scope", "invalid_token_scope"],
    ["reauthentication", "cloud_login_refresh_required"],
    ["unrecognized arguments", "unsupported_cli_argument"],
    ["permission_denied", "cloud_permission_denied"],
  ];
  const reason = reasons.find(([match]) => detail.includes(match))?.[1] ?? "details_redacted";
  process.stderr.write(JSON.stringify({
    status: "blocked", phase, reason,
  }) + "\n");
  process.exitCode = 1;
} finally {
  for (const pool of pools) await pool.end();
  connector?.close();
}
