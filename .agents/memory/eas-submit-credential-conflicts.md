---
name: EAS Submit credential conflicts
description: Resolve an Expo MCP iOS submission conflict between Apple authentication mechanisms.
---

When the Expo submission action reports an exclusive-peer conflict between Apple authentication fields, the build may be valid while the upload is blocked. Apple submission must use exactly one authentication mechanism.

**Why:** The direct submission action combined incompatible Apple credential fields. A separate cloud submission workflow reached credential preparation but could not resolve its Apple authentication configuration. Neither attempt uploaded the completed build.

**How to apply:** Follow the current Expo skill's supported publishing path; do not reuse older CLI submission advice. Cloud submission profiles need configured cloud-accessible Apple credentials and cannot rely on a private-key file in the workspace's temporary directory. Reuse the finished build once credential setup is corrected. Report upload success only after the submission actually succeeds, never merely because compilation finished.