---
name: Orval query keys are URL-based
description: Hand-written React Query keys like ['listStores'] silently never match; always use generated get*QueryKey helpers for invalidation.
---

Orval-generated hooks in `@workspace/api-client-react` use **URL-based** query keys, e.g. `['/api/stores']`, `['/api/stores/5/products']` — NOT operation names.

**Rule:** In every mutation `onSuccess`, invalidate with the generated helpers (`getListStoresQueryKey()`, `getGetStoreQueryKey(id)`, etc.), never hand-written strings.

**Why:** Keys like `['listStores']` or `['getStore', id]` are silent no-ops — the mutation succeeds but every screen keeps stale data. This exact bug appeared in five separate places (store edit, store avatar upload, product delete, review create, store create) during the July 2026 audit.

**How to apply:** Parameterless helpers (`getListProductsQueryKey()`) prefix-match all parametrized variants under React Query's default matching, so they're safe for "invalidate all lists". Note keys are single-string elements: invalidating `['/api/stores']` does NOT match `['/api/stores/5/products']` — use the specific helper for nested routes.
