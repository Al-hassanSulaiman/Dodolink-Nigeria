"""Image-only releases with an atomic lock, ordering guard, and rollback.

Uses the worker's attached identity; no key files or runtime secrets. Cloud
Storage holds only build IDs, image references, and release labels. Jobs are
updated, never executed. Database migrations are intentionally out of scope.
"""
import argparse
import datetime
import json
import re
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request

JOBS = ("daily", "retention", "deletions")
LABELS = ("dodolink-build-order", "dodolink-build-id", "dodolink-commit")
TERMINAL = {"SUCCESS", "FAILURE", "INTERNAL_ERROR", "TIMEOUT", "CANCELLED", "EXPIRED"}

def deployable_path(path):
    """Keep aligned with the production trigger's include/ignore filters."""
    if path.endswith((".md", ".pyc")) or "__pycache__" in path.split("/"):
        return False
    return (
        path.startswith(("artifacts/api-server/", "artifacts/admin-dashboard/",
                         "artifacts/dodolink-ng/", "lib/", "infra/gcp/"))
        or path in {"package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", ".npmrc"}
        or re.fullmatch(r"tsconfig[^/]*\.json", path) is not None
    )


class Cloud:
    def __init__(self, project, region):
        self.project, self.region = project, region

    def command(self, *args):
        result = subprocess.run(
            ["gcloud", "--quiet", "--project", self.project, *args],
            capture_output=True, text=True, timeout=600,
        )
        if result.returncode:
            # Do not forward provider responses or resource environments to logs.
            raise RuntimeError("Google command failed: " + " ".join(args[:3]))
        return result.stdout.strip()

    def request(self, url, method="GET", body=None):
        token = self.command("auth", "print-access-token")
        data = None if body is None else json.dumps(body).encode()
        request = urllib.request.Request(
            url, data=data, method=method,
            headers={"Authorization": "Bearer " + token,
                     "Content-Type": "application/json"},
        )
        with urllib.request.urlopen(request, timeout=45) as response:
            data = response.read()
            return json.loads(data) if data else None

    def build(self, build_id):
        if not re.fullmatch(r"[0-9a-f-]{36}", build_id):
            raise RuntimeError("Invalid lock-owner build ID; refusing takeover.")
        return self.request(
            f"https://cloudbuild.googleapis.com/v1/projects/{self.project}"
            f"/locations/{self.region}/builds/{build_id}"
        )

    def describe(self, kind, name):
        return json.loads(self.command(
            "run", kind, "describe", name, "--region", self.region, "--format=json"
        ))

    def source_is_current(self, commit):
        repository = (f"projects/{self.project}/locations/{self.region}/connections/"
                      "dodolink-github/repositories/dodolink-nigeria")
        credential = self.request(
            "https://cloudbuild.googleapis.com/v2/" + repository + ":accessReadToken",
            "POST", {},
        )
        # Short-lived, read-only GitHub credential stays in worker memory.
        base = "https://api.github.com/repos/Al-hassanSulaiman/Dodolink-Nigeria"
        headers = {"Authorization": "Bearer " + credential["token"],
                   "Accept": "application/vnd.github+json",
                   "User-Agent": "DodoLink-Cloud-Build"}

        def github(path):
            request = urllib.request.Request(base + path, headers=headers)
            with urllib.request.urlopen(request, timeout=30) as response:
                return json.load(response)

        head = github("/git/ref/heads/main")["object"]["sha"]
        if head == commit:
            return True
        comparison = github("/compare/" + commit + "..." + head)
        files = comparison.get("files", [])
        # Documentation/unrelated-product pushes intentionally do not start a
        # replacement build. They must not prevent this valid build shipping.
        # GitHub caps comparison files at 300; fail closed at that boundary.
        return (comparison.get("status") == "ahead" and len(files) < 300
                and not any(deployable_path(file[key]) for file in files
                            for key in ("filename", "previous_filename") if key in file))

    def update(self, kind, name, image, labels):
        args = ["run", kind, "update", name, "--region", self.region, "--image", image]
        if kind == "services":
            args.append("--no-traffic")
        present = {key: labels[key] for key in LABELS if key in labels}
        absent = [key for key in LABELS if key not in labels]
        if present:
            args.extend(["--update-labels", ",".join(f"{k}={v}" for k, v in present.items())])
        if absent:
            args.extend(["--remove-labels", ",".join(absent)])
        self.command(*args, "--format=value(metadata.name)")

    def promote(self):
        self.command("run", "services", "update-traffic", "dodolink",
                     "--region", self.region, "--to-latest",
                     "--format=value(status.latestReadyRevisionName)")


class ReleaseLock:
    def __init__(self, cloud, bucket, build_id):
        self.cloud, self.bucket, self.build_id = cloud, bucket, build_id
        self.name = "releases/dodolink.lock"
        self.object_url = (
            f"https://storage.googleapis.com/storage/v1/b/{bucket}/o/"
            + urllib.parse.quote(self.name, safe="")
        )
        self.generation = None

    def acquire(self):
        upload = (
            f"https://storage.googleapis.com/upload/storage/v1/b/{self.bucket}/o?"
            + urllib.parse.urlencode({"uploadType": "media", "name": self.name,
                                      "ifGenerationMatch": "0"})
        )
        deadline = time.monotonic() + 600
        while time.monotonic() < deadline:
            try:
                self.generation = self.cloud.request(
                    upload, "POST", {"build": self.build_id}
                )["generation"]
                return
            except urllib.error.HTTPError as error:
                if error.code not in (409, 412):
                    raise
            try:
                metadata = self.cloud.request(self.object_url)
                generation = metadata["generation"]
                owner = self.cloud.request(
                    self.object_url + "?alt=media&generation=" + generation
                )
                if self.cloud.build(owner["build"])["status"] in TERMINAL:
                    # Only reclaim a completed build's lock, never a time-based
                    # lease that could expire while its owner is still deploying.
                    self.cloud.request(self.object_url + "?ifGenerationMatch="
                                       + generation, "DELETE")
                    continue
            except urllib.error.HTTPError as error:
                if error.code not in (404, 409, 412):
                    raise
            time.sleep(10)
        raise RuntimeError("Another release holds the lock; deployment was not started.")

    def release(self):
        if self.generation is not None:
            self.cloud.request(
                self.object_url + "?ifGenerationMatch=" + self.generation, "DELETE"
            )

    def save_history(self, record):
        url = (
            f"https://storage.googleapis.com/upload/storage/v1/b/{self.bucket}/o?"
            + urllib.parse.urlencode({
                "uploadType": "media", "name": f"releases/{self.build_id}.json",
                "ifGenerationMatch": "0",
            })
        )
        self.cloud.request(url, "POST", record)


def container(resource, kind):
    spec = resource["spec"]["template"]["spec"]
    return (spec["template"]["spec"] if kind == "jobs" else spec)["containers"][0]


def smoke():
    for path, expected in (("/api/healthz", "health"), ("/", "html"),
                           ("/admin/", "admin"), ("/api/stores?limit=1", "json")):
        for attempt in range(3):
            try:
                with urllib.request.urlopen(
                    "https://dodolink.com.ng" + path, timeout=30
                ) as response:
                    content = response.read().decode()
                    if response.status != 200:
                        raise RuntimeError("Unexpected response status.")
                if expected == "health":
                    assert json.loads(content)["status"] == "ok"
                elif expected == "json":
                    assert isinstance(json.loads(content), (dict, list))
                else:
                    assert "<html" in content.lower()
                    if expected == "admin":
                        assert re.search(r"<title>[^<]*admin", content, re.I)
                break
            except (OSError, ValueError, AssertionError, RuntimeError):
                if attempt == 2:
                    raise RuntimeError("Public smoke check failed: " + path) from None
                time.sleep(5)
        print("Public check passed:", path, flush=True)


def deploy(cloud, lock, image, build_id, commit):
    build = cloud.build(build_id)
    order = str(int(datetime.datetime.fromisoformat(
        build["createTime"].replace("Z", "+00:00")
    ).timestamp() * 1_000_000))
    labels = dict(zip(LABELS, (order, build_id, commit)))
    lock.acquire()
    try:
        if not cloud.source_is_current(commit):
            print("Deployable source on main has advanced; skipping this outdated commit.")
            return
        service = cloud.describe("services", "dodolink")
        previous_labels = service["metadata"].get("labels", {})
        if int(previous_labels.get(LABELS[0], "0")) > int(order):
            print("A newer successful build is deployed; skipping this older build.")
            return
        traffic = service["status"].get("traffic", [])
        if len(traffic) != 1 or traffic[0].get("percent") != 100:
            raise RuntimeError("Traffic is split; a manual release review is required.")
        env = {item["name"]: item.get("value") for item in container(service, "services")["env"]}
        if (env.get("BACKGROUND_JOBS_ENABLED") != "false"
                or env.get("MIGRATION_STAGING") != "false"
                or env.get("DATABASE_CONNECTION_MODE") != "cloud-sql-iam"):
            raise RuntimeError("Production safety settings changed; refusing automatic release.")
        resources = [("services", "dodolink", service)] + [
            ("jobs", "dodolink-maintenance-" + name,
             cloud.describe("jobs", "dodolink-maintenance-" + name)) for name in JOBS
        ]
        before = [{"kind": kind, "name": name, "image": container(data, kind)["image"],
                   "labels": {k: v for k, v in data["metadata"].get("labels", {}).items()
                              if k in LABELS}}
                  for kind, name, data in resources]
        lock.save_history({"before": before, "image": image, "commit": commit})
        touched = []
        try:
            for record in before:
                # Include an attempted update: an operation can fail after
                # partially applying, and must also be restored in that case.
                touched.append(record)
                cloud.update(record["kind"], record["name"], image, labels)
                print("Updated image:", record["name"], flush=True)
            cloud.promote()
            smoke()
        except Exception:
            failures = []
            for record in reversed(touched):
                try:
                    cloud.update(record["kind"], record["name"],
                                 record["image"], record["labels"])
                except Exception:
                    failures.append(record["name"])
            try:
                cloud.promote()
            except Exception:
                failures.append("web traffic")
            if failures:
                raise RuntimeError("Release failed; rollback needs attention: "
                                   + ", ".join(failures)) from None
            raise RuntimeError("Release failed; previous images and traffic restored.") from None
        print("Released one immutable image to the web service and all maintenance jobs.")
    finally:
        lock.release()


def main():
    parser = argparse.ArgumentParser()
    for name in ("project", "region", "image", "build", "commit", "bucket"):
        parser.add_argument("--" + name, required=True)
    parser.add_argument("--deploy", choices=("true", "false"), required=True)
    args = parser.parse_args()
    cloud = Cloud(args.project, args.region)
    digest = cloud.command("artifacts", "docker", "images", "describe", args.image,
                           "--format=value(image_summary.digest)")
    if not re.fullmatch(r"sha256:[0-9a-f]{64}", digest):
        raise RuntimeError("Could not resolve the pushed image to an immutable digest.")
    image = args.image.rsplit(":", 1)[0] + "@" + digest
    print("Built immutable image:", image, flush=True)
    if args.deploy == "false":
        print("Build-only validation completed; no runtime resources were changed.")
        return
    if args.region != "africa-south1" or not re.fullmatch(r"[0-9a-f]{40}", args.commit):
        raise RuntimeError("A Johannesburg release requires a full source commit SHA.")
    deploy(cloud, ReleaseLock(cloud, args.bucket, args.build), image, args.build, args.commit)


if __name__ == "__main__":
    main()
