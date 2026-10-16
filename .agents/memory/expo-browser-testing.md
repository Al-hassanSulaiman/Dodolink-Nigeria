---
name: Expo browser testing URLs
description: Give browser testers an explicit verified Expo development URL rather than assuming environment inheritance.
---

Pass the actual Expo development preview URL to browser testers.

**Why:** The test runtime lacked the Expo domain environment variable even though the managed Expo workflow was running and the screenshot tool could resolve its preview. Providing the verified URL allowed the protected-flow test to proceed.

**How to apply:** Obtain the current URL from an app-preview capture or the managed workflow. Include it directly in the test plan. Do not substitute a production domain or assume the test runtime inherits the main agent's environment.

Keep signed-in browser flows on the development host where the sanctioned Clerk helper established its session.

**Why:** The helper authenticated on the same-project non-Expo development host. Switching to the separate Expo subdomain lost the session; returning to the helper-established host restored the intended test flow.

**How to apply:** Allow the helper's same-project development-host redirect when the app renders there, and avoid switching origins during authenticated tests. This is not a reason to use production or alter authentication settings.
