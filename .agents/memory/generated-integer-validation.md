---
name: Generated integer validation
description: OpenAPI integer declarations are not sufficient proof of integral request validation.
---

Treat generated request validators as something to verify, not proof that every OpenAPI constraint is enforced.

**Why:** Orval 8 generated number bounds for an integer array without enforcing integral values. A fractional message ID passed request validation and reached PostgreSQL as an invalid integer parameter.

**How to apply:** For integer identifiers, explicitly enforce integrality and the database's supported range before querying. Include fractional, string, negative, and out-of-range identifiers in boundary tests. Do not weaken those tests to match generated behavior.
