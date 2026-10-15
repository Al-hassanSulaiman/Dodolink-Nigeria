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

## Authentication continuity

The user explicitly requested: "I want to use my own personal clerk pls." The target is user-owned Clerk rather than Replit-managed Clerk. Do not deploy workspace test keys or switch live authentication as a shortcut.

**Why:** The user chose personal ownership of Clerk. Different Clerk applications and environments have separate users; an unplanned replacement would disconnect existing account IDs from store ownership, conversations, and native clients.

**How to apply:** Prepare the user's own Clerk application in staging while retaining current live authentication. Do not assume users, IDs, passwords, or sessions transfer automatically. Validate account migration and ownership/admin/chat access before switching live authentication; the request does not authorize deleting existing account data. Normal workspace test keys are not a bug in the published app.

Treat live authentication-domain reassignment or deletion of the managed Clerk tenant as a separate, explicitly approved cutover—not a personal-account setup step.

**Why:** The SQL and media snapshots do not back up Clerk's user directory or password credentials and cannot restore a deleted authentication tenant.

**How to apply:** Inspect the exact deletion/domain-conflict warning before proceeding. Prepare the new setup without claiming the live hostname; do not confirm tenant deletion merely to free its domain. Clerk's production-instance screen can report a Replit reservation of the root domain, so do not assume another subdomain under the same root or a publishing/DNS change will clear it. Obtain the supported release process before changing the existing association. Development-instance preparation is test-only and does not transfer existing production users.
