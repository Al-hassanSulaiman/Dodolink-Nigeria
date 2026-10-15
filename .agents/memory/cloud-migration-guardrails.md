---
name: Cloud migration guardrails
description: User requirements for staging the DodoLink Google Cloud migration and preserving the existing deployment.
---

The user authorized beginning a staged Google Cloud migration and selected `africa-south1` (Johannesburg). Keep the existing Replit deployment intact through validation and cutover; do not delete the existing service. Preserve the existing DodoLink domains and API paths where possible.

The user approved reusing the existing `wordpress-db` Cloud SQL instance for an isolated DodoLink database and application user, rather than creating a second database server. Do not replace the existing database.

**Why:** The user explicitly requested continuity on Replit while the Google Cloud target is validated.

**How to apply:** Establish a verified source-data baseline and validate the Google Cloud deployment before moving production traffic. Treat the existing Replit deployment as the rollback target, not infrastructure to remove during setup.

## Staging side effects

A staged API using a production database snapshot must not automatically run live billing, account-deletion retries, retention cleanups, or customer notifications.

**Why:** A production snapshot contains real customer identities and payment authorizations. An additional API instance can cause real external effects even when DNS and customer traffic still point at Replit.

**How to apply:** Explicitly disable background jobs before booting a staging API with copied production data and verify that startup respects this setting. Only enable the intended production jobs as part of a controlled cutover.
