# DodoLink Google Cloud migration

## Current cutover status

**Google Cloud staging is verified; the live domain has NOT been moved.**
The original `dodolink-domains` certificate is now ACTIVE with both root and
wildcard authorized. Both entries in `dodolink-domains-map` already reference it.
That map and `dodolink-production-https-map` are now attached to the existing
`dodolink-staging-https-proxy`; `dodolink-production-http-map` is attached to the
existing HTTP proxy. Root/www public DNS still points to Replit.

Trusted TLS against `8.232.160.236` now passes for root, www, and staging.
The customer page and `/admin/` return 200 with their expected HTML titles.
Health returns `{"status":"ok"}` and public store reads return valid JSON with
200. The www canonical redirect returns 301 and preserves path and query.
Staging health remains 200. These checks used DNS overrides: public root/www
DNS remains unchanged. Signed-in owner admin access is still not verified.

The next gate is the user's shutdown of the published Replit DodoLink runtime,
not the development workflows. Keep Google writes and maintenance disabled until
shutdown is confirmed and the final source/payment/media checks pass.

The additional `dodolink-domains-fresh` request and the working staging
certificates are retained. Do not create further replacements.
Native API and both social connections are enabled; full login, native-registration,
and Apple private-email-relay checks still remain. The exact iPhone archive audit was deferred
by the user and is not a hosting-cutover gate. Do not start a mobile build.

Completed:

- The combined web/admin/API image is deployed with immutable image references.
- `https://staging.dodolink.com.ng` serves customer/admin pages, store reads,
  health, and the Clerk proxy over trusted HTTPS.
- An attached-identity Cloud Run probe proved Cloud SQL writes and rollback,
  read-only rejection, and zero persisted test rows.
- The guarded `gcp-refresh-push-tokens.py --apply` refreshed the only changed
  table. All 14 table fingerprints matched the live source after verification.
  Source writes: zero. Recheck after freezing the source at actual cutover.
- All 139 media objects matched CRC32C/size/metadata. Source/destination path
  hashes also matched with zero missing or extra objects. Temporary upload
  objects and all temporary database-transfer buckets were removed.
- Attached-identity signed upload, signed download, and deletion succeeded.
- Runtime Paystack read-only authentication and Gmail SMTP authentication
  succeeded. No charge was initiated and no email was sent by these probes.
- Clerk's primary domain proxy is registered as
  `https://dodolink.com.ng/api/__clerk`. Staging sends that canonical proxy URL;
  a staging hostname cannot itself be registered as the primary domain's proxy.
- An official short-lived Clerk sign-in ticket verified a real session through
  the proxy: a fresh user's conversations were empty, another user's list was
  forbidden, admin access was forbidden, and business POSTs remained blocked.
  All synthetic accounts were removed; the personal directory remained empty.
- Normal browser password login reached Device Trust email verification.
  Completing that journey requires a mailbox; it was not bypassed globally.
- The user subsequently confirmed normal staging sign-up works and explicitly
  requested finishing the live migration. This confirms the user's sign-up
  journey, not every OAuth/native journey or signed-in admin access.
- The final targeted checks passed (62 TypeScript tests plus four delta safety
  tests), TypeScript compilation passed, and the local API workflow restarted.
- The user subsequently requested restoring the dedicated app-store reviewer.
  That real account now exists in personal production Clerk, with password
  authentication, the private review-only marker, and the per-user Device Trust
  exception confirmed by a fresh backend read. Do not remove it as a synthetic
  migration test user or expect the production directory to remain empty.
- A fresh native-client password sign-in through the staging Clerk proxy returned
  `complete`, with the first factor verified and no email-code challenge.
  Its authenticated conversation read returned 200, and admin analytics returned
  403. The test session was revoked. No global Device Trust setting, SQL data,
  payment, message, or live-domain routing was changed by this restoration.
  This verifies actual password/API access, not the installed iPhone build.

Live certificate prerequisite:

| Type | Name in the existing DNS zone | Target |
| --- | --- | --- |
| CNAME | `_acme-challenge_uu4uzxmmpxy6y2rt` | `97bf1f67-6311-4c8d-8542-82d072ad38b1.5.authorize.certificatemanager.goog.` |

Public DNS now returns the exact correct target in the table. Previously it returned
`97bf1f67-6311-4c8d-8542-82d072ad38b1.5.authorize.certificatemanager.goog.dodolink.com.ng.`
The DNS panel had appended the zone to the destination; the user corrected it.
Preserve the absolute destination's final dot and leave live root/www unchanged.
`dodolink-domains` is ACTIVE after Google's successful validation retry.
Its DNS authorization is `dodolink-root-auth`; the attached certificate map is
`dodolink-domains-map`.
It covers the root and wildcard, including `www` and staging.

Personal Clerk now reports Native API enabled and both `oauth_google` and
`oauth_apple` enabled. The user configured a replacement Google secret and
confirmed deleting the older exposed secret. Apple uses a separate Sign in with
Apple key, not the App Store Connect key. No credential values belong in source
or documentation. These configuration checks do not prove complete sign-in
round trips; confirm native iOS registration and Apple private-email-relay setup.
All target configuration belongs to the personal **production** instance, not
Replit's development Auth tenant.

The user completed CLI reauthentication; Google Cloud management access is restored.
Runtime flags remain read-only staging with auth-only mutation allowance and web
background jobs disabled. All three Scheduler timers were reverified PAUSED.
Fresh source comparison found no changed tables, and source media inventory is
unchanged at 139 objects. No source records were modified by these checks.
Root and www still resolve to the old `34.111.179.208` address.
Their TTL remains 3600 seconds. The user reports changing it to 300 automatically
reverts to 3600; plan the handoff for a one-hour cache window rather than requiring
a lower TTL. This does not prevent certificate issuance.
The latest source payment check found zero unconsumed subscription payment quotes.
Recheck after source shutdown; this is not permission to run target billing yet.

### Prepared background-job handoff

The web service always uses `BACKGROUND_JOBS_ENABLED=false`. Cloud SQL writable
mode now requires an explicit background-job decision; disabling the read-only
guard cannot silently start a second scheduler.

| Cloud Run job (Johannesburg) | Scheduler timer | UTC schedule |
| --- | --- | --- |
| `dodolink-maintenance-daily` | `dodolink-daily-timer` | `0 9 * * *` |
| `dodolink-maintenance-retention` | `dodolink-retention-timer` | `0 * * * *` |
| `dodolink-maintenance-deletions` | `dodolink-deletions-timer` | `* * * * *` |

All timers are **PAUSED** and every job also has
`MAINTENANCE_JOBS_ENABLED=false`. Do not run them before source-job shutdown.
Cloud Scheduler does not offer `africa-south1`; timer/control metadata is in
`europe-west1`. It invokes the Google Jobs API with OAuth and carries no
customer payload. Actual job execution, SQL, secrets, and media remain in
Johannesburg. The runtime identity has job-scoped invocation grants; no
service-account key files were created.

Jobs run the same compiled API with `MAINTENANCE_JOB_KIND` set to `daily`,
`retention`, or `deletions`, but never start HTTP or web timers. An explicit
maintenance enable gate, PostgreSQL advisory locks, the existing daily lock,
and per-store charge serialization protect the handoff and concurrent tasks.

### Remaining cutover sequence

1. Certificate issuance, production map attachment, and actual trusted
   root/www/staging TLS verification are complete.
2. Normal staging sign-up is confirmed by the user. Personal Clerk Native API,
   Google, and Apple connections are enabled; full native/OAuth testing remains
   unverified and no new native build was authorized.
3. Customer/admin page routing and public API reads on the new IP are verified.
   Verify the owner's signed-in admin access during the live smoke test; do not
   grant arbitrary accounts admin to substitute for that check.
4. Confirm the old Replit runtime/jobs are stopped and no charge is in flight.
   Refresh source fingerprints, run the guarded delta and media reconciliation
   again, and stop if any table other than `push_tokens` changed.
5. Enable target business writes with `MIGRATION_STAGING=false`,
   `MIGRATION_ALLOW_AUTH=false`, and `BACKGROUND_JOBS_ENABLED=false`. Verify the
   real root host against the new IP before changing live DNS/webhook routing.
6. Move root/www DNS only after readiness; preserve Clerk/mail/nameservers.
   The reserved target IPv4 remains `8.232.160.236`.
7. After confirming the single-active-host handoff, enable
   `MAINTENANCE_JOBS_ENABLED=true` on the three jobs and resume their timers.
   Keep web timers off. Never enable old and new billing against separate SQL
   copies simultaneously: per-database locks cannot protect that situation.
8. Retain Replit and its data for rollback. After Google accepts new writes,
   switching DNS alone is not a safe rollback: freeze and reconcile data/auth
   first. Do not delete the original application, database, or media.

## Safety boundaries

- Target project: `project-3a919f28-1462-4a1d-a2c`.
- Target region: `africa-south1` (Johannesburg).
- The user approved adding an isolated DodoLink database to `wordpress-db`.
- Do not replace the existing `postgres` database or change its users.
- Keep Replit, DNS, production API URLs, Clerk, and Paystack routing unchanged
  until the migrated application and data are verified.
- This setup is **not** a completed migration or a production cutover.

## Foundation

| Resource | Target |
| --- | --- |
| Cloud Run service | `dodolink`; public read-only staging through the HTTPS load balancer only |
| Cloud SQL instance | Existing `wordpress-db`, PostgreSQL 18 |
| New application database | `dodolink` |
| Backend identity | Existing `cloudrun-for-dodolink` service account |
| Media bucket | `gs://dodolink-media-729481009477-afs1` |

The media bucket uses uniform bucket-level access and enforced public-access
prevention. Application-level visibility and ownership remain in the existing
object custom metadata; a public application image does not require a public
bucket. Browser upload CORS is limited to the application and staging origins.
The existing `dodolink_buc` bucket is not modified.

Cloud SQL IAM authentication was already enabled. The application IAM identity
must receive database/schema grants before the API can connect successfully;
creating an IAM database user alone is insufficient. Do not grant the running
application `cloudsqlsuperuser`.

Secret Manager and IAM Credentials APIs are enabled. No runtime secret values
are committed here. Do not create service-account key files.

## Media inventory and copy

The migration helper runs within the API package, uses its existing Replit
storage client for the source, and the authenticated gcloud account for the
destination. Source bucket paths, access tokens, and customer filenames are
never logged.

```sh
# Read-only source inventory; the default is always a dry run.
pnpm exec tsx artifacts/api-server/scripts/gcp-copy-media.ts

# Copy without deleting source objects or overwriting different destination data.
pnpm exec tsx artifacts/api-server/scripts/gcp-copy-media.ts --apply
```

The helper copies private objects under `private/` and each configured public
search root under `public/0/`, `public/1/`, etc. It retains object ACL custom
metadata and content metadata, and verifies CRC32C and size. It can be rerun:
matching objects are skipped; differing destination bytes cause an explicit
failure instead of an overwrite. A snapshot copy is not a write freeze. A final
delta copy and deletion reconciliation are still required before cutover.

Before using any copy for cutover, confirm that the configured source paths
belong to the production application, not a separate development bucket.

## Database transfer

Use a production `pg_dump` export, not the workspace's development
`DATABASE_URL`. Replit's production and development datasets are different.
Read-only production inventory is available through the database tool, but that
does not expose production connection credentials to the migration process.

Obtain the production connection string from the production Database tool's
Settings and provide it only through the secure secrets flow as
`DODOLINK_SOURCE_PRODUCTION_DATABASE_URL`. Never paste it in chat, print it in
logs, commit it, or use it as a command-line argument.

Private dumps must use restricted file permissions under `generated-artifacts/`,
which is excluded from Git and Replit publishing. Never put a dump in the media
bucket's public application prefix. Restore into the isolated `dodolink`
database, without importing source ownership or role memberships.

`production-fingerprint.sql` returns only row counts and record hashes. Refresh
it against the managed production database through the read-only database tool
and save the JSON result to a private generated inventory file. The exporter
refuses a connection to a different dataset, unencrypted connections, unexpected
tables, or data that changes during the dump. Credentials are passed only through
the process environment, not command-line arguments.

```sh
python artifacts/api-server/scripts/gcp-export-production.py \
  --expected-inventory generated-artifacts/gcp-migration/expected-production.json
```

The resulting custom-format dump and verification manifest are private generated
files, not application assets. Only the application schema is exported; Replit's
internal migration schema, source role ownership, and source grants are excluded.

After restoring, verify schema, row counts, sequences, foreign keys, media
metadata, and application read/write behavior. Do not update source rows during
the migration.

### Isolated Cloud SQL restore

```sh
# Check the export checksum and manifest without any cloud writes.
python artifacts/api-server/scripts/gcp-restore-production.py \
  --dump generated-artifacts/gcp-migration/production-EXAMPLE.dump

# Restore a verified snapshot only into an empty dodolink public schema.
python artifacts/api-server/scripts/gcp-restore-production.py \
  --dump generated-artifacts/gcp-migration/production-EXAMPLE.dump --apply

# Offline safety tests: no real database or cloud calls.
python artifacts/api-server/scripts/test_gcp_restore_production.py
```

The restore uses a uniquely named private temporary Johannesburg bucket with
public access prevention, uniform access, soft delete disabled, and a one-day
fallback lifecycle. Only the Cloud SQL instance's service identity receives
bucket-scoped transfer access. It never uses the application media bucket.
The SQL transaction refuses a different database or an existing public table,
does not recreate the default public schema, and does not import source roles.

The application identity receives CONNECT, schema USAGE, table CRUD, and
sequence USAGE/SELECT permissions, not cloudsqlsuperuser or schema CREATE.
Restored tables remain owned by the import identity; application startup must
not run owner-only schema initialization against this database. Handle schema
changes separately from the runtime identity.

Verification compares all table record hashes/counts, sequence states, foreign
keys, and application privileges before removing the temporary transfer bucket.
Private local run state records the phase and transfer bucket for recovery. If
verification fails, inspect that state; do not overwrite or rerun an import into
the now-nonempty database. The application, sign-in, and mutation flows still
require staging validation before cutover.

The initial production snapshot has been restored and verified: 14 table
fingerprints, 10 sequence states, five validated foreign keys, and the runtime
identity's data privileges match. Its temporary transfer bucket was removed.
This is a snapshot, not a final synchronization or an application deployment.

A later read-only source fingerprint check found changes in `push_tokens`;
the other 13 table fingerprints still matched the restored baseline. Refresh
the source comparison again at cutover and synchronize the delta safely. Do
not treat the initial dump as a current production snapshot.

## Cloud SQL runtime and read-only staging

The API supports opt-in Cloud SQL automatic IAM authentication using the attached
Cloud Run service account. It does not need a database password, a service-account
key file, or the source production connection string.

Configure these non-secret runtime settings explicitly:

| Setting | Staging value |
| --- | --- |
| `DATABASE_CONNECTION_MODE` | `cloud-sql-iam` |
| `CLOUD_SQL_INSTANCE_CONNECTION_NAME` | `project-3a919f28-1462-4a1d-a2c:africa-south1:wordpress-db` |
| `CLOUD_SQL_IAM_USER` | `cloudrun-for-dodolink@project-3a919f28-1462-4a1d-a2c.iam` |
| `CLOUD_SQL_DATABASE` | `dodolink` |
| `MIGRATION_STAGING` | `true` |

IAM mode refuses incomplete configuration rather than falling back to an
inherited workspace `DATABASE_URL`. It requires an explicit staging flag.
Staging pins PostgreSQL sessions to read-only, blocks API mutations before the
Clerk proxy and route handlers, and never starts billing, deletion retries,
retention cleanup, or notification jobs. It skips startup schema changes and
checks that required restored tables exist. Normal Replit behavior is unchanged
when using the default URL connection mode without staging.

This is an initial **read-only** validation mode, not a claim of full live
checkout or mailbox-backed sign-in. `BACKGROUND_JOBS_ENABLED=false` now
separately controls web jobs. Only the Clerk proxy can receive a staging-write
exception through `MIGRATION_ALLOW_AUTH=true`; business mutations stay blocked.

The API keeps the connector as a direct runtime dependency as well as a database
library dependency: esbuild externalizes Google SDK imports into the API bundle,
so the final API package must resolve that SDK itself.

```sh
# Uses the logged-in gcloud identity to impersonate only the application account.
# Does not read DATABASE_URL or access the source database.
pnpm exec tsx artifacts/api-server/scripts/gcp-verify-runtime.mjs
```

The probe verifies the actual database identity, performs a UUID-only test write
that is always rolled back, checks no probe row persisted, and verifies that the
shared staging pool configuration rejects writes. It never commits or consumes a
sequence value. CLI tokens and raw SDK errors are never logged. The operator
needs permission to impersonate the application service account for this local
probe; Cloud Run's attached identity does not need a permanent operator grant.
Remove any temporary impersonation permission after checking.

The local impersonation probe did not pass and its temporary operator grant
was removed. The attached-identity Cloud Run job subsequently passed the
write/rollback and read-only tests with zero persisted probe rows. The backend
also verified schema, IAM reads, and copied media access.

### Actual backend deployment

The real API image is deployed to `dodolink` in Johannesburg, replacing the
Google placeholder. The service URL is
`https://dodolink-q4s65fjn7q-bq.a.run.app`. Direct external service access is
blocked by load-balancer-only ingress. Public staging, not live cutover, serves
the customer web build at `/` and the
admin build at `/admin/`, alongside the API.

`MIGRATION_AUTH_PENDING=true` is permitted only with `MIGRATION_STAGING=true`.
It allows infrastructure health checks but returns `503 STAGING_AUTH_PENDING`
for every business API route before Clerk or business handlers. The current
deployment sets it to `false` because the personal Clerk production keys have
been verified and bound through Secret Manager. `MIGRATION_STAGING=true`
remains in effect: all API writes and background jobs are disabled.

The user's personal keys are stored in the Johannesburg-replicated secrets
`dodolink-clerk-production-publishable-key` and
`dodolink-clerk-production-secret-key`, with secret-level accessor grants for
the application identity. Cloud Run binds these to `CLERK_PUBLISHABLE_KEY`
and `CLERK_SECRET_KEY`; the backend uses `CLERK_AUTH_MODE=external`.
No secret values are in source, CLI arguments, frontend assets, or the image.
The public frontend key is intentionally compiled into frontend assets.
No Clerk test keys, managed production secret keys, payment keys, source
database credentials, or service-account key files are included.

### Additional runtime credentials

The existing live `PAYSTACK_SECRET_KEY` and `GMAIL_APP_PASSWORD` have been copied
securely to Johannesburg-replicated Secret Manager secrets
`dodolink-paystack-secret-key` and `dodolink-gmail-app-password`. The runtime
identity has secret-specific accessor grants; Cloud Run uses pinned versions.
The credential-only revision `dodolink-00006-zrr` is ready, with
`MIGRATION_STAGING=true`. Subsequent staging activation changed service-level
ingress/invocation settings, not these credentials or the write lock.

```sh
# Offline safety checks. No cloud requests, charges, or emails.
python -m unittest discover -s artifacts/api-server/scripts \
  -p 'test_gcp_stage_runtime_secrets.py' -v

# Read-only validation; does not create secrets or change the service.
python artifacts/api-server/scripts/gcp-stage-runtime-secrets.py

# Idempotent credential staging; refuses conflicting existing credentials.
python artifacts/api-server/scripts/gcp-stage-runtime-secrets.py --apply
```

The helper verifies the existing live payment credential with a read-only
balance request without logging balances, headers, or credentials. It does
not initiate payments or send email. Credentials travel to Secret Manager on
stdin, never in CLI arguments. Source payment authorizations must not be used
for staging charges.

The deployed credential revision passed health and store reads (200),
anonymous admin rejection (401), and business-write rejection (503).
The initial blanket guard also rejected Clerk POSTs. The explicit auth-only
exception now permits real Clerk sessions without allowing business writes.
See the current-status section for the successful session/API authorization
checks and the separately blocked mailbox/device-verification journey.

Verified against the deployed service:

- Authorized `/api/healthz`: HTTP 200.
- Authorized `/api/stores`: HTTP 200 using the restored Cloud SQL dataset.
- Authorized `/` and `/admin/`: HTTP 200 with their respective JS/CSS assets;
  direct admin client-route navigation also serves the admin build.
- A request to `/api/admin/analytics` without a Clerk session: HTTP 401.
- A POST to `/api/stores`: HTTP 503 from the staging write guard.
- Unauthenticated `/api/healthz`: HTTP 403 at Cloud Run.
- Startup confirms Cloud SQL read-only enforcement and bucket media readability.
- Startup confirms billing, deletion, retention, and notification jobs disabled.

Cloud Run's invoker IAM check must be enabled explicitly. Removing `allUsers`
or passing `--no-allow-unauthenticated` is insufficient if the existing service
has `run.googleapis.com/invoker-iam-disabled=true`.

Build the API and generate its credential-free build context:

```sh
pnpm --filter @workspace/api-server run build
node artifacts/api-server/scripts/gcp-prepare-runtime.mjs
```

For the combined web/admin image, run the `gcp-web-build` validation command,
which invokes `gcp-build-frontends.mjs` using the personal production publishable
key without printing it. Then build the API and invoke
`gcp-prepare-runtime.mjs --with-frontends`. The image uses
`WEB_FRONTEND_DIR=/app/web`. The customer app uses same-origin API calls;
the admin bundle is built with `/admin/` as its base and
`VITE_CLERK_AUTH_MODE=external` to prevent host-derived instance selection.
Replit's existing development artifact routing and credentials are unchanged.

The context under ignored `generated-artifacts/gcp-runtime` includes only the
compiled backend, an exact-version runtime package manifest and lockfile, and
`infra/gcp/runtime.Dockerfile`. Public npm tarball URLs replace Replit-internal
registry URLs while preserving versions and integrity hashes. Cloud Build uses
`infra/gcp/cloudbuild-api.yaml` and the separate `dodolink-builder` identity;
its permissions are scoped to the build source/log bucket and image repository.
Use an immutable image digest when deploying a verified build.

The runtime identity has bucket-scoped object access plus bucket metadata/list
access for startup validation. No bucket is public.

### Browser authentication and existing accounts

The personal Clerk backend API authenticated successfully as a production
instance, and its JWKS matched `clerk.dodolink.com.ng`. Its user count was zero
when checked; the user explicitly accepted a fresh user directory and asked
not to recover the old Replit Clerk users. Old-user migration/recovery is
therefore out of scope. Do not claim that restored SQL/media includes Clerk
users or passwords, relink ownership automatically using email alone, or treat
the fresh-start instruction as permission to delete copied database records.

Clerk's frontend environment endpoint accepts origins on `dodolink.com.ng`,
`www.dodolink.com.ng`, and `staging.dodolink.com.ng`, but rejects the temporary
Cloud Run hostname with `origin_invalid`. Thus HTML/assets and read-only API
checks are verified, but browser sign-in and signed-in admin UI are not.
A staging HTTPS hostname under the owned root domain is needed without moving
the live root domain. Google Cloud's direct Cloud Run domain-mapping preview
does not support Johannesburg; choose and approve the HTTPS front door before
creating chargeable infrastructure or requesting DNS edits.

### Approved staging HTTPS front door

The user approved public staging HTTPS with the disclosed recurring Google
Cloud load-balancer charges. A global external managed Application Load
Balancer has been provisioned for **only** `staging.dodolink.com.ng`:

| Resource | Name |
| --- | --- |
| Reserved global IPv4 | `dodolink-staging-ip` — `8.232.160.236` |
| Johannesburg serverless NEG | `dodolink-staging-neg` → Cloud Run `dodolink` |
| Global backend service | `dodolink-staging-backend` |
| HTTPS host routing | `dodolink-staging-https-map` |
| HTTP-to-HTTPS redirect | `dodolink-staging-http-redirect` |
| Google-managed certificate | `dodolink-staging-cert` |
| TLS policy | `dodolink-staging-tls` — MODERN, minimum TLS 1.2 |
| HTTPS/HTTP frontend proxies | `dodolink-staging-https-proxy`, `dodolink-staging-http-proxy` |
| Global forwarding rules | `dodolink-staging-https` (443), `dodolink-staging-http` (80) |

The URL-map sources are `staging-https-url-map.yaml` and
`staging-http-url-map.yaml`. Only the staging host routes to the application;
other hosts redirect to the canonical staging HTTPS hostname.

**Staging DNS added:** the user successfully added the record at the external
DNS provider. Public DNS now resolves the staging name to the reserved IP, with
no staging AAAA record. Keep root, `www`, Clerk, email, and nameserver records
unchanged until cutover validation is complete:

| Type | Name | Value | TTL |
| --- | --- | --- | --- |
| A | `staging` | `8.232.160.236` | 300 seconds or provider default |

The Google resource graph was verified at creation. The HTTP edge returns
301 to the staging HTTPS host, preserving `/admin/`. The original certificate
`dodolink-staging-cert` is ACTIVE, and real trusted HTTPS now works.
Certificate issuance and serving at the edge were separate stages; the TLS
handshake initially failed after ACTIVE and subsequently succeeded.

Before activation, Google reported the domain as FAILED_NOT_VISIBLE. Both
authoritative nameservers, Google DNS, and Cloudflare DNS returned only the
reserved staging IP, with no conflicting IPv6 or CAA restriction. The target
proxy and port-443 forwarding configuration were correct. Following Google's
documented validation-refresh procedure, `dodolink-staging-cert-recheck` was
created and attached alongside the original certificate. The original is now
ACTIVE; the recheck certificate remains PROVISIONING. Do not create further
replacement certificates or load balancers while edge serving propagates.
Once HTTPS works, retain a working active certificate and remove an unnecessary
duplicate only after confirming proxy attachment and traffic.

The operator reauthenticated successfully after the workspace CLI lost its
account session. For later sessions, check `gcloud auth list` before cloud
operations; if necessary, sign in again in the project Shell with
`gcloud auth login --no-launch-browser`. Complete any verification-code entry
in the Shell, never in chat. Missing CLI authorization is not evidence that
the previously created cloud resources have disappeared.

After DNS, certificate activation, and a real trusted TLS request succeeded,
the approved public-staging access configuration was applied atomically:

```sh
gcloud run services update dodolink \
  --project project-3a919f28-1462-4a1d-a2c --region africa-south1 \
  --ingress=internal-and-cloud-load-balancing --no-invoker-iam-check --quiet
```

The ingress restriction must accompany disabling the invoker IAM check: expose
the application through the load balancer, not by opening the raw Cloud Run URL.
Keep `MIGRATION_STAGING=true`. Then verify real HTTP-to-HTTPS redirection, trusted
TLS, customer/admin assets, API health/read access, anonymous admin rejection,
POST rejection, and direct Cloud Run URL blocking. Perform the focused browser
sign-in pass only after staging is reachable. This approval does not authorize
production-domain cutover, account ownership reassignment, or background jobs.

Verified publicly at `https://staging.dodolink.com.ng` after activation:

- Customer `/`, admin `/admin/`, and admin deep route `/admin/leads`: 200.
- `/api/healthz` and `/api/stores`: 200 over trusted HTTPS.
- Anonymous `/api/admin/analytics`: 401.
- POST `/api/stores`: 503, preserving the migration write guard.
- Direct external Cloud Run service `/api/healthz`: 404 (ingress restricted).
- `MIGRATION_STAGING=true` still disables writes and all background jobs.

This is public **read-only staging**, not the live root/www cutover. Authentication
journeys, isolated write testing, the final data/media synchronization, and
single-active-host background-job handoff remain gates before production.

### Read-only iPhone build audit

Apple's API confirms the selected version `1.0` is WAITING_FOR_REVIEW with
build `19`, uploaded on 2026-10-12 (Apple's returned -07:00 timezone), with
processing state VALID. Expo Launch independently reports a successful iOS
session. No build or submission was started during this audit.

The personal Expo connector lists a different latest archive: build `18`.
Its downloaded IPA was inspected under ignored
`generated-artifacts/ios-verification/`: the signed executable and provisioning
profile both have `com.apple.developer.applesignin = ["Default"]`; the Hermes
bundle contains the native Apple-flow symbols and the screen's native-flow
message. The matching release source calls `startAppleAuthenticationFlow()`,
and that Apple handler exactly matches the current source.

This directly verifies the native correction in archive 18, not archive 19.
The personal Expo connector is not authorized to read the managed Launch
workflow, and Apple's API key was forbidden from reading build-bundle metadata.
The exact build-19 IPA would be needed for direct inspection of its JavaScript
and signed entitlements, but the user has deferred that audit. It does not hold
up hosting migration. Do not infer that build 19 lacks the correction or
recommend rebuilding merely because the personal connector does not list it.
A native sign-in journey also remains unverified: Native API is now enabled,
but the Apple social connection and iOS registration still need configuration.

Write-journey tests, new-account authorization, staging-domain verification,
and final data synchronization remain pending. Do not enable production jobs
to bypass the staging restrictions.

## Production authentication gate

Workspace Clerk development keys are normal in Replit; they are not evidence
that published sign-in is misconfigured. However, an external Google Cloud
deployment does not receive Replit's automatic production-key substitution.
The user has explicitly chosen their own personal Clerk account for the target.
Treat this as an authentication migration, not a key replacement: users, IDs,
passwords, and sessions must not be assumed to transfer between applications.
Preserve existing account data and verify store ownership, chat participation,
and admin access against the new authentication configuration before cutover.
Do not copy workspace test keys or reset existing accounts as a workaround.
Access to the source managed tenant is account-dependent; check it using the
Clerk skill instead of assuming the builder can open that dashboard.

## Original validation scope

- Refresh the confirmed production snapshot after the source freeze.
- The rolled-back write and signed upload/read/cleanup tests have passed.
- Verify new-account ownership and admin authorization with the personal Clerk
  instance. The user accepted starting with zero users; old-user migration is
  no longer required, and legacy records must not confer privileges on new users.
- Production runtime secrets are bound and read-only payment/SMTP auth passed.
- Session/API authorization checks passed on public staging; mailbox-backed
  password and real native/provider journeys still need account configuration.
- Copy and validate production media, including the final delta and deletions.
- Complete browser verification of the deployed web and admin paths.
- Validate sign-in, admin access, uploads, chat, notifications, and payments.
- Check native clients' baked domain and Clerk proxy URLs.
- Approve DNS/webhook cutover only after validation; retain Replit for rollback.
