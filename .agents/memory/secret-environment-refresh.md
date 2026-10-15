---
name: Secret environment refresh
description: Distinguishing invalid secret input from a running process retaining an older environment value.
---

When a secure secret edit is followed by the same format-validation failure, do not assume the user saved the same invalid value. Secret-existence metadata does not prove that an existing shell received the latest value.

**Why:** Replit's documentation says existing shells and processes may retain old environment values after a secret is edited. This can make repeated secure-form requests unproductive.

**How to apply:** Check only format booleans, never secret contents. Consult the current secret-refresh guidance and coordinate a workspace compute restart when needed before requesting the same credential again. Do not claim that stale environment is the cause until a refreshed process confirms it.
