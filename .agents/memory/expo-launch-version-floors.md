---
name: Expo Launch version floors
description: Why app settings and prebuild version checks are insufficient for managed iOS publishing.
---

When publishing an app that already has Apple uploads outside Expo Launch, do not assume Launch's build counter matches App Store Connect. Keep a native build-number minimum above Apple's accepted releases and raise that minimum together with the app build number for each new release. A prebuild-only minimum is not sufficient evidence that the cloud archive will use that number.

**Why:** Launch authenticated and compiled successfully but submitted a lower bundle version than Apple had already accepted. A later attempt again used a lower number even after higher app settings and generated native metadata passed local checks.

**How to apply:** Verify the native version at compile time, including a cloud rewrite after prebuild, and keep newer values rather than lowering them. Correct native source metadata before plist processing and signing, not by modifying an already signed archive. Linux-side script and project checks cannot prove a macOS archive or Apple upload succeeds; confirm the retry through Expo Launch logs before reporting that Apple received it. If managed publishing still changes the final version, do not keep bumping app settings or ask for blind retries.

Do not treat the personal Expo connector's build list as a complete inventory of Expo Launch uploads.

**Why:** App Store Connect and the managed Expo Launch session confirmed a newer successful upload that was absent from the personal Expo project's build list. The personal connector could not read the managed workflow.

**How to apply:** Confirm Apple's selected review build and upload metadata through read-only App Store Connect access, and consult Expo Launch status separately. Inspect the exact archive when claiming binary contents; an older archive plus unchanged source is supporting evidence, not direct inspection of the submitted binary.
