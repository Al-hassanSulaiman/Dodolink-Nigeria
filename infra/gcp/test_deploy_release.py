"""Offline release-safety checks; never invoke gcloud or public endpoints."""
import importlib.util
import json
import pathlib
import unittest
import urllib.error
from unittest.mock import Mock, patch

SPEC = importlib.util.spec_from_file_location(
    "release", pathlib.Path(__file__).with_name("deploy-release.py"))
release = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(release)
BUILD = "12345678-1234-1234-1234-123456789abc"
COMMIT = "a" * 40
IMAGE = "example/image@sha256:" + "b" * 64


def resource(kind="services", order="0"):
    spec = {"containers": [{"image": "old-" + kind, "env": [
        {"name": "BACKGROUND_JOBS_ENABLED", "value": "false"},
        {"name": "MIGRATION_STAGING", "value": "false"},
        {"name": "DATABASE_CONNECTION_MODE", "value": "cloud-sql-iam"},
    ]}]}
    return {"metadata": {"labels": {release.LABELS[0]: order}},
            "spec": {"template": {"spec":
                     {"template": {"spec": spec}} if kind == "jobs" else spec}},
            "status": {"traffic": [{"percent": 100}]}}


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.cloud, self.lock = Mock(), Mock()
        self.cloud.build.return_value = {"createTime": "2026-10-16T04:00:00Z"}
        self.cloud.source_is_current.return_value = True
        self.cloud.describe.side_effect = lambda kind, _: resource(kind)

    def run_release(self):
        release.deploy(self.cloud, self.lock, IMAGE, BUILD, COMMIT)

    @patch.object(release, "smoke")
    def test_updates_four_images_then_promotes_without_running_jobs(self, smoke):
        self.run_release()
        self.assertEqual(self.cloud.update.call_count, 4)
        self.assertTrue(all(call.args[2] == IMAGE
                            for call in self.cloud.update.call_args_list))
        self.cloud.promote.assert_called_once()
        smoke.assert_called_once()
        self.lock.save_history.assert_called_once()
        self.lock.release.assert_called_once()

    def test_older_build_cannot_replace_newer_success(self):
        self.cloud.describe.side_effect = lambda *_: resource(order="9999999999999999")
        self.run_release()
        self.cloud.update.assert_not_called()
        self.lock.release.assert_called_once()

    def test_delayed_push_for_an_old_commit_cannot_deploy(self):
        self.cloud.source_is_current.return_value = False
        self.run_release()
        self.cloud.describe.assert_not_called()
        self.cloud.update.assert_not_called()
        self.lock.release.assert_called_once()

    def test_safety_flag_change_stops_deployment(self):
        data = resource()
        release.container(data, "services")["env"][0]["value"] = "true"
        self.cloud.describe.side_effect = lambda *_: data
        with self.assertRaisesRegex(RuntimeError, "safety settings"):
            self.run_release()
        self.cloud.update.assert_not_called()
        self.lock.release.assert_called_once()

    def test_split_traffic_requires_review(self):
        data = resource()
        data["status"]["traffic"] = [{"percent": 90}, {"percent": 10}]
        self.cloud.describe.side_effect = lambda *_: data
        with self.assertRaisesRegex(RuntimeError, "Traffic is split"):
            self.run_release()
        self.cloud.update.assert_not_called()

    @patch.object(release, "smoke", side_effect=RuntimeError("bad health"))
    def test_health_failure_restores_all_images(self, _):
        with self.assertRaisesRegex(RuntimeError, "previous images"):
            self.run_release()
        self.assertEqual(self.cloud.update.call_count, 8)
        self.assertEqual(self.cloud.update.call_args_list[-1].args[2], "old-services")
        self.lock.release.assert_called_once()

    def test_partial_update_failure_also_restores_attempted_resource(self):
        self.cloud.update.side_effect = [None, RuntimeError("partial"), None, None]
        with self.assertRaisesRegex(RuntimeError, "previous images"):
            self.run_release()
        self.assertEqual(self.cloud.update.call_count, 4)
        self.assertEqual(self.cloud.update.call_args_list[2].args[2], "old-jobs")
        self.lock.release.assert_called_once()

    def test_rollback_failure_is_reported(self):
        self.cloud.update.side_effect = RuntimeError("unavailable")
        with self.assertRaisesRegex(RuntimeError, "rollback needs attention"):
            self.run_release()
        self.lock.release.assert_called_once()

    def test_lock_failure_never_changes_production(self):
        self.lock.acquire.side_effect = RuntimeError("busy")
        with self.assertRaisesRegex(RuntimeError, "busy"):
            self.run_release()
        self.cloud.update.assert_not_called()
        self.lock.release.assert_not_called()


class LockTests(unittest.TestCase):
    def test_create_and_release_are_generation_conditional(self):
        cloud = Mock()
        cloud.request.return_value = {"generation": "12"}
        lock = release.ReleaseLock(cloud, "bucket", BUILD)
        lock.acquire()
        lock.release()
        self.assertIn("ifGenerationMatch=0", cloud.request.call_args_list[0].args[0])
        self.assertIn("ifGenerationMatch=12", cloud.request.call_args_list[1].args[0])

    @patch.object(release.time, "sleep")
    def test_terminal_owner_can_be_reclaimed(self, _):
        conflict = urllib.error.HTTPError("https://example", 412, "exists", {}, None)
        cloud = Mock()
        cloud.request.side_effect = [
            conflict, {"generation": "1"}, {"build": BUILD}, None, {"generation": "2"}]
        cloud.build.return_value = {"status": "CANCELLED"}
        lock = release.ReleaseLock(cloud, "bucket", BUILD)
        lock.acquire()
        self.assertEqual(lock.generation, "2")
        self.assertIn("ifGenerationMatch=1", cloud.request.call_args_list[3].args[0])

    @patch.object(release.time, "sleep")
    @patch.object(release.time, "monotonic", side_effect=[0, 0, 601])
    def test_working_owner_is_not_displaced(self, *_):
        conflict = urllib.error.HTTPError("https://example", 412, "exists", {}, None)
        cloud = Mock()
        cloud.request.side_effect = [conflict, {"generation": "1"}, {"build": BUILD}]
        cloud.build.return_value = {"status": "WORKING"}
        with self.assertRaisesRegex(RuntimeError, "holds the lock"):
            release.ReleaseLock(cloud, "bucket", BUILD).acquire()
        self.assertFalse(any(call.args[1:2] == ("DELETE",)
                             for call in cloud.request.call_args_list))

class SourceTests(unittest.TestCase):
    def compare(self, files, status="ahead"):
        cloud = release.Cloud("project", "africa-south1")
        with patch.object(cloud, "request", return_value={"token": "test"}), \
                patch.object(release.urllib.request, "urlopen") as http:
            http.return_value.__enter__.return_value.read.side_effect = [
                json.dumps({"object": {"sha": "c" * 40}}).encode(),
                json.dumps({"status": status, "files": files}).encode(),
            ]
            result = cloud.source_is_current(COMMIT)
            self.assertTrue(cloud.request.call_args.args[0].endswith(":accessReadToken"))
            return result

    def test_ignored_push_does_not_strand_a_valid_pending_build(self):
        self.assertTrue(self.compare([{"filename": "infra/gcp/README.md"},
                                      {"filename": "artifacts/portfolio/src/App.tsx"}]))

    def test_renaming_source_out_of_the_app_is_still_a_code_change(self):
        self.assertFalse(self.compare([{"filename": "old-copy.js",
                                        "previous_filename": "artifacts/api-server/src/app.ts"}]))

    def test_truncated_or_diverged_comparison_fails_closed(self):
        self.assertFalse(self.compare([{"filename": "README.md"}] * 300))
        self.assertFalse(self.compare([], status="diverged"))

    def test_deployment_filter(self):
        for path in ("lib/db/src/index.ts", "infra/gcp/deploy-release.py",
                     "pnpm-lock.yaml", "tsconfig.base.json"):
            self.assertTrue(release.deployable_path(path), path)
        for path in ("replit.md", "infra/gcp/__pycache__/example.pyc",
                     "artifacts/dodolink-promo/src/App.tsx"):
            self.assertFalse(release.deployable_path(path), path)


if __name__ == "__main__":
    unittest.main()
