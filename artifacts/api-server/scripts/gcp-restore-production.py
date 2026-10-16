"""Restore a verified snapshot into the isolated staging DB, never the source.

Uses the user's existing gcloud login, not database passwords or key files.
Temporary transfer data is private and is removed after successful verification.
"""
import argparse
import csv
import hashlib
import io
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import uuid

ROOT = Path(__file__).resolve().parents[3]
PROJECT = "project-3a919f28-1462-4a1d-a2c"
PROJECT_NUMBER = "729481009477"
INSTANCE = "wordpress-db"
DATABASE = "dodolink"
REGION = "africa-south1"
APP_ROLE = "cloudrun-for-dodolink@project-3a919f28-1462-4a1d-a2c.iam"


class RestoreError(Exception):
    pass


def command(arguments, phase):
    result = subprocess.run(
        arguments, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
        stderr=subprocess.PIPE, text=True, timeout=600, check=False,
    )
    if result.returncode:
        # CLI/SQL errors can contain customer data. Never log their raw text.
        category = "command_failed"
        for pattern, label in [
            ("permission", "permission_error"), ("already exists", "already_exists"),
            ("in progress", "operation_in_progress"), ("not found", "not_found"),
        ]:
            if pattern in result.stderr.lower():
                category = label
                break
        raise RestoreError(f"{phase}: {category}; raw errors were not logged.")
    return result.stdout


def cloud(arguments, phase):
    return command(["gcloud", *arguments, "--project", PROJECT, "--quiet"], phase)


def write_private(path, content):
    path.write_text(content)
    path.chmod(0o600)


def report(bucket, name, query, directory):
    cloud([
        "sql", "export", "csv", INSTANCE, f"{bucket}/{name}.csv",
        "--database", DATABASE, "--query", query, "--format=json",
    ], f"{name}_query")
    destination = directory / f"{name}.csv"
    cloud(["storage", "cp", f"{bucket}/{name}.csv", str(destination)], f"{name}_download")
    destination.chmod(0o600)
    rows = list(csv.reader(io.StringIO(destination.read_text())))
    if len(rows) != 1 or len(rows[0]) != 1:
        raise RestoreError("Unexpected verification report format.")
    return json.loads(rows[0][0])


def restore(dump, apply):
    os.umask(0o077)
    dump = dump.resolve()
    private_root = (ROOT / "generated-artifacts/gcp-migration").resolve()
    if dump.parent != private_root or not dump.is_file():
        raise RestoreError("Dump must be in the private migration directory.")
    manifest = json.loads(dump.with_suffix(".manifest.json").read_text())
    if (
        not manifest.get("source_read_only")
        or not manifest.get("source_ownership_and_acl_excluded")
        or len(manifest.get("tables", {})) != 14
        or hashlib.sha256(dump.read_bytes()).hexdigest() != manifest["dump_sha256"]
    ):
        raise RestoreError("The production export manifest or checksum does not match.")
    if not apply:
        print(json.dumps({"mode": "dry-run", "tables": 14, "cloud_writes": 0}))
        return

    instance = json.loads(cloud([
        "sql", "instances", "describe", INSTANCE, "--format=json",
    ], "target_identity_check"))
    if (
        instance.get("connectionName") != f"{PROJECT}:{REGION}:{INSTANCE}"
        or instance.get("region") != REGION
        or instance.get("state") != "RUNNABLE"
    ):
        raise RestoreError("The target instance identity or region does not match.")

    run_id = uuid.uuid4().hex[:12]
    directory = private_root / f"restore-{run_id}"
    directory.mkdir(mode=0o700)
    state_path = directory / "state.json"
    bucket = f"gs://dodolink-transfer-{PROJECT_NUMBER}-{run_id}"
    state = {"target_database": DATABASE, "transfer_bucket": bucket, "phase": "preparing"}

    def progress(phase):
        state["phase"] = phase
        write_private(state_path, json.dumps(state, indent=2) + "\n")
        print(json.dumps({"phase": phase}), flush=True)

    toc = command(["pg_restore", "--list", str(dump)], "dump_catalog")
    entries = [line for line in toc.splitlines() if line and not line.startswith(";")]
    foreign_keys = sum(" FK CONSTRAINT public " in line for line in entries)
    sequence_sets = sum(" SEQUENCE SET public " in line for line in entries)
    # The target already has its default public schema. Do not recreate it.
    filtered_toc = "\n".join(
        "; " + line if " SCHEMA - public " in line else line
        for line in toc.splitlines()
    ) + "\n"
    toc_path = directory / "restore.list"
    write_private(toc_path, filtered_toc)
    sql_path = directory / "restore.sql"
    command([
        "pg_restore", "--no-owner", "--no-privileges", "--use-list",
        str(toc_path), "--file", str(sql_path), str(dump),
    ], "prepare_restore_sql")
    sql_path.chmod(0o600)
    sql = sql_path.read_text()
    sequences = {
        name: {"last_value": int(value), "is_called": called == "true"}
        for name, value, called in re.findall(
            r"^SELECT pg_catalog\.setval\('public\.([a-z_][a-z0-9_]*)', (\d+), (true|false)\);$",
            sql, re.MULTILINE,
        )
    }
    if len(sequences) != sequence_sets:
        raise RestoreError("Sequence inventory could not be verified before restore.")

    prefix = r"""\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $guard$
BEGIN
  IF current_database() <> 'dodolink' THEN
    RAISE EXCEPTION 'Unexpected target database';
  END IF;
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public') THEN
    RAISE EXCEPTION 'Target schema is not empty; refusing an overwrite';
  END IF;
END
$guard$;
"""
    grants = f"""
GRANT CONNECT ON DATABASE dodolink TO "{APP_ROLE}";
GRANT USAGE ON SCHEMA public TO "{APP_ROLE}";
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "{APP_ROLE}";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "{APP_ROLE}";
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "{APP_ROLE}";
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO "{APP_ROLE}";
COMMIT;
"""
    write_private(sql_path, prefix + sql + grants)

    progress("creating_private_transfer_bucket")
    cloud([
        "storage", "buckets", "create", bucket, "--location", REGION,
        "--uniform-bucket-level-access", "--public-access-prevention",
        "--soft-delete-duration=0",
    ], "create_transfer_bucket")
    lifecycle_path = directory / "lifecycle.json"
    write_private(lifecycle_path, json.dumps({
        "rule": [{"action": {"type": "Delete"}, "condition": {"age": 1}}],
    }))
    cloud([
        "storage", "buckets", "update", bucket,
        "--lifecycle-file", str(lifecycle_path),
    ], "transfer_lifecycle")
    cloud([
        "storage", "buckets", "add-iam-policy-binding", bucket,
        "--member", "serviceAccount:" + instance["serviceAccountEmailAddress"],
        "--role", "roles/storage.objectAdmin",
    ], "transfer_bucket_access")

    progress("checking_empty_target")
    before = report(bucket, "before", f"""
SELECT json_build_object(
  'database', current_database(),
  'tables', (SELECT count(*) FROM pg_tables WHERE schemaname='public'),
  'app_role_exists', EXISTS(SELECT FROM pg_roles WHERE rolname='{APP_ROLE}'),
  'app_role_admin', coalesce((SELECT pg_has_role(oid, 'cloudsqlsuperuser', 'MEMBER')
                             FROM pg_roles WHERE rolname='{APP_ROLE}'), false)
)
""", directory)
    if (
        before.get("database") != DATABASE or before.get("tables") != 0
        or not before.get("app_role_exists") or before.get("app_role_admin")
    ):
        raise RestoreError("Target is not empty or the application identity needs review.")

    cloud(["storage", "cp", str(sql_path), f"{bucket}/restore.sql"], "upload_private_dump")
    progress("restoring_isolated_database")
    cloud([
        "sql", "import", "sql", INSTANCE, f"{bucket}/restore.sql",
        "--database", DATABASE, "--user", "postgres", "--format=json",
    ], "restore_target_database")

    progress("verifying_restored_database")
    fingerprint_sql = "\n".join(
        line for line in (ROOT / "infra/gcp/production-fingerprint.sql").read_text().splitlines()
        if not line.lstrip().startswith("--")
    ).rstrip().rstrip(";")
    sequence_query = " UNION ALL ".join(
        f"SELECT '{name}' AS name, last_value, is_called FROM public.{name}"
        for name in sorted(sequences)
    )
    sequence_json = (
        "(SELECT coalesce(jsonb_object_agg(name, jsonb_build_object("
        "'last_value',last_value,'is_called',is_called)), '{}'::jsonb) "
        f"FROM ({sequence_query}) s)"
    ) if sequences else "'{}'::jsonb"
    after = report(bucket, "verification", f"""
SELECT jsonb_build_object(
 'fingerprint', ({fingerprint_sql}),
 'sequences', {sequence_json},
 'foreign_keys', (SELECT count(*) FROM pg_constraint
                  WHERE connamespace='public'::regnamespace AND contype='f'),
 'unvalidated_foreign_keys', (SELECT count(*) FROM pg_constraint
                  WHERE connamespace='public'::regnamespace AND contype='f' AND NOT convalidated),
 'app_table_access', (SELECT bool_and(
      has_table_privilege('{APP_ROLE}', c.oid, 'SELECT')
  AND has_table_privilege('{APP_ROLE}', c.oid, 'INSERT')
  AND has_table_privilege('{APP_ROLE}', c.oid, 'UPDATE')
  AND has_table_privilege('{APP_ROLE}', c.oid, 'DELETE'))
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind IN ('r','p')),
 'app_sequence_access', (SELECT coalesce(bool_and(
      has_sequence_privilege('{APP_ROLE}', c.oid, 'USAGE')
  AND has_sequence_privilege('{APP_ROLE}', c.oid, 'SELECT')),true)
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind='S'),
 'app_database_access', has_database_privilege('{APP_ROLE}',current_database(),'CONNECT'),
 'app_schema_access', has_schema_privilege('{APP_ROLE}','public','USAGE')
)
""", directory)
    if (
        after.get("fingerprint") != manifest["tables"]
        or after.get("sequences") != sequences
        or after.get("foreign_keys") != foreign_keys
        or after.get("unvalidated_foreign_keys") != 0
        or not all(after.get(key) for key in [
            "app_table_access", "app_sequence_access",
            "app_database_access", "app_schema_access",
        ])
    ):
        raise RestoreError("Restored data or permissions did not match; no cutover is permitted.")

    progress("removing_temporary_transfer_bucket")
    cloud(["storage", "rm", "--recursive", bucket], "remove_transfer_bucket")
    state["verified_tables"] = len(manifest["tables"])
    state["verified_sequences"] = len(sequences)
    state["verified_foreign_keys"] = foreign_keys
    state["transfer_bucket_removed"] = True
    progress("verified")
    print(json.dumps({
        "status": "restored_and_verified", "tables": 14,
        "sequences": len(sequences), "foreign_keys": foreign_keys,
        "app_permissions_verified": True, "temporary_bucket_removed": True,
        "source_writes": 0, "traffic_changed": False,
    }))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dump", type=Path, required=True)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    try:
        restore(args.dump, args.apply)
    except RestoreError as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
    except Exception:
        print("Restore stopped safely. Review private run state; source and traffic were not changed.",
              file=sys.stderr)
        sys.exit(1)
