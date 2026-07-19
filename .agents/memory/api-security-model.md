---
name: API security model
description: Auth/ownership rules for the Dodolink API and the Paystack verify hardening pattern
---

# API security model (decided during pre-launch audit, July 2026)

**Rule:** Public reads, authenticated writes. GET stores/products/search/reviews stay open; every write and every conversation route requires a Clerk bearer token (`requireUser` in the API server) plus an ownership/participant check. Identity fields in request bodies (ownerUserId, senderId, reviewerId, userId) are never trusted — always overridden or matched against the authenticated user.
**Why:** The mobile/admin clients attach tokens automatically via the generated API client, so hardening cost nothing client-side; open reads keep the marketplace browsable without sign-in.

**Paystack subscription verify must check three things** beyond `status === "success"`: amount equals the subscription fee (and currency NGN), reference starts with `dodolink_sub_<storeId>_`, and the timestamp embedded in the reference is newer than `subscriptionLastPaidAt` (replay protection with no schema change — a consumed reference was always generated before the verify that set lastPaidAt).
**Why:** Without these, any successful transaction of any amount on the Paystack account could activate/renew any store's subscription forever.

**GET /stores?ownerUserId=X intentionally bypasses the visibility filter** and returns only X's stores, including hidden past-due ones.
**Why:** Owners of hidden stores must still reach their store on the subscription screen to pay and restore visibility; the OR-with-visibility variant silently locked owners out once >20 stores existed (default limit).

**How to apply:** Any new route follows public-read/authed-write; any new payment flow needs amount + reference-binding + replay checks; client screens that look up "my store" must pass the ownerUserId filter (with matching orval queryKey).
