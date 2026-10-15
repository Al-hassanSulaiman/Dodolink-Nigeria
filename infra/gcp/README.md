# DodoLink Google Cloud migration

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
| Cloud Run service | `dodolink`; actual backend deployed as private read-only staging |
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

This is an initial **read-only** validation mode, not full sign-in/payment/upload
journey validation. Do not set `MIGRATION_STAGING=false` just to test writes
against a production snapshot: that also enables production background jobs.
Writable journey tests require a separately reviewed test-data/payment setup.

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

The local impersonation probe has **not passed**; the temporary operator grant
was removed. However, the deployed Cloud Run backend has now independently
verified its attached IAM identity can connect to the restored database,
check required tables, enforce read-only sessions, and read copied media bytes.
The rolled-back write test remains outstanding.

### Actual backend deployment

The real API image is deployed to `dodolink` in Johannesburg, replacing the
Google placeholder. The service URL is
`https://dodolink-q4s65fjn7q-bq.a.run.app`. This is IAM-private staging,
not a production cutover. The customer web build is now served at `/` and the
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

**Waiting on external DNS:** authoritative nameservers are outside Google
Cloud. The staging name currently returns NXDOMAIN and its managed certificate
is PROVISIONING. There was no conflicting staging A, AAAA, or CNAME record and
no root CAA restriction at the setup check. Add this record in the existing DNS
provider without changing root, `www`, Clerk, email, or nameserver records:

| Type | Name | Value | TTL |
| --- | --- | --- | --- |
| A | `staging` | `8.232.160.236` | 300 seconds or provider default |

The Google resource graph is verified, but the initial live HTTP edge probe
returned an empty reply while the new frontend was provisioning. Do not claim
HTTP redirect, certificate readiness, browser sign-in, or the staging site
verified before the DNS/certificate and edge checks succeed.

Cloud Run deliberately remains IAM-private while DNS and certificate activation
are pending. After the staging DNS points to the reserved IP and the certificate
is ACTIVE, complete the approved public-staging access configuration atomically:

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

## Still required before cutover

- Refresh the confirmed production snapshot and reconcile any final changes.
- Complete the rolled-back write test; the deployed runtime IAM read connection
  and read-only enforcement are verified, but write behavior is not yet tested.
- Verify new-account ownership and admin authorization with the personal Clerk
  instance. The user accepted starting with zero users; old-user migration is
  no longer required, and legacy records must not confer privileges on new users.
- Securely populate and bind production runtime secrets.
- Validate authenticated application behavior through an approved staging
  hostname. The combined web/admin/API image is deployed privately with jobs
  and writes disabled.
- Copy and validate production media, including the final delta and deletions.
- Complete browser verification of the deployed web and admin paths.
- Validate sign-in, admin access, uploads, chat, notifications, and payments.
- Check native clients' baked domain and Clerk proxy URLs.
- Approve DNS/webhook cutover only after validation; retain Replit for rollback.
