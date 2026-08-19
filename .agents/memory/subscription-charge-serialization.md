---
name: Subscription charge serialization
description: Rules for safely charging a store subscription through Paystack from manual and scheduled paths.
---

All renewal charge paths — manual seller-initiated charging and the scheduled automatic worker — must use the same per-store, database-backed serialization gate and a shared reconcile → reserve → charge routine. Before making a new Paystack charge, reconcile every unconsumed attempt for that store by its exact reference.

**Why:** A unique reference only deduplicates one attempt. If the manual flow and auto worker use different references without a shared lock, they can both charge a saved authorization for the same renewal period. Timeouts are ambiguous: deleting or ignoring their reservation can turn a retry into a double charge.

**How to apply:** Hold the store-scoped PostgreSQL advisory lock throughout reconciliation, reservation, the bounded Paystack request, and same-reference verification. Treat a verified success as settled; only release/retry an attempt when Paystack definitively reports it never completed; retain and block on genuinely inconclusive verification. Scheduled runs must reconcile their own deterministic reference from an earlier timed-out run rather than merely skipping a reservation conflict.