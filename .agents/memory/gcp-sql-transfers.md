---
name: Google SQL transfer validation
description: Cloud SQL import/export restrictions that differ from ordinary PostgreSQL behavior.
---

Cloud SQL CSV exports must receive a static query beginning with SELECT, with leading SQL comments removed.

**Why:** A valid PostgreSQL inventory query failed Google's export validator solely because comments preceded SELECT.

**How to apply:** Normalize the trusted inventory query, require a single SELECT, and keep record output private. Do not strip or execute arbitrary caller-supplied SQL.

Controlled updates to the restored application tables must use the established PostgreSQL import owner explicitly, not Cloud SQL's default import worker.

**Why:** The initial restore selected postgres explicitly; omitting that selection later failed with table permission denial even though attached-runtime CRUD tests had passed.

**How to apply:** Preserve database/ownership guards, select the established import user, and verify full fingerprints before and after an atomic target-only transaction. Never expand runtime privileges to work around an import-worker mismatch.
