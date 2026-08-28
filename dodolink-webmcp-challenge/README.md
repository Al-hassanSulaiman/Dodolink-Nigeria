# DodoLink Agent Shopping — WebMCP Challenge

DodoLink Agent Shopping is a standalone, sanitized WebMCP challenge demo. It
lets a browser agent search a real Nigerian marketplace, discover stores,
compare listings, and prepare a purchase plan that a human reviews before
continuing.

This repository intentionally contains only the challenge web surface. It does
not contain DodoLink's private production monorepo, authentication internals,
admin tools, payments, push notification code, database credentials, or
private user data.

## Run locally

Requirements: Node.js 18 or newer. There are no npm dependencies.

```bash
npm run dev
```

Open `http://localhost:5173`.

The demo reads public marketplace data from `https://dodolink.com.ng`. To use
another public-compatible API origin during development, set
`globalThis.__DODOLINK_API_BASE__` before loading `src/app.js`. Only use a
public API origin; this demo must never receive credentials.

## Project structure

- `server.mjs` — dependency-free static server and the small page shell
- `src/webmcp.js` — imperative WebMCP tool registrations
- `src/api.js` — public marketplace queries and shortlist engine
- `src/app.js` — manual fallback and visible human-review handoff
- `styles.css` — responsive presentation
- `docs/CHALLENGE_SUBMISSION.md` — suggested submission explanation

## Test WebMCP

WebMCP is experimental. Use ChatGPT's WebMCP-enabled in-app browser, or enable
the testing flag in Chromium:

```text
chrome://flags/#enable-webmcp-testing
```

Open the page, confirm `WebMCP Protocol: Active`, and inspect the registered
tools with the WebMCP testing extension or:

```js
await document.modelContext.getTools()
```

The exact imperative registration requested by the challenge is in
`src/webmcp.js`:

```js
await document.modelContext.registerTool({
  name: "search_products",
  description: "Search the DodoLink public product catalog...",
  inputSchema: { /* structured JSON Schema */ },
  execute: async (input, { signal }) => { /* public read only */ }
});
```

## Available tools

- `search_products` — real in-stock listings with Naira price filtering
- `discover_stores` — public stores by keyword, location, and verification
- `compare_products` — two to six product IDs, sorted by price
- `prepare_purchase_plan` — updates this page with an inspectable shortlist

All tools are marked with `readOnlyHint: true` and
`untrustedContentHint: true`. They return curated public summaries and review
URLs. They cannot purchase, pay, start checkout, or send a seller message.

## Why this is separate from DodoLink's private repository

The challenge requires a public source repository, not disclosure of a private
production codebase. This repository is intentionally small enough to audit:
it has no secrets, no authentication credentials, no private business logic,
and no production database access. The live DodoLink app remains the source of
the public marketplace data.

## License

MIT. See [`LICENSE`](LICENSE).