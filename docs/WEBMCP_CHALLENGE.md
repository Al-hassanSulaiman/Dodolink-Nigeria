# DodoLink Agent Shopping — WebMCP Challenge

## Submission copy

**DodoLink Agent Shopping** turns a real Nigerian marketplace into a structured
shopping surface for AI agents. Instead of scraping cards and guessing which
buttons to click, an agent receives browser-native WebMCP tools to search live
products, discover credible local stores, compare prices, and prepare a
purchase plan.

The key interaction is collaborative: when the agent prepares a plan, the same
shortlist appears in DodoLink's visible `/agent` experience. The shopper can
then inspect product and seller pages before choosing whether to continue.
DodoLink never lets the agent silently pay, start checkout, or send an
irreversible seller message.

This is not a mock catalog or a chatbot wrapper. The tools use DodoLink's
existing public marketplace APIs and real listings, while the existing native
apps, authentication, payments, seller tools, chat, and notifications remain
unchanged.

## Links

- Live app: https://dodolink.com.ng/agent
- Source repository: https://github.com/Al-hassanSulaiman/Dodolink-Nigeria
  (currently not reachable to unauthenticated visitors; make it public before
  submission)
- Demo video: `[VIDEO_URL]`

Replace the video placeholder and confirm the source repository is public
before submission.

## Why WebMCP matters here

Marketplace pages are especially difficult for a general browser agent:
listings are visually repetitive, descriptions are seller-authored, prices
need structured comparison, and the final action can move money or contact a
real person. WebMCP gives the agent a small, typed capability surface while
keeping risky actions outside that surface.

The implementation uses the imperative browser API:

```ts
await document.modelContext.registerTool(
  {
    name: "dodolink_search_products",
    description: "Search real public DodoLink marketplace listings...",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        maxPrice: { type: "number", minimum: 0 }
      },
      required: ["query"],
      additionalProperties: false
    },
    execute: async (input, { signal }) => {
      // Reads DodoLink's existing public marketplace API.
    }
  },
  { signal: controller.signal }
);
```

Each registration is tied to an `AbortController`, and each network call
receives the execution cancellation signal.

## Tool contract

### `dodolink_search_products`

Searches real products with optional category, Naira price limits, stock
filtering, and result limit. Natural-language keywords are matched against
product name, category, store name, and description.

### `dodolink_discover_stores`

Discovers stores by keywords, category, Nigerian location, verification
status, rating, and result limit.

### `dodolink_compare_products`

Loads two to six products by ID and returns a price-ordered comparison,
including stock, seller, price spread, and human review URLs.

### `dodolink_prepare_purchase_plan`

Builds a shortlist from the shopper's request, optional Naira budget, and
priorities. It dispatches the plan to the visible `/agent` page so the agent's
work is inspectable before the shopper acts.

## Safety and trust

- Every challenge tool is annotated `readOnlyHint: true`.
- Seller-authored product and store fields are annotated
  `untrustedContentHint: true`.
- Tool output omits owner IDs, phone numbers, authentication data, and payment
  data.
- Inputs are constrained with JSON Schema and validated again at execution.
- Result limits prevent unbounded catalog output.
- Tools expose review URLs, not payment or messaging mutations.
- Checkout, payment, and seller communication stay in existing human-operated
  DodoLink flows.
- WebMCP code runs only when `Platform.OS === "web"` and
  `document.modelContext` exists.

## Evaluation checklist

1. Open the live `/agent` URL in a WebMCP-enabled browser.
2. Confirm all four `dodolink_*` tools are registered.
3. Run product search with a natural-language request and a budget.
4. Pass two returned product IDs to product comparison.
5. Run purchase-plan preparation and confirm the visible page updates.
6. Inspect the returned review links.
7. Confirm there is no WebMCP payment, checkout, or seller-message tool.
8. Open the normal iOS or Android app and confirm existing behavior is
   unchanged.

## References

- [Chrome WebMCP overview](https://developer.chrome.com/docs/ai/webmcp)
- [Chrome imperative API](https://developer.chrome.com/docs/ai/webmcp/imperative-api)
- [WebMCP draft specification](https://webmachinelearning.github.io/webmcp)