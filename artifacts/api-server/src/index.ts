import app from "./app";
import { logger } from "./lib/logger";
import { startScheduler } from "./lib/scheduler";
import { validatePaystackKey } from "./lib/paystack";
import { initializeAccountDeletion, retryAccountDeletions } from "./lib/accountDeletion";
import { initializePortfolioAnalytics, purgeOldPortfolioVisits } from "./lib/portfolioAnalytics";

// Refuse to start a production deployment with a missing or test-mode
// Paystack key — real checkouts would silently be fake otherwise.
validatePaystackKey();

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

await initializeAccountDeletion();
await initializePortfolioAnalytics();
app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  startScheduler();
  setInterval(() => {
    void purgeOldPortfolioVisits().catch(err => logger.error({ err }, "Portfolio retention cleanup failed"));
  }, 3600_000).unref();
  void retryAccountDeletions();
  setInterval(() => { void retryAccountDeletions(); }, 60000).unref();
});
