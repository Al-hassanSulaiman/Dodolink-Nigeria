# DodoLink

DodoLink is a Nigerian local marketplace for discovering products and stores,
reviewing seller credibility, chatting with sellers, and completing
human-controlled purchases.

## DodoLink Agent Shopping

The web app exposes four browser-native
[WebMCP](https://developer.chrome.com/docs/ai/webmcp) tools:

- `dodolink_search_products` searches real public marketplace listings.
- `dodolink_discover_stores` finds stores by category, location, verification,
  and rating.
- `dodolink_compare_products` compares two to six real products.
- `dodolink_prepare_purchase_plan` builds a shortlist and displays it on the
  `/agent` page for human review.

All four tools are read-only. They cannot make a payment, start checkout, or
send a seller message. Product and store descriptions are explicitly marked as
untrusted tool content.

Open the judge-facing experience at:

```text
/agent
```

The page remains useful as a normal marketplace assistant when WebMCP is not
available. WebMCP registration is guarded to web only, so the existing iOS and
Android apps are unchanged.

## Run on Replit

This repository is a pnpm workspace. Configure the documented Replit
environment variables and secrets without committing their values, then run
the existing workflows:

```bash
pnpm install
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/dodolink-ng run dev
```

The web client uses DodoLink's existing public products and stores APIs. No
sample catalog is created for the challenge.

## Test WebMCP

WebMCP is currently an experimental Chrome API.

1. Use the challenge's WebMCP-enabled browser, or a current Chromium build with
   `chrome://flags/#enable-webmcp-testing` enabled.
2. Open `/agent`.
3. Confirm the header shows `WebMCP Protocol: Active`.
4. Inspect the four registered tools with the WebMCP testing extension or
   `await document.modelContext.getTools()` in DevTools.
5. Execute `dodolink_prepare_purchase_plan` with:

   ```json
   {
     "query": "Find an in-stock smartphone under ₦200,000",
     "budget": 200000,
     "priorities": ["price", "seller verification"]
   }
   ```

6. Confirm the returned JSON contains only public listing summaries and review
   URLs, and that the same shortlist appears visibly on the page.
7. Open a product review URL and confirm the human retains control of seller
   chat and checkout.

More implementation, safety, and submission details are in
[`docs/WEBMCP_CHALLENGE.md`](docs/WEBMCP_CHALLENGE.md).

## License

MIT. See [`LICENSE`](LICENSE).