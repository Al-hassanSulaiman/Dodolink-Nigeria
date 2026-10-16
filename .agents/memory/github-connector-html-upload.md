---
name: GitHub connector HTML upload filter
description: GitHub connector HTML filtering and the separate workspace request-rate limit.
---

GitHub connector API writes may return a Replit Cloudflare 403 for HTML file payloads even when repository creation and JavaScript, CSS, Markdown, and license uploads work normally. Changing between Contents, Git Data, GraphQL, and the connector SDK may hit the same filter.

**Why:** The filtering occurs at the connector boundary rather than GitHub authorization. Repeatedly retrying the same HTML through another GitHub API route does not fix it, while native Git push may lack a shell credential despite the connector being authorized.

**How to apply:** Keep the repository auditable and functional by serving a small page shell generated from a normal server module, with UI logic and styles in separate readable source files. Validate through an unauthenticated clone-and-run test.

## Workspace gateway request limits

Bulk connector requests must stay below the workspace gateway's request-rate limit, not only GitHub's remaining API quota.

**Why:** Git Data uploads returned HTTP 429 with an explicit `11/10 RPS for repl` error while GitHub still had thousands of requests available. A smaller parallel batch still exceeded the rolling limit when combined with nearby reads.

**How to apply:** Serialize bulk requests or use a shared rate limiter with room for concurrent calls; around three requests per second worked. Honor `Retry-After`. Use the connector's initialized SDK when available and do not interpret gateway throttling as missing repository credentials.