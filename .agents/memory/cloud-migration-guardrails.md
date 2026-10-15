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

The user reports deleting the original Replit-managed Clerk application and obtaining their own production setup for the existing DodoLink domain.

**Why:** The user explicitly confirmed deletion, not just disconnecting the integration. SQL and media backups cannot restore the old Clerk directory or password credentials.

**How to apply:** Do not assume the old tenant is still accessible or that managed-status metadata proves it exists. Use the user's personal production credentials for the target. Investigate recovery/export availability and verified identity relinking before claiming existing users retain store, chat, or admin access; never assign ownership merely from a matching email.

Treat live authentication-domain reassignment or deletion of the managed Clerk tenant as a separate, explicitly approved cutover—not a personal-account setup step.

**Why:** The SQL and media snapshots do not back up Clerk's user directory or password credentials and cannot restore a deleted authentication tenant.

**How to apply:** Inspect the exact deletion/domain-conflict warning before proceeding. Prepare the new setup without claiming the live hostname; do not confirm tenant deletion merely to free its domain. Clerk's production-instance screen can report a Replit reservation of the root domain, so do not assume another subdomain under the same root or a publishing/DNS change will clear it. Obtain the supported release process before changing the existing association. Development-instance preparation is test-only and does not transfer existing production users.

The user rescinded the earlier wait instruction and explicitly said to continue the migration. Continue independent, safe migration work while the personal Clerk production-domain reservation remains unresolved.

**Why:** The user said, "sorry I said you should wait, continue your migration."

**How to apply:** Do not treat the old pause as current. This does not authorize deleting the original app, detaching a domain on which existing clients depend, switching live authentication, or substituting development credentials for the requested production authentication setup.

## Backend before Clerk corrections

The user wants the backend on Cloud Run, the database in Cloud SQL, and media in the agreed Cloud Storage bucket before making the Clerk corrections.

**Why:** The user explicitly requested this order. Unresolved personal Clerk setup must not block independent, restricted backend staging.

**How to apply:** Deploy and validate the backend with the Google Cloud database and bucket in read-only staging, with production background jobs disabled. Leave live authentication, DNS, and the Replit deployment unchanged; do not describe staging as a production cutover.

The migration scope includes the DodoLink customer web app and admin dashboard, not just its API, database, and media.

**Why:** The user explicitly asked that both "my app and the admin" be on Google Cloud.

**How to apply:** Track frontend and admin deployment as part of the existing migration, not optional follow-up features. Native apps remain distributed through mobile stores and need backend/auth continuity checks.

## Existing Cloud Run access settings

Do not infer a service is private merely because it has no `allUsers` IAM binding or deployment used `--no-allow-unauthenticated`. Existing services can independently disable the invoker IAM check.

**Why:** An existing placeholder service retained its disabled invoker check during backend deployment; an unauthenticated request still returned 200 despite an empty invocation policy.

**How to apply:** Explicitly enable the invoker IAM check for private staging and verify the unauthenticated response separately from authenticated health. Keep the application-level staging lock as defense in depth.
