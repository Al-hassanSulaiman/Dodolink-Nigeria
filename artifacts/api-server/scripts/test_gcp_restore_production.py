"""Offline safety checks: these tests never invoke gcloud or a real database."""
import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "gcp_restore", Path(__file__).with_name("gcp-restore-production.py"),
)
restore_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(restore_module)


class RestoreSafetyTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        directory = self.root / "generated-artifacts/gcp-migration"
        directory.mkdir(parents=True)
        self.dump = directory / "production-test.dump"
        self.dump.write_bytes(b"test-only-dump")
        self.tables = {
            f"table_{index}": {"rows": index, "digest": "test-only"}
            for index in range(14)
        }
        self.dump.with_suffix(".manifest.json").write_text(json.dumps({
            "tables": self.tables, "source_read_only": True,
            "source_ownership_and_acl_excluded": True,
            "dump_sha256": hashlib.sha256(self.dump.read_bytes()).hexdigest(),
        }))
        fingerprint = self.root / "infra/gcp/production-fingerprint.sql"
        fingerprint.parent.mkdir(parents=True)
        fingerprint.write_text("SELECT '{}'::jsonb;")
        self.instance = {
            "connectionName": f"{restore_module.PROJECT}:africa-south1:wordpress-db",
            "region": "africa-south1", "state": "RUNNABLE",
            "serviceAccountEmailAddress": "test-only@example.invalid",
        }
        self.before = {
            "database": "dodolink", "tables": 0,
            "app_role_exists": True, "app_role_admin": False,
        }
        self.after = {
            "fingerprint": self.tables,
            "sequences": {"stores_id_seq": {"last_value": 30, "is_called": True}},
            "foreign_keys": 1, "unvalidated_foreign_keys": 0,
            "app_table_access": True, "app_sequence_access": True,
            "app_database_access": True, "app_schema_access": True,
        }
        self.calls = []
        self.sequence_sql = "SELECT pg_catalog.setval('public.stores_id_seq', 30, true);\n"

    def fake_command(self, arguments, phase):
        self.assertEqual(arguments[0], "pg_restore")
        if "--list" in arguments:
            return (
                "1; 1 1 SCHEMA - public owner\n"
                "2; 1 1 SEQUENCE SET public stores_id_seq owner\n"
                "3; 1 1 FK CONSTRAINT public products products_fk owner\n"
            )
        Path(arguments[arguments.index("--file") + 1]).write_text(self.sequence_sql)
        return ""

    def fake_cloud(self, arguments, phase):
        self.calls.append((phase, arguments))
        if phase == "target_identity_check":
            return json.dumps(self.instance)
        return ""

    def run_restore(self, apply=True):
        with (
            patch.object(restore_module, "ROOT", self.root),
            patch.object(restore_module, "command", self.fake_command),
            patch.object(restore_module, "cloud", self.fake_cloud),
            patch.object(restore_module, "report", side_effect=[self.before, self.after]),
            contextlib.redirect_stdout(io.StringIO()),
        ):
            restore_module.restore(self.dump, apply)

    def test_success_uses_atomic_empty_target_guard_and_removes_only_transfer_bucket(self):
        self.run_restore()
        phases = [phase for phase, _ in self.calls]
        self.assertIn("restore_target_database", phases)
        self.assertEqual(phases[-1], "remove_transfer_bucket")
        sql = next(self.dump.parent.glob("restore-*/restore.sql")).read_text()
        self.assertTrue(sql.startswith("\\set ON_ERROR_STOP on\nBEGIN;"))
        self.assertIn("current_database() <> 'dodolink'", sql)
        self.assertIn("Target schema is not empty", sql)
        self.assertTrue(sql.endswith("COMMIT;\n"))
        self.assertNotIn("GRANT cloudsqlsuperuser", sql)
        cleanup = self.calls[-1][1]
        self.assertTrue(cleanup[-1].startswith("gs://dodolink-transfer-"))
        state = json.loads(next(self.dump.parent.glob("restore-*/state.json")).read_text())
        self.assertEqual(state["phase"], "verified")
        self.assertTrue(state["transfer_bucket_removed"])

    def test_dry_run_never_calls_cloud(self):
        self.run_restore(apply=False)
        self.assertEqual(self.calls, [])

    def test_modified_dump_never_calls_cloud(self):
        self.dump.write_bytes(b"modified")
        with self.assertRaises(restore_module.RestoreError):
            self.run_restore()
        self.assertEqual(self.calls, [])

    def test_wrong_region_prevents_cloud_writes(self):
        self.instance["region"] = "us-east1"
        with self.assertRaises(restore_module.RestoreError):
            self.run_restore()
        self.assertEqual([phase for phase, _ in self.calls], ["target_identity_check"])

    def test_nonempty_target_prevents_import(self):
        self.before["tables"] = 1
        with self.assertRaises(restore_module.RestoreError):
            self.run_restore()
        self.assertNotIn("restore_target_database", [phase for phase, _ in self.calls])

    def test_admin_app_identity_prevents_import(self):
        self.before["app_role_admin"] = True
        with self.assertRaises(restore_module.RestoreError):
            self.run_restore()
        self.assertNotIn("restore_target_database", [phase for phase, _ in self.calls])

    def test_bad_sequence_inventory_prevents_bucket_creation(self):
        self.sequence_sql = "-- No recognized sequence state.\n"
        with self.assertRaises(restore_module.RestoreError):
            self.run_restore()
        self.assertNotIn("create_transfer_bucket", [phase for phase, _ in self.calls])

    def test_failed_verification_keeps_transfer_for_investigation(self):
        self.after["fingerprint"] = {}
        with self.assertRaises(restore_module.RestoreError):
            self.run_restore()
        self.assertNotIn("remove_transfer_bucket", [phase for phase, _ in self.calls])


if __name__ == "__main__":
    unittest.main()
