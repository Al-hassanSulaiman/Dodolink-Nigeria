---
name: Account-deletion media safety
description: Why legacy upload ownership cannot be inferred from attachment URLs, and why active upload links delay cleanup.
---
Legacy uploads were issued without a trustworthy uploader ownership record. Never infer file ownership merely from a URL saved in a store, product, or message.

**Why:** Attachment URLs are client-controlled and may reference another person's file. Account deletion must not erase somebody else's media. Presigned upload links also remain usable after sign-out and can recreate a file if cleanup finishes before those links expire.

**How to apply:** Trust server-recorded issuance provenance for new uploads; keep unverified legacy cleanup pending for ownership review rather than claiming it is complete. Allow outstanding upload links to expire, then perform the final media sweep before reporting completion.
