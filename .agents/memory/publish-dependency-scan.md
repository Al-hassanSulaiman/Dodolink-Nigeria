---
name: Publish dependency scan coverage
description: Why build-only and mobile toolchain dependencies can block publishing, including advisories with no upstream patch.
---

Publish security validation covers the complete dependency graph used to build artifacts, not only packages reachable by the production server.

**Why:** A mobile bundler dependency with an unpatched denial-of-service advisory blocked the whole multi-artifact publish even though it was build-time only. Updating server dependencies alone left publishing blocked.

**How to apply:** When Publish reports dependency findings, audit the entire workspace lockfile. Prefer patched direct parents or compatible transitive updates. If no patched release exists, remove the vulnerable parser or replace it with a bounded API-compatible implementation, then verify the affected artifact’s full production build.