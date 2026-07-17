---
name: Clerk Expo SDK 54 setup
description: Core v3 API patterns for custom auth screens, forgot-password flow using SignInFutureResource, and Metro crash workaround after @clerk/expo install.
---

## Install

```bash
pnpm --filter @workspace/<expo-app> add -D @clerk/expo expo-auth-session@~7.0.10 expo-secure-store@~15.0.8 expo-crypto@~15.0.8
# expo-web-browser@~15.0.10 already present in this project
```

**Why:** SDK 54 requires pinned expo-* peer deps. expo-web-browser was already installed.

## Metro ENOENT crash after install

After installing `@clerk/expo`, Metro crashes with `ENOENT: no such file or directory, watch '.../@clerk/expo_tmp_XXXX/android'`. This is a postinstall temp dir that gets cleaned up. **Fix: just restart the expo workflow** — the temp dir is gone, Metro starts clean.

## dev script patch

In `package.json`, prepend to dev script:
```
EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=$CLERK_PUBLISHABLE_KEY
```

**Why:** Expo's EXPO_PUBLIC_* vars must be set at Metro startup, not at runtime.

## Root layout wiring

```tsx
import { ClerkProvider, ClerkLoaded } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";

const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY!;
const proxyUrl = process.env.EXPO_PUBLIC_CLERK_PROXY_URL || undefined;
// proxyUrl is empty in dev (intentional), auto-populated in prod

// Wrap root return:
<ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache} proxyUrl={proxyUrl}>
  <ClerkLoaded>
    {/* rest of app */}
  </ClerkLoaded>
</ClerkProvider>
```

## Auth guard (tabs layout)

```tsx
import { useAuth } from "@clerk/expo";
import { setAuthTokenGetter } from "@workspace/api-client-react";

const { isSignedIn, isLoaded, getToken } = useAuth();
useEffect(() => { setAuthTokenGetter(() => getToken()); }, [getToken]);
if (!isLoaded) return null;
if (!isSignedIn) return <Redirect href="/(auth)/sign-in" />;
```

**Why:** Mobile has no browser cookie jar; must attach Bearer token explicitly via setAuthTokenGetter.

## Core v3 forgot-password flow (SignInFutureResource)

```ts
// Step 1: initiate
await signIn.create({ identifier: emailAddress });
// Step 2: send code
await signIn.resetPasswordEmailCode.sendCode();
// Step 3: verify code → status becomes 'needs_new_password'
await signIn.resetPasswordEmailCode.verifyCode({ code });
// Step 4: submit new password → status becomes 'complete'
await signIn.resetPasswordEmailCode.submitPassword({ password, signOutOfOtherSessions: true });
// Step 5: finalize session
await signIn.finalize({ navigate: ... });
```

**Why:** Core v3 `SignInFutureResource` uses method-based API (signIn.password(), signIn.resetPasswordEmailCode.*) instead of v2's strategy-based create/prepareFirstFactor/attemptFirstFactor.

## finalize() navigate callback — always use router.replace

In the `signIn.finalize()` and `signUp.finalize()` `navigate` callback, always use `router.replace("/(tabs)")` directly. Do NOT use `decorateUrl + location.assign`:

```ts
await signIn.finalize({
  navigate: () => { router.replace("/(tabs)" as Href); },
});
```

**Why:** `decorateUrl("/")` returns a full `https://` Clerk handshake URL. Calling `globalThis.location.assign(url)` inside the Replit preview iframe navigates the iframe away to the Clerk redirect URL, which gets lost instead of landing back in the SPA. Since Clerk already stores the session token in JS/localStorage before `finalize` is called, a plain `router.replace` is sufficient — the auth guard (`isSignedIn`) will be true immediately on the next render.

## useUserIdentity → Clerk

Replace the random-UUID hook with `useUser()` from `@clerk/expo`. Return `user.id`, derive `userName` from fullName / firstName+lastName / email prefix.
