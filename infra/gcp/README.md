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

## Still required before cutover

- Export and restore the confirmed production database.
- Grant the backend IAM database identity only the required database/schema
  privileges.
- Securely populate and bind production runtime secrets.
- Prepare the actual API image and prevent staging from running production
  billing, deletion, retention, or notification jobs.
- Copy and validate production media, including the final delta and deletions.
- Stage the web application and admin paths alongside the API.
- Validate sign-in, admin access, uploads, chat, notifications, and payments.
- Check native clients' baked domain and Clerk proxy URLs.
- Approve DNS/webhook cutover only after validation; retain Replit for rollback.
