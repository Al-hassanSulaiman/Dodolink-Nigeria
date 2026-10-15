"""Offline safety checks; never contact cloud or payment services."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "stage_secrets", Path(__file__).with_name("gcp-stage-runtime-secrets.py"),
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class SecretStagingTests(unittest.TestCase):
    def setUp(self):
        self.calls = []
        self.staging = True
        self.existing = False
        self.matching = True
        self.replication = module.REGION
        self.environment = patch.dict(os.environ, {
            "PAYSTACK_SECRET_KEY": "sk_live_OFFLINE_TEST_ONLY",
            "GMAIL_APP_PASSWORD": "OFFLINE_TEST_ONLY",
        })
        self.environment.start()
        self.cloud = patch.object(module, "cloud", side_effect=self.fake_cloud)
        self.cloud.start()
        self.payment = patch.object(module, "verify_payment_credential")
        self.payment.start()
        self.addCleanup(self.environment.stop)
        self.addCleanup(self.cloud.stop)
        self.addCleanup(self.payment.stop)

    def fake_cloud(self, arguments, **kwargs):
        self.calls.append((arguments, kwargs))
        if arguments[:3] == ["run", "services", "describe"]:
            return json.dumps({"spec": {"template": {"spec": {"containers": [{
                "env": [
                    {"name": "MIGRATION_STAGING", "value": str(self.staging).lower()},
                    {"name": "DATABASE_CONNECTION_MODE", "value": "cloud-sql-iam"},
                    {"name": "CLOUD_SQL_DATABASE", "value": "dodolink"},
                ],
            }]}}}})
        if arguments[:2] == ["secrets", "describe"]:
            if not self.existing:
                return None
            return json.dumps({"replication": {"userManaged": {"replicas": [
                {"location": self.replication},
            ]}}})
        if arguments[:3] == ["secrets", "versions", "list"]:
            return json.dumps([{"name": "projects/example/secrets/example/versions/1"}])
        if arguments[:3] == ["secrets", "versions", "access"]:
            secret = arguments[arguments.index("--secret") + 1]
            variable = next(k for k, v in module.SECRETS.items() if v == secret)
            return os.environ[variable] if self.matching else "DIFFERENT_OFFLINE_VALUE"
        if arguments[:3] == ["secrets", "versions", "add"]:
            return json.dumps({"name": "projects/example/secrets/example/versions/1"})
        return ""

    def run_main(self, apply):
        with patch("builtins.print") as output:
            module.main(apply)
        return json.loads(output.call_args.args[0])

    def test_dry_run_does_not_mutate_cloud(self):
        result = self.run_main(False)
        self.assertEqual(result["status"], "dry_run_verified")
        self.assertTrue(all(
            a[:3] == ["run", "services", "describe"]
            or a[:2] == ["secrets", "describe"] for a, _ in self.calls
        ))

    def test_apply_uses_stdin_and_version_pinned_bindings(self):
        result = self.run_main(True)
        self.assertEqual(result["payments_initiated"], 0)
        versions = [(a, kw) for a, kw in self.calls if a[:3] == ["secrets", "versions", "add"]]
        self.assertEqual(len(versions), 2)
        for args, kwargs in versions:
            self.assertIn("--data-file=-", args)
            self.assertNotIn(kwargs["data"], args)
        updates = [a for a, _ in self.calls if a[:3] == ["run", "services", "update"]]
        self.assertEqual(len(updates), 1)
        self.assertIn(
            "--update-secrets=PAYSTACK_SECRET_KEY=dodolink-paystack-secret-key:1,"
            "GMAIL_APP_PASSWORD=dodolink-gmail-app-password:1", updates[0],
        )
        self.assertNotIn("MIGRATION_STAGING=false", " ".join(updates[0]))

    def test_existing_matching_credentials_do_not_add_versions(self):
        self.existing = True
        self.run_main(True)
        self.assertFalse(any(a[:3] == ["secrets", "versions", "add"] for a, _ in self.calls))

    def test_different_existing_credentials_are_not_rotated(self):
        self.existing = True
        self.matching = False
        with self.assertRaises(module.StagingError):
            self.run_main(True)
        self.assertFalse(any(a[:3] == ["run", "services", "update"] for a, _ in self.calls))

    def test_non_johannesburg_replication_is_rejected(self):
        self.existing = True
        self.replication = "us-central1"
        with self.assertRaises(module.StagingError):
            self.run_main(True)

    def test_non_staging_runtime_is_rejected(self):
        self.staging = False
        with self.assertRaises(module.StagingError):
            self.run_main(True)
        self.assertEqual(len(self.calls), 1)

    def test_missing_credential_is_rejected(self):
        del os.environ["GMAIL_APP_PASSWORD"]
        with self.assertRaises(module.StagingError):
            self.run_main(True)
        self.assertFalse(any(a[:2] == ["secrets", "create"] for a, _ in self.calls))

    def test_cloud_error_does_not_expose_stderr(self):
        self.cloud.stop()
        response = subprocess.CompletedProcess([], 1, "", "SENSITIVE_OFFLINE_MARKER")
        with patch.object(module.subprocess, "run", return_value=response):
            with self.assertRaises(module.StagingError) as caught:
                module.cloud(["secrets", "create", "example"])
        self.assertNotIn("SENSITIVE_OFFLINE_MARKER", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
