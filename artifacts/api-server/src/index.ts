import app from "./app";
import { logger } from "./lib/logger";
import { startScheduler } from "./lib/scheduler";
import { validatePaystackKey } from "./lib/paystack";
import { initializeAccountDeletion, retryAccountDeletions } from "./lib/accountDeletion";
import { initializePortfolioAnalytics, purgeOldPortfolioVisits } from "./lib/portfolioAnalytics";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { runtimeSafety } from "./lib/runtimeSafety";
import { objectStorageClient } from "./lib/objectStorage";

// Refuse to start a production deployment with a missing or test-mode
// Paystack key — real checkouts would silently be fake otherwise.
if (!runtimeSafety.staging) validatePaystackKey();

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

if (runtimeSafety.initializeSchema) {
  await initializeAccountDeletion();
  await initializePortfolioAnalytics();
} else {
  // Cloud SQL's runtime identity intentionally does not own the tables.
  // Read-only checks replace owner-only startup DDL; schema changes belong to
  // a controlled migration identity, not the web server.
  const requiredSchema = await db.execute(sql`
    SELECT name FROM unnest(ARRAY[
      'account_deletions', 'media_uploads', 'portfolio_client_links', 'portfolio_visits'
    ]) AS required(name)
    WHERE to_regclass('public.' || name) IS NULL
  `);
  if (requiredSchema.rows.length > 0) {
    throw new Error("Database startup schema is incomplete; apply controlled migrations before starting.");
  }
}
if (runtimeSafety.staging && process.env.DATABASE_CONNECTION_MODE === "cloud-sql-iam") {
  const readOnly = await db.execute(sql`SHOW default_transaction_read_only`);
  if (readOnly.rows[0]?.default_transaction_read_only !== "on") {
    throw new Error("Cloud SQL staging must enforce read-only sessions.");
  }
  const bucketName = process.env.GCP_STORAGE_BUCKET;
  if (!bucketName) throw new Error("GCP_STORAGE_BUCKET is required for Cloud SQL staging.");
  const bucket = objectStorageClient.bucket(bucketName);
  await bucket.getMetadata();
  const [files] = await bucket.getFiles({ prefix: "private/", maxResults: 1, autoPaginate: false });
  if (files.length === 0) throw new Error("Staging media copy is missing.");
  // Prove the attached runtime identity can read media bytes, not just list names.
  for await (const _chunk of files[0].createReadStream({ start: 0, end: 0, validation: false })) {
    // Do not log media names or contents.
  }
  logger.info({ databaseReadOnly: true, mediaReadable: true },
    "Google Cloud staging dependencies verified");
}
app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  if (!runtimeSafety.backgroundJobsEnabled) {
    logger.info("Read-only migration staging: billing, deletion, retention, and notification jobs are disabled");
    return;
  }
  startScheduler();
  setInterval(() => {
    void purgeOldPortfolioVisits().catch(err => logger.error({ err }, "Portfolio retention cleanup failed"));
  }, 3600_000).unref();
  void retryAccountDeletions();
  setInterval(() => { void retryAccountDeletions(); }, 60000).unref();
});
