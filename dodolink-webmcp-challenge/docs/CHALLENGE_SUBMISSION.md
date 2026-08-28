# Suggested submission copy

## What we built

**DodoLink Agent Shopping** gives browser agents a structured way to help
shoppers navigate a real Nigerian marketplace. Instead of scraping repetitive
listing cards and guessing which actions are safe, an agent can call typed
WebMCP tools to search products, discover local stores, compare prices, and
prepare a purchase plan.

The important part is the handoff. The agent's shortlist appears in the same
human-facing page, with product and seller review links. The shopper keeps
control before any seller is contacted or money moves.

## Why WebMCP is a strong fit

Marketplace data needs structured filtering and comparison, while
seller-authored content must be treated as untrusted. WebMCP lets DodoLink
expose a narrow capability surface with explicit JSON schemas instead of
asking an agent to scrape and click through a high-stakes flow.

## What was difficult before

An agent could describe a product, but it could not reliably distinguish
listing IDs, price limits, stock, seller context, and review links. The
WebMCP tools make those capabilities explicit and return bounded public data.
The plan tool then turns agent work into a visible human approval step.

## Safety boundary

Every tool is read-only. There is intentionally no WebMCP payment, checkout,
or seller-message action. The shopper opens existing DodoLink review pages and
decides whether to continue.

## Submission links

- Live URL: https://dodolink.com.ng/agent
- Public source: https://github.com/Al-hassanSulaiman/dodolink-webmcp-challenge
- Demo video: replace with the public YouTube URL