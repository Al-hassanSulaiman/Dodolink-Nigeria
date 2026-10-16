"""Guarded final delta for the only changed source table; never mutates Replit."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import uuid

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
STATE = ROOT / "generated-artifacts/gcp-migration"
PROJECT = "project-3a919f28-1462-4a1d-a2c"
INSTANCE = "wordpress-db"
DATABASE = "dodolink"
PHASE = "source_inventory"


def load_helper(name):
    spec = importlib.util.spec_from_file_location(name.replace("-", "_"), HERE / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def sql_literal(value):
    return "'" + json.dumps(value, separators=(",", ":")).replace("'", "''") + "'::jsonb"

def export_query(sql):
    # Cloud SQL's CSV export validator rejects leading SQL comments even though
    # PostgreSQL accepts them. Only send this static single SELECT statement.
    query = "\n".join(line for line in sql.splitlines() if not line.lstrip().startswith("--")).strip().rstrip(";")
    if not query.upper().startswith("SELECT ") or ";" in query:
        raise ValueError("The inventory export must be a single SELECT.")
    return query


def build_refresh_sql(baseline, fresh, rows, sequence, fingerprint_sql):
    if set(baseline) != set(fresh) or {
        name for name in fresh if fresh[name] != baseline[name]
    } - {"push_tokens"}:
        raise ValueError("Only the reviewed push_tokens delta can be synchronized.")
    if not isinstance(rows, list) or type(sequence["last_value"]) is not int or sequence["last_value"] < 1:
        raise ValueError("Invalid source data or sequence state.")
    if type(sequence["is_called"]) is not bool:
        raise ValueError("Invalid source sequence flag.")
    fingerprint_sql = export_query(fingerprint_sql)
    return f"""
\\set ON_ERROR_STOP on
BEGIN;
SET LOCAL standard_conforming_strings = on;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
LOCK TABLE public.push_tokens IN ACCESS EXCLUSIVE MODE;
DO $guard$
BEGIN
 IF current_database() <> 'dodolink' THEN
  RAISE EXCEPTION 'Unexpected database; refusing refresh';
 END IF;
 IF ({fingerprint_sql}) IS DISTINCT FROM {sql_literal(baseline)} THEN
  RAISE EXCEPTION 'Target changed since verification; refusing refresh';
 END IF;
END $guard$;
DELETE FROM public.push_tokens;
INSERT INTO public.push_tokens
 SELECT * FROM jsonb_populate_recordset(NULL::public.push_tokens, {sql_literal(rows)});
SELECT pg_catalog.setval('public.push_tokens_id_seq',
 GREATEST((SELECT last_value FROM public.push_tokens_id_seq), {sequence["last_value"]}),
 {str(sequence["is_called"]).lower()});
DO $guard$
BEGIN
 IF ({fingerprint_sql}) IS DISTINCT FROM {sql_literal(fresh)} THEN
  RAISE EXCEPTION 'Post-refresh verification failed';
 END IF;
END $guard$;
COMMIT;
"""


def main(apply):
    global PHASE
    source = load_helper("gcp-export-production")
    target = load_helper("gcp-restore-production")
    env = source.source_environment(os.environ[source.SECRET_KEY])
    fresh = source.fingerprint(env)
    current_path = STATE / "verified-cloud-inventory.json"
    baseline_path = current_path if current_path.exists() else STATE / "expected-production.json"
    baseline = json.loads(baseline_path.read_text())
    changed = sorted(name for name in fresh if fresh[name] != baseline.get(name))
    if set(fresh) != set(baseline) or set(changed) - {"push_tokens"}:
        raise ValueError("Additional tables changed; stop and review a complete final synchronization.")
    print(json.dumps({"changed_tables": changed, "source_writes": 0, "apply": apply}), flush=True)
    if not changed or not apply:
        return
    PHASE = "source_snapshot"
    snapshot = json.loads(source.pg_command([
        "psql", "--no-psqlrc", "--no-password", "--tuples-only", "--no-align",
        "--set=ON_ERROR_STOP=1", "--command",
        """SELECT json_build_object(
          'rows', (SELECT coalesce(json_agg(t ORDER BY id), '[]') FROM public.push_tokens t),
          'sequence', (SELECT json_build_object('last_value', last_value, 'is_called', is_called)
            FROM public.push_tokens_id_seq))""",
    ], env))
    if source.fingerprint(env) != fresh:
        raise ValueError("Source changed while preparing the refresh; nothing imported.")
    sql = build_refresh_sql(
        baseline, fresh, snapshot["rows"], snapshot["sequence"],
        source.FINGERPRINT_SQL.read_text(),
    )
    identifier = uuid.uuid4().hex[:12]
    directory = STATE / f"delta-{identifier}"
    directory.mkdir(mode=0o700)
    sql_path = directory / "refresh.sql"
    target.write_private(sql_path, sql)
    bucket = f"gs://dodolink-delta-729481009477-{identifier}"
    PHASE = "private_transfer_setup"
    instance = json.loads(target.cloud(["sql", "instances", "describe", INSTANCE, "--format=json"], "instance"))
    target.cloud([
        "storage", "buckets", "create", bucket, "--location=africa-south1",
        "--uniform-bucket-level-access", "--public-access-prevention", "--soft-delete-duration=0",
    ], "create_private_delta_bucket")
    lifecycle = directory / "lifecycle.json"
    target.write_private(lifecycle, json.dumps({
        "rule": [{"action": {"type": "Delete"}, "condition": {"age": 1}}],
    }))
    target.cloud(["storage", "buckets", "update", bucket, "--lifecycle-file", str(lifecycle)], "lifecycle")
    target.cloud([
        "storage", "buckets", "add-iam-policy-binding", bucket,
        "--member=serviceAccount:" + instance["serviceAccountEmailAddress"],
        "--role=roles/storage.objectAdmin",
    ], "delta_import_access")
    target.write_private(directory / "state.json", json.dumps({
        "phase": "prepared", "bucket": bucket, "database": DATABASE,
    }))
    query = export_query(source.FINGERPRINT_SQL.read_text())
    PHASE = "target_before_inventory"
    before = target.report(bucket, "before", query, directory)
    if before != baseline:
        raise ValueError("Target changed; private transfer retained for review; no import performed.")
    target.cloud(["storage", "cp", str(sql_path), bucket + "/refresh.sql"], "upload_private_delta")
    PHASE = "atomic_target_import"
    target.write_private(directory / "state.json", json.dumps({
        "phase": "import_requested", "bucket": bucket, "database": DATABASE,
    }))
    target.cloud([
        "sql", "import", "sql", INSTANCE, bucket + "/refresh.sql", "--database", DATABASE,
        "--user", "postgres",
    ], "atomic_push_token_refresh")
    PHASE = "target_after_inventory"
    after = target.report(bucket, "after", query, directory)
    if after != fresh:
        raise ValueError("Imported delta verification failed; private transfer retained for review.")
    target.write_private(current_path, json.dumps(after))
    source_still_matches = source.fingerprint(env) == after
    target.cloud(["storage", "rm", "--recursive", bucket], "remove_private_delta_transfer")
    target.write_private(directory / "state.json", json.dumps({
        "phase": "verified", "temporary_bucket_removed": True,
        "source_still_matches": source_still_matches,
    }))
    print(json.dumps({
        "synchronized": ["push_tokens"], "verified_tables": len(after),
        "other_tables_modified": 0, "source_writes": 0,
        "source_still_matches": source_still_matches, "temporary_bucket_removed": True,
    }), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    try:
        main(args.apply)
    except Exception:
        print(json.dumps({"status": "blocked", "phase": PHASE, "details_redacted": True, "source_writes": 0}), flush=True)
        raise SystemExit(1)
