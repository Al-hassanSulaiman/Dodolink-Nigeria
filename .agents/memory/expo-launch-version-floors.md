---
name: Expo Launch version floors
description: Why app settings and prebuild version checks are insufficient for managed iOS publishing.
---

When publishing an app that already has Apple uploads outside Expo Launch, do not assume Launch's build counter matches App Store Connect. Keep a native build-number minimum above Apple's accepted releases and raise that minimum together with the app build number for each new release. A prebuild-only minimum is not sufficient evidence that the cloud archive will use that number.

**Why:** Launch authenticated and compiled successfully but submitted a lower bundle version than Apple had already accepted. A later attempt again used a lower number even after higher app settings and generated native metadata passed local checks.

**How to apply:** Verify the native version at compile time, including a cloud rewrite after prebuild, and keep newer values rather than lowering them. Correct native source metadata before plist processing and signing, not by modifying an already signed archive. Linux-side script and project checks cannot prove a macOS archive or Apple upload succeeds; confirm the retry through Expo Launch logs before reporting that Apple received it. If managed publishing still changes the final version, do not keep bumping app settings or ask for blind retries.
