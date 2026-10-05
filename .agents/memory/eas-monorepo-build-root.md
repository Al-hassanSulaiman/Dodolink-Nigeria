---
name: EAS monorepo build root
description: How to avoid Expo release builds silently using the repository root instead of the mobile app directory.
---

For this monorepo, do not assume a Git-triggered Expo build will honor a requested project-root field. Verify the job log's `projectRootDirectory`; if it is `/`, the build is reading the repository-level package and EAS configuration rather than the mobile app.

**Why:** Git-triggered builds accepted but ignored attempted root-directory arguments, then selected platform-default pnpm versions and failed before compilation. An isolated release branch with the mobile app at repository root successfully built without changing the main workspace layout.

**How to apply:** Follow the current Expo skill's supported release path, not older CLI workarounds. For Git-triggered builds that ignore the mobile directory, prepare an isolated root-app release branch with required shared libraries and a portable lockfile. Preserve security overrides, but remove platform-exclusion overrides only in the release snapshot so macOS dependencies remain installable. Verify the selected app build number and frozen-lockfile installation before waiting for compilation.

Avoid bootstrapping another pnpm version while preparing a temporary release snapshot.

**Why:** Automatic pnpm version bootstrapping unexpectedly changed the real workspace's lockfile catalogs and dependency layout, breaking Metro's optional-plugin discovery and React identity even though the release preparation was intended to be isolated.

**How to apply:** Disable automatic package-manager switching during temporary lockfile preparation, use an already available pnpm executable, and check that the main workspace's dependency files remain unchanged.