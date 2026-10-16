---
name: Cloud Build worker constraints
description: Regional worker quota and Python packaging differences encountered during direct Google CI setup.
---

Do not assume a project's default Cloud Build quota includes high-CPU workers in Johannesburg.

**Why:** Standard workers ran successfully, while an eight-vCPU high-CPU build was rejected before execution due to regional machine-type quota. More CPU was not required to build the Expo web frontend.

**How to apply:** Prefer the available standard worker unless a measured need justifies requesting a regional quota increase. Do not move build execution out of the user's chosen region as an automatic workaround.

The official Google Cloud CLI container can have a working bundled Python interpreter without a `python3` executable on PATH.

**Why:** The application image built successfully, but the release step could not start with `python3` as its entrypoint.

**How to apply:** Discover the interpreter used by the installed CLI, or use an independently verified image/runtime. Do not assume the developer workspace's globally available interpreters exist in a CI container.

The bundled interpreter may also lack a default trusted certificate location even while gcloud's own HTTPS calls work.

**Why:** Standard-library HTTPS failed certificate verification in the CLI container; the SDK's bundled certifi roots successfully verified Google APIs, GitHub, and the production domain.

**How to apply:** Locate the installed SDK through its reported installation root and explicitly use its trusted CA bundle when the system has none. Keep certificate verification enabled. Validate the exact worker environment with a small read-only preflight rather than repeatedly rebuilding the entire application.
