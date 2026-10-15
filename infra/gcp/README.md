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
| Cloud Run service | Existing `dodolink`; still running Google's placeholder |
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

## Production authentication gate

Workspace Clerk development keys are normal in Replit; they are not evidence
that published sign-in is misconfigured. However, an external Google Cloud
deployment does not receive Replit's automatic production-key substitution.
The existing production Clerk configuration must be obtained through a supported
access path before authenticated staging can be validated. Do not copy workspace
test keys, provision a replacement tenant, or change existing user identities as
a workaround. Dashboard access is account-dependent; check it using the Clerk
skill instead of assuming the builder can open the dashboard.

## Still required before cutover

- Refresh the confirmed production snapshot and reconcile any final changes.
- Validate an actual runtime IAM connection and rolled-back read/write test;
  the SQL grants and restored snapshot alone do not prove application behavior.
- Resolve supported access to the existing production Clerk configuration.
- Securely populate and bind production runtime secrets.
- Prepare the actual API image and prevent staging from running production
  billing, deletion, retention, or notification jobs.
- Copy and validate production media, including the final delta and deletions.
- Stage the web application and admin paths alongside the API.
- Validate sign-in, admin access, uploads, chat, notifications, and payments.
- Check native clients' baked domain and Clerk proxy URLs.
- Approve DNS/webhook cutover only after validation; retain Replit for rollback.
