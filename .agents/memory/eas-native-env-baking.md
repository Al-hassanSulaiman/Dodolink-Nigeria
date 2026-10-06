---
name: EAS native builds need env baked in eas.json
description: TestFlight/native builds crash on launch if EXPO_PUBLIC_* vars aren't in the eas.json build profile env block.
---

# EAS native builds — env vars must be in eas.json

EAS cloud builds do NOT get env vars from the workspace, `.env`, or the web deploy's `scripts/build.js` baking. The production build profile in `eas.json` must have an `env` block with every `EXPO_PUBLIC_*` var the app reads (Clerk publishable key, API domain).

**Why:** first TestFlight build shipped with `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` undefined → ClerkProvider threw → instant crash on launch ("app crashed" with no other symptom).

Also: native builds must bake the **pk_live** key + `EXPO_PUBLIC_CLERK_PROXY_URL` (https://dodolink.com.ng/api/__clerk), not the workspace pk_test key — pk_test signs users into the dev user store and shows Clerk's "sandboxed preview / one-time setup" screen on TestFlight. The live key is public and recoverable from the deployed admin-dashboard JS bundle. Apple allows max 2 iOS distribution certs; private keys aren't kept, so revoke old certs via the ASC API before creating a new one (safe for already-uploaded builds).

**How to apply:** before native publishing, check the release build configuration supplies the production API domain, Clerk publishable key, and Clerk proxy URL. Follow the current Expo skill's supported publishing flow, not historical EAS CLI instructions. See [Expo Launch version floors](expo-launch-version-floors.md) for the separate problem of Launch's build counter lagging App Store Connect.
