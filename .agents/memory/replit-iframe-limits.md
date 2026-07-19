---
name: Replit iframe sandbox limits
description: Browser APIs that silently fail inside the Replit preview iframe, and the workarounds used in this project.
---

## What the Replit preview iframe blocks

The preview pane is a sandboxed `<iframe>`. These APIs fail silently or throw:

- `Alert.alert` / `window.alert` / `window.confirm` — sandbox blocks JS dialogs; the call returns immediately with no UI shown and no callback fired
  - **Bigger issue:** `Alert.alert` is a no-op on react-native-web EVERYWHERE, not just the iframe — including the production website. Use `utils/alerts.ts` (`showAlert`/`confirmAlert`), which falls back to `window.alert`/`window.confirm` on web. Those work on the production domain; only inside the Replit preview iframe do they stay silent.
- `window.open(url, '_blank')` — popup blocked by sandbox
- `location.href = externalUrl` — "cannot set location.href" error
- `<a target="_blank">` — link navigation blocked
- `FontFaceObserver` — font-load CSS event never fires inside the sandbox, causing the default 6 s timeout to trigger

**Why:** The Replit preview iframe has a strict `sandbox` attribute that disallows modals, popups, and certain cross-origin navigations.

## Workarounds applied in this project

| Blocked API | Workaround |
|---|---|
| `Alert.alert` for logout confirmation | Removed confirmation; call `signOut()` directly on press |
| `window.open` for Clerk trust sync | Show a copy-URL screen with a `<a>` link and clipboard copy button |
| `FontFaceObserver` timeout | Load fonts via local `require('../assets/fonts/*.ttf')` instead of `@expo-google-fonts/inter`; Metro serves them as bundled assets, no CSS observer needed |

## How to apply

Whenever a button or action does nothing in the Replit preview but works in a standalone tab, check whether it calls `Alert.alert`, `window.open`, or `window.confirm`. Replace with in-app state UI or direct action.

**Why these work in standalone tabs:** Opening the Expo URL directly (`https://<repl>.expo.worf.replit.dev`) bypasses the iframe sandbox entirely — all browser APIs work normally.
