---
name: Web API base URL dev vs prod
description: Why the Expo web app must not use window.location.origin as API base in development
---

Rule: on web, use `window.location.origin` as the API base **only in production builds** (`!__DEV__`); in dev, use the baked `EXPO_PUBLIC_DOMAIN`.

**Why:** The dev web preview is served from the Expo dev domain (`REPLIT_EXPO_DEV_DOMAIN`), which bypasses the shared proxy — `/api` does not route there. In production, web app and API share one origin (any domain pointed at the deployment, e.g. dodolink.com.ng), so origin is always right and no domain is hardcoded.

**How to apply:** Centralized in `getApiBase()` (utils/apiBase.ts in the Expo app). Any new fetch site should use it (or the generated client, which gets it via `setBaseUrl`) instead of building URLs from `EXPO_PUBLIC_DOMAIN` directly.

Related: `EXPO_PUBLIC_*` vars are baked at bundle time — they must be set in the env of `expo export`/Metro start, not read at runtime. Deployment env auto-populates `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`; build script also maps it defensively from `CLERK_PUBLISHABLE_KEY`.
