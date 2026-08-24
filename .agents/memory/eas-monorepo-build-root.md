---
name: EAS monorepo build root
description: How to avoid Expo release builds silently using the repository root instead of the mobile app directory.
---

For this monorepo, do not assume a Git-triggered Expo build will honor a requested project-root field. Verify the job log's `projectRootDirectory`; if it is `/`, the build is reading the repository-level package and EAS configuration rather than the mobile app.

**Why:** Git-triggered builds accepted but ignored attempted root-directory arguments, then selected platform-default pnpm versions and failed before compilation. Running EAS CLI from the mobile app directory used the intended EAS profile, package manifest, and lockfile.

**How to apply:** Launch production builds from the mobile app directory when the Git trigger cannot prove the correct root. Pin the pnpm version in the production EAS profile, and confirm the build log accepts the frozen lockfile before waiting for native compilation.