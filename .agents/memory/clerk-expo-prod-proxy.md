---
name: Clerk proxy URL must be baked into Expo production builds
description: Why the published Expo web app blank-screens if EXPO_PUBLIC_CLERK_PROXY_URL isn't forwarded at export time, and the domain-rebase pattern for custom domains
---

# Clerk proxy URL in Expo production builds

**Rule:** Every `expo export` / Metro bundle build in the deployment build script must receive `EXPO_PUBLIC_CLERK_PROXY_URL` (constructed as `https://${deployDomain}${CLERK_PROXY_URL}`). There are multiple bake sites (web export AND the Metro instance that produces native bundles) — forwarding Clerk env in only one leaves the others broken.

**Why:** With a `pk_live` key and no proxyUrl, Clerk derives its frontend API as `clerk.<custom-domain>`, which has no DNS record. Clerk never loads, and since the root layout wraps the whole app in `<ClerkLoaded>`, production renders a permanent blank white screen (HTML 200, bundle loads, nothing paints). Diagnosed July 2026 on the published custom-domain site.

**How to apply:**
- On web in production, rebase the baked proxy URL's pathname onto `window.location.origin` (same pattern as `getApiBase()`): the baked domain is `REPLIT_INTERNAL_APP_DOMAIN` (.replit.app), but users visit the custom domain — a same-origin proxy URL keeps Clerk cookies first-party. Native keeps the full baked URL.
- Server side: `clerkMiddleware` should resolve the publishable key per request host (`publishableKeyFromHost(getClerkProxyHost(req))`), not the bare env key, so both the .replit.app and custom domains authenticate.
- The server Clerk proxy no-ops outside production, so `/api/__clerk/*` returning 404 in dev is expected, not a bug.
- Fixes to the build script only take effect after republishing — the export runs at deploy time.
