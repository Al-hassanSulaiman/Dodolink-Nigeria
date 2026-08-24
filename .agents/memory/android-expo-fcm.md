---
name: Android Expo FCM setup
description: Required native Firebase configuration and Expo credential for Android remote push notifications.
---

For Android remote push notifications through Expo, include the Firebase `google-services.json` file through `android.googleServicesFile` and upload an FCM V1 service-account credential to the Expo project. The `expo-notifications` plugin and Android notification permission alone are insufficient.

**Why:** Without Firebase app configuration, the Android device cannot obtain an FCM-backed Expo push token. The symptom can look like a missing permission prompt or a silent registration failure, while the server sees no newly registered token.

**How to apply:** Treat `google-services.json` as source-controlled, public Firebase app configuration. Keep the FCM V1 service-account key only in Expo credentials; never place it in the repository or workspace logs. After any release, verify a physical Android device registers a fresh token before validating message delivery.