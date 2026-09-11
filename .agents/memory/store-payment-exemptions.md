---
name: Store payment exemptions
description: Required semantics for admin-granted store availability without subscription payment.
---

An admin-granted payment exemption keeps a store public and prevents automatic subscription enforcement. It must not fake a payment or rewrite payment history. Manual payment remains available if the owner chooses.

**Why:** The exemption is intended as a revocable courtesy: selected stores should remain available and should not be automatically charged, reminded to renew, or marked past due while exempt. Explicit admin hiding must remain the strongest visibility control.

**How to apply:** Evaluate explicit admin hiding first, then exemptions, then normal subscription and grace-period rules. Exclude exempt stores from automatic charges, renewal reminders, and automatic expiry. Keep manual payment optional and all public store/product paths consistent with the visibility precedence.