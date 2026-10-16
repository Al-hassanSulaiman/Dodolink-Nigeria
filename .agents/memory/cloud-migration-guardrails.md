---
name: Cloud migration guardrails
description: User requirements for staging the DodoLink Google Cloud migration and preserving the existing deployment.
---

The user authorized beginning a staged Google Cloud migration and selected `africa-south1` (Johannesburg). Keep the existing Replit deployment intact through validation and cutover; do not delete the existing service. Preserve the existing DodoLink domains and API paths where possible.

The user approved reusing the existing `wordpress-db` Cloud SQL instance for an isolated DodoLink database and application user, rather than creating a second database server. Do not replace the existing database.

**Why:** The user explicitly requested continuity on Replit while the Google Cloud target is validated.

**How to apply:** Establish a verified source-data baseline and validate the Google Cloud deployment before moving production traffic. Treat the existing Replit deployment as the rollback target, not infrastructure to remove during setup.

## Staging side effects

Use absolute CNAME destinations, including the final dot, in this domain's DNS panel.

**Why:** The panel appended the DodoLink zone to Google's certificate-authorization destination, leaving an existing record with the wrong target. Testing only for the expected answer made this look like a missing record.

**How to apply:** Compare the actual returned CNAME target with Google's exact expected FQDN, not just the presence of an answer. Correct only the affected record; preserve live, Clerk, mail, and nameserver records until approved cutover.

A staged API using a production database snapshot must not automatically run live billing, account-deletion retries, retention cleanups, or customer notifications.

**Why:** A production snapshot contains real customer identities and payment authorizations. An additional API instance can cause real external effects even when DNS and customer traffic still point at Replit.

**How to apply:** Explicitly disable background jobs before booting a staging API with copied production data and verify that startup respects this setting. Only enable the intended production jobs as part of a controlled cutover.

## Authentication continuity

The user explicitly requested: "I want to use my own personal clerk pls." The target is user-owned Clerk rather than Replit-managed Clerk. Do not deploy workspace test keys or switch live authentication as a shortcut.

**Why:** The user chose personal ownership of Clerk. Different Clerk applications and environments have separate users; an unplanned replacement would disconnect existing account IDs from store ownership, conversations, and native clients.

**How to apply:** Prepare the user's own Clerk application in staging while preserving deployment continuity. Do not assume users, IDs, passwords, or sessions transfer automatically. Verify that new accounts cannot inherit old ownership or admin access. The later fresh-start instruction below supersedes the original account-migration requirement; it does not authorize deleting existing database records. Normal workspace test keys are not a bug in the published app.

The user reports deleting the original Replit-managed Clerk application and obtaining their own production setup for the existing DodoLink domain.

**Why:** The user explicitly confirmed deletion, not just disconnecting the integration. SQL and media backups cannot restore the old Clerk directory or password credentials.

**How to apply:** Do not assume the old tenant is still accessible or that managed-status metadata proves it exists. Use the user's personal production credentials for the target. Never claim that existing users retain store, chat, or admin access, and never assign ownership merely from a matching email.

The user explicitly said: "Let the users be zero, forget about the users in replit clerk." Start with the new personal Clerk user directory; do not pursue migration or recovery of old Clerk users.

**Why:** The user changed the account-migration scope and accepted starting from zero users.

**How to apply:** Treat old-user recovery/relinking as out of scope unless requested again. This is an authentication-directory fresh start, not permission to erase the copied SQL records, stores, chats, or media. New registrations must not automatically inherit legacy ownership or privileges.

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

## Personal Clerk staging hostname

Use a staging hostname under the owned DodoLink domain for browser validation of personal production Clerk, rather than substituting development credentials.

**Why:** The personal production instance rejected the temporary Cloud Run origin with `origin_invalid`, while accepting the existing root, `www`, and `staging` subdomains. Successful backend-key and JWKS checks alone do not prove browser sign-in.

**How to apply:** Preserve the live root-domain routing while preparing staging HTTPS/DNS. Obtain approval before creating a chargeable HTTPS front door. Do not claim signed-in customer or admin verification until the browser can use an accepted origin.

The user approved setting up public staging HTTPS for `staging.dodolink.com.ng`, with recurring Google Cloud load-balancer charges disclosed.

**Why:** The user selected “Set up staging HTTPS” after those consequences were explained.

**How to apply:** The approval covers the staging HTTPS front door and its public access, while writes and background jobs remain disabled. It does not authorize moving the live root/www domains, transferring account ownership, or enabling production jobs. Restrict Cloud Run ingress to internal/load-balancer traffic when enabling public staging invocation, so the raw service URL cannot bypass the intended front door.

The user subsequently confirmed normal sign-up on staging works and explicitly requested completing the production migration.

**Why:** The user said they tried staging sign-up successfully and asked to get the migration done.

**How to apply:** This supersedes the earlier staging-only approval. Proceed with cutover when trusted TLS, final data synchronization, and confirmed source-job shutdown are satisfied. Retain Replit for rollback; the approval does not permit duplicate billing, automatic legacy ownership transfers, or a new native build.

The user reports that setting the live DNS TTL to 300 automatically reverts to 3600.

**Why:** The user attempted the requested reduction and reported the DNS panel's behavior.

**How to apply:** Plan for a one-hour DNS cache window; do not keep asking for a lower TTL or treat that reduction as a certificate or cutover prerequisite.

Check both managed-certificate domain status and actual trusted TLS serving, not only the overall certificate status.

**Why:** Overall PROVISIONING concealed FAILED_NOT_VISIBLE for the domain; later ACTIVE preceded successful TLS at the load-balancer edge. Correct authoritative DNS alone did not mean the edge certificate was immediately usable.

**How to apply:** Verify authoritative A/AAAA consistency, certificate/proxy attachment, and port 443. After issuance, wait for a real trusted HTTPS request to succeed before opening staging invocation with load-balancer-only ingress. Do not repeatedly recreate certificates or load balancers to bypass propagation.

Treat writable traffic and background-job ownership as separate cutover decisions.

**Why:** Old and new hosts use separate SQL copies, so per-database charge locks cannot serialize across both hosts. Web containers may also scale to zero or multiple instances, making in-process timers unreliable.

**How to apply:** Keep web timers off on Cloud Run, use separate scheduled execution, and require confirmed source-job shutdown before enabling target schedules. Timer/control metadata may use a supported location while all job execution and customer data remain in Johannesburg.

Retaining the source is not enough for an instant writable rollback.

**Why:** New SQL writes and the user's fresh personal Clerk directory are not replicated back into the retained source.

**How to apply:** After target writes begin, freeze and reconcile data/auth before a DNS rollback. Never resume both sides' billing against divergent copies.

## Operator cloud credentials

Do not assume the authenticated gcloud operator session persists between workspace sessions.

**Why:** Infrastructure creation succeeded with an active account, but a later session had no credentialed accounts while the public DNS and load-balancer redirect still proved those resources existed.

**How to apply:** Check `gcloud auth list` before interpreting resource-discovery errors. Reauthenticate through the operator's Shell when needed; do not recreate infrastructure or treat unauthenticated CLI failures as missing cloud resources. Never request verification codes in chat.

Treat workload database access and operator service-account impersonation as separate checks. Do not keep adding temporary impersonation grants or broaden roles to bypass a failed local probe.

**Why:** The deployed workload successfully used its attached identity, but operator token minting remained denied even after a temporary token-creator binding and a bounded propagation wait. The temporary bindings were removed.

**How to apply:** Prefer an isolated check running under the attached workload identity for further database write/rollback validation. Do not declare the write check passed based on successful read-only startup, and do not create service-account key files as a shortcut.
