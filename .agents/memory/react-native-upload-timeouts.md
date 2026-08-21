---
name: React Native upload timeouts
description: Native Expo builds do not implement AbortSignal.timeout even when web development does.
---

Do not use `AbortSignal.timeout()` in code that executes on the React Native Android or iOS runtime. Use an `AbortController` with a normal timer, clearing that timer after the request settles; retain a Promise-race fallback only for runtimes without `AbortController`.

**Why:** The Android closed-test chat photo picker failed before uploading with the user-facing error “undefined is not a function.” The web preview did not reveal the problem because its JavaScript runtime supports `AbortSignal.timeout`.

**How to apply:** Treat all native media reads and uploads as time-bounded operations, but implement the bound with a native-safe controller/timer helper. Convert timeout and network failures into a recovery message that tells the user to retry the selection/upload.