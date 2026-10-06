---
name: Expo Launch version floors
description: Prevent a managed publishing counter from falling below the app's existing Apple release history.
---

When publishing an app that already has Apple uploads outside Expo Launch, do not assume Launch's build counter matches App Store Connect. Keep a native build-number minimum above Apple's accepted releases and raise that minimum together with the app build number for each new release.

**Why:** Launch authenticated and compiled successfully but submitted a lower bundle version than Apple had already accepted, even though the app settings specified a higher version. Checking app settings alone did not detect the mismatch.

**How to apply:** Verify the generated native CFBundleVersion, including the case where publishing supplies a lower number. Keep newer native values rather than lowering them. Local generation checks do not prove upload success or prevent a service from post-processing metadata; confirm the retry through Expo Launch logs before reporting that Apple received it.
