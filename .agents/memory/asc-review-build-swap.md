---
name: ASC review build swap
description: How to swap the build on an App Store review submission via the ASC API
---
You cannot PATCH an appStoreVersion's build while it is WAITING_FOR_REVIEW (409 INVALID_STATE).

**How to apply:** 1) PATCH the active reviewSubmission with `{canceled:true}` → version becomes DEVELOPER_REJECTED; 2) wait ~30s (state propagates asynchronously — immediate retries still 409); 3) PATCH `/v1/appStoreVersions/{id}/relationships/build` with the new build; 4) create (or reuse READY_FOR_REVIEW) reviewSubmission + reviewSubmissionItem; 5) PATCH submission `{submitted:true}`.

**Why:** cancelling does NOT lose metadata/review info; resubmitting keeps the queue place fresh but all listing data intact.
