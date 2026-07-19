---
name: Clerk API auth requires explicit bearer token in ALL clients
description: Session cookies never authenticate API requests here; every client (web dashboards too, not just Expo) must call setAuthTokenGetter(getToken).
---

**Rule:** Every client of the API server — Expo app AND web apps like the admin dashboard — must register `setAuthTokenGetter(() => getToken())` (from `@workspace/api-client-react`) inside the ClerkProvider tree. The server's `getAuth(req)` only sees the `Authorization: Bearer` header.

**Why:** The comment in custom-fetch.ts says web apps don't need the token getter because "session cookies are sent automatically" — that is WRONG in this environment. The admin dashboard was signed in via Clerk but every `/api/admin/*` request returned 401 because no cookie reached the server (Replit proxy/iframe + Clerk dev-instance proxy setup). Symptom: admin dashboard looked logged in but showed no data / "Failed to load".

**How to apply:** Add a small bridge component inside ClerkProvider + QueryClientProvider that calls `setAuthTokenGetter(() => getToken())` in an effect, and invalidates all queries once `isSignedIn` becomes true (so 401-cached queries refetch). See admin-dashboard App.tsx `AuthTokenBridge`.

Also note: server 401 = no/invalid token; 403 = valid user but email not in the ADMIN_EMAILS allowlist in api-server routes/admin.ts.
