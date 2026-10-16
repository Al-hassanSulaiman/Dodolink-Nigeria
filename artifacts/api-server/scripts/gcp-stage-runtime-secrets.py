"""Stage existing production credentials without exposing their values.

Dry-run by default. Only the named DodoLink target is supported, and the Cloud
Run service must remain read-only with background jobs disabled.
"""
import argparse
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

PROJECT = "project-3a919f28-1462-4a1d-a2c"
REGION = "africa-south1"
ACCOUNT = f"cloudrun-for-dodolink@{PROJECT}.iam.gserviceaccount.com"
SECRETS = {
    "PAYSTACK_SECRET_KEY": "dodolink-paystack-secret-key",
    "GMAIL_APP_PASSWORD": "dodolink-gmail-app-password",
}


class StagingError(Exception):
    pass


def cloud(arguments, *, data=None, optional=False):
    result = subprocess.run(
        ["gcloud", *arguments, "--project", PROJECT, "--quiet"],
        input=data, capture_output=True, text=True, timeout=180,
    )
    if result.returncode:
        if optional and (
            "NOT_FOUND" in result.stderr or "was not found" in result.stderr
        ):
            return None
        raise StagingError("A cloud credential operation failed; details redacted.")
    return result.stdout


def assert_staging():
    service = json.loads(cloud([
        "run", "services", "describe", "dodolink",
        "--region", REGION, "--format=json",
    ]))
    container = service["spec"]["template"]["spec"]["containers"][0]
    environment = {v["name"]: v.get("value") for v in container.get("env", [])}
    if (
        environment.get("MIGRATION_STAGING") != "true"
        or environment.get("DATABASE_CONNECTION_MODE") != "cloud-sql-iam"
        or environment.get("CLOUD_SQL_DATABASE") != "dodolink"
    ):
        raise StagingError("The target is not the expected read-only migration service.")


def verify_payment_credential():
    value = os.environ["PAYSTACK_SECRET_KEY"]
    if not value.startswith("sk_live_"):
        raise StagingError("Refusing to stage a test payment credential as production.")
    request = urllib.request.Request(
        "https://api.paystack.co/balance",
        headers={
            "Authorization": "Bearer " + value,
            "User-Agent": "DodoLinkMigration/1.0",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=25) as response:
            result = json.load(response)
    except Exception:
        raise StagingError("Read-only payment credential validation failed.") from None
    if result.get("status") is not True:
        raise StagingError("The payment service did not accept the credential.")
    # Do not log balances, account details, or authentication headers.


def main(apply):
    assert_staging()
    if any(not os.environ.get(key) for key in SECRETS):
        raise StagingError("A required credential is absent from the secure environment.")
    verify_payment_credential()
    bindings = []
    for variable, secret in SECRETS.items():
        existing = cloud(
            ["secrets", "describe", secret, "--format=json"], optional=True,
        )
        if existing is not None:
            configuration = json.loads(existing)
            replicas = (
                configuration.get("replication", {})
                .get("userManaged", {}).get("replicas", [])
            )
            if [replica.get("location") for replica in replicas] != [REGION]:
                raise StagingError("Existing secret replication differs from Johannesburg.")
            versions = json.loads(cloud([
                "secrets", "versions", "list", secret,
                "--filter=state:ENABLED", "--sort-by=~createTime",
                "--limit=1", "--format=json",
            ]))
            if versions:
                version = versions[0]["name"].rsplit("/", 1)[-1]
                current = cloud([
                    "secrets", "versions", "access", version, "--secret", secret,
                ])
                if current != os.environ[variable]:
                    raise StagingError(
                        "An existing credential differs; explicit rotation review is required."
                    )
            elif apply:
                version = add_version(secret, variable)
            else:
                version = None
        elif apply:
            cloud([
                "secrets", "create", secret, "--replication-policy=user-managed",
                "--locations", REGION, "--labels=app=dodolink",
            ])
            version = add_version(secret, variable)
        else:
            version = None
        if apply:
            cloud([
                "secrets", "add-iam-policy-binding", secret,
                "--member=serviceAccount:" + ACCOUNT,
                "--role=roles/secretmanager.secretAccessor", "--condition=None",
            ])
            bindings.append(f"{variable}={secret}:{version}")
    if apply:
        # Recheck the lock immediately before deploying a credential-only revision.
        assert_staging()
        cloud([
            "run", "services", "update", "dodolink", "--region", REGION,
            "--update-secrets=" + ",".join(bindings),
        ])
        assert_staging()
    print(json.dumps({
        "status": "staged" if apply else "dry_run_verified",
        "credential_names": list(SECRETS),
        "replication_region": REGION,
        "payment_credential_read_only_validation": True,
        "payments_initiated": 0,
        "emails_sent": 0,
        "migration_staging_preserved": True,
    }))


def add_version(secret, variable):
    result = json.loads(cloud([
        "secrets", "versions", "add", secret, "--data-file=-", "--format=json",
    ], data=os.environ[variable]))
    return result["name"].rsplit("/", 1)[-1]


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    arguments = parser.parse_args()
    try:
        main(arguments.apply)
    except (StagingError, subprocess.TimeoutExpired, KeyError, ValueError) as error:
        message = str(error) if isinstance(error, StagingError) else "Credential staging failed; details redacted."
        print(json.dumps({"status": "blocked", "reason": message}), file=sys.stderr)
        sys.exit(1)
