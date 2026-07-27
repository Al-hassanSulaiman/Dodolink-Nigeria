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

## finalize() is REQUIRED after every `status === "complete"`

The future `useSignIn()`/`useSignUp()` hooks have **no `setActive`** — a guard like `if (setActive)` silently skips activation. After `signIn.password()` or `signUp.verifications.verifyEmailCode()` reaches `status === "complete"`, you MUST `await resource.finalize()` before navigating, or the session exists server-side but the app never activates it (symptom: sign-in "stops" on the form; going back later shows the user already signed in).

**How to apply:** every completion path (password sign-in, email-code sign-up, password reset) ends with `finalize()`; ignore a `session_exists` finalize error, surface others via `errors[0].longMessage ?? longMessage ?? message`.

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

## needs_client_trust — Replit iframe sandbox blocks ALL navigation

Clerk dev instances always return `needs_client_trust` on first sign-in. Fixing it requires a redirect round-trip to Clerk's FAPI (`/v1/client/sync`). **The Replit preview iframe blocks every navigation method:**

- `location.href = externalUrl` → "cannot set location.href"
- `window.open(url, '_blank')` → "window.open is not an option" (sandbox blocks popups)
- `<a target="_blank">` → also blocked

**The only working solution for dev testing:** Open the Expo app URL directly in a new browser tab (not inside the Replit iframe). In a standalone tab, Clerk's dev browser sync completes automatically on first load. localStorage is shared between the standalone tab and the Replit iframe (same origin), so signing in there sets the JWT for both contexts.

The sign-in page now shows a "One-time setup required" screen when `needs_client_trust` is returned, displaying the app URL with a copy button and an `<a>` link attempt.

**Why `finalize()` doesn't work either:** `createdSessionId` is null under `needs_client_trust` status — the session hasn't been created yet.

**For production Clerk keys (pk_live_*):** `needs_client_trust` never occurs. Auth works normally everywhere.

## Future hooks have NO isLoaded — only fetchStatus

`useSignIn()`/`useSignUp()` (Core v3 future hooks) expose `fetchStatus: 'idle' | 'fetching'` but **no `isLoaded`** (that's a `useAuth()`/`useUser()` property). Destructuring `isLoaded` yields `undefined`, so a guard like `if (!isLoaded) return;` **always returns early and silently bricks the submit handler** — the button just does nothing. Guard with local `submitting` state and/or `fetchStatus === "fetching"` instead.

## status === "complete" needs a recovery path

Once `signUp.status === "complete"`, the resource stays complete even if `finalize()` fails (network blip). Any render branch keyed on `status === "complete"` must not be an unconditional spinner or `return null` — track finalize failure in state and show a "Try again" button that re-calls `signUp.finalize()`, or the user is trapped on a dead screen with a verified email and no session.

## errors.global is an ARRAY

`useSignIn()/useSignUp().errors.global` is `ClerkError[]`, not a single error. Rendering `errors.global.message` shows blank. Guard with `!!errors.global?.length` and render `errors.global[0]?.longMessage ?? errors.global[0]?.message`.

Also: `useAuth()` returns only userId/sessionId/getToken — it has NO `user` object. For email/profile use `useUser()` (`user.primaryEmailAddress.emailAddress`).

## useUserIdentity → Clerk

Replace the random-UUID hook with `useUser()` from `@clerk/expo`. Return `user.id`, derive `userName` from fullName / firstName+lastName / email prefix.
