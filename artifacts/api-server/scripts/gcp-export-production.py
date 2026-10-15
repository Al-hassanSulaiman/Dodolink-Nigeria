"""Export only a fingerprint-verified production dataset; never write to source.

Credentials are supplied through the secure environment, not command arguments.
No connection strings, credentials, SQL errors, or customer records are logged.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from urllib.parse import parse_qs, unquote, urlsplit

ROOT = Path(__file__).resolve().parents[3]
FINGERPRINT_SQL = ROOT / "infra/gcp/production-fingerprint.sql"
SECRET_KEY = "DODOLINK_SOURCE_PRODUCTION_DATABASE_URL"


class ExportError(Exception):
    pass


def source_environment(connection_url):
    try:
        parsed = urlsplit(connection_url)
        if parsed.scheme not in ("postgres", "postgresql"):
            raise ValueError()
        if not parsed.hostname or not parsed.username or not parsed.path.strip("/"):
            raise ValueError()
        port = str(parsed.port or 5432)
    except ValueError:
        raise ExportError("The securely provided PostgreSQL connection is invalid.") from None

    options = parse_qs(parsed.query)
    sslmode = options.get("sslmode", ["require"])[0]
    if sslmode not in ("require", "verify-ca", "verify-full"):
        raise ExportError("An encrypted source database connection is required.")

    # Remove inherited development PG settings; never accidentally use that DB.
    env = {key: value for key, value in os.environ.items() if not key.startswith("PG")}
    env.pop(SECRET_KEY, None)
    env.pop("DATABASE_URL", None)
    env.update({
        "PGHOST": parsed.hostname,
        "PGPORT": port,
        "PGDATABASE": unquote(parsed.path.lstrip("/")),
        "PGUSER": unquote(parsed.username),
        "PGPASSWORD": unquote(parsed.password or ""),
        "PGSSLMODE": sslmode,
        "PGCONNECT_TIMEOUT": "20",
        "PGAPPNAME": "dodolink-readonly-migration-export",
        "PGOPTIONS": options.get("options", [""])[0]
                     + " -c default_transaction_read_only=on",
    })
    for option, variable in {
        "channel_binding": "PGCHANNELBINDING",
        "sslrootcert": "PGSSLROOTCERT",
        "sslcert": "PGSSLCERT",
        "sslkey": "PGSSLKEY",
    }.items():
        if option in options:
            env[variable] = options[option][0]
    return env


def pg_command(command, env):
    completed = subprocess.run(
        command, env=env, stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        text=True, check=False, timeout=300,
    )
    if completed.returncode:
        # PostgreSQL stderr can contain connection details; keep it out of logs.
        raise ExportError("A PostgreSQL export command failed; credentials were not logged.")
    return completed.stdout.strip()


def fingerprint(env):
    raw = pg_command([
        "psql", "--no-psqlrc", "--no-password", "--tuples-only", "--no-align",
        "--set=ON_ERROR_STOP=1", "--file", str(FINGERPRINT_SQL),
    ], env)
    return json.loads(raw)


def export(expected_file):
    connection = os.environ.get(SECRET_KEY)
    if not connection:
        raise ExportError("The secure production source connection has not been provided.")
    env = source_environment(connection)
    expected = json.loads(expected_file.read_text())
    actual = fingerprint(env)
    if not expected or actual != expected:
        raise ExportError("Source does not match the verified production inventory. No dump created.")

    tables = json.loads(pg_command([
        "psql", "--no-psqlrc", "--no-password", "--tuples-only", "--no-align",
        "--set=ON_ERROR_STOP=1", "--command",
        "SELECT coalesce(json_agg(tablename ORDER BY tablename), '[]'::json) "
        "FROM pg_tables WHERE schemaname = 'public'",
    ], env))
    if set(tables) != set(expected):
        raise ExportError("Source tables differ from the verified inventory; review before exporting.")

    os.umask(0o077)
    output_dir = ROOT / "generated-artifacts/gcp-migration"
    output_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    output_dir.chmod(0o700)
    descriptor, filename = tempfile.mkstemp(
        prefix="production-", suffix=".dump", dir=output_dir,
    )
    os.close(descriptor)
    output = Path(filename)
    try:
        pg_command([
            "pg_dump", "--no-password", "--format=custom", "--schema=public",
            "--no-owner", "--no-privileges", "--no-publications",
            "--no-subscriptions", "--file", str(output),
        ], env)
        pg_command(["pg_restore", "--list", str(output)], env)
        if fingerprint(env) != expected:
            raise ExportError("Production changed during export; refresh the inventory and retry.")

        digest = hashlib.sha256()
        with output.open("rb") as stream:
            for block in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(block)
        output.with_suffix(".manifest.json").write_text(json.dumps({
            "tables": expected,
            "dump_sha256": digest.hexdigest(),
            "source_read_only": True,
            "source_ownership_and_acl_excluded": True,
        }, indent=2) + "\n")
    except Exception:
        output.unlink(missing_ok=True)
        raise
    print(json.dumps({
        "status": "exported",
        "dump": str(output.relative_to(ROOT)),
        "tables": len(expected),
        "source_writes": 0,
    }))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--expected-inventory", type=Path, required=True)
    args = parser.parse_args()
    try:
        export(args.expected_inventory)
    except ExportError as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
    except Exception:
        print("Export failed safely; no source writes were performed.", file=sys.stderr)
        sys.exit(1)
