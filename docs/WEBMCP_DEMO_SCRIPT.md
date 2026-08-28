# DodoLink Agent Shopping — Demo Script

Target duration: 2 minutes 35 seconds.

## 0:00–0:18 — The problem

**On screen:** Open DodoLink's normal marketplace, then navigate to `/agent`.

**Narration:**  
"Online shopping agents usually scrape pages and guess what each card or
button means. That is brittle everywhere, and especially risky in a local
marketplace where listings are seller-authored and the final action may contact
a real person or move money."

## 0:18–0:38 — Show the WebMCP surface

**On screen:** Point to `WebMCP Protocol: Active`, then reveal the four
registered `dodolink_*` tools in the testing extension.

**Narration:**  
"DodoLink now exposes four typed WebMCP tools directly in the browser: search
products, discover stores, compare products, and prepare a purchase plan. The
agent uses structured capabilities instead of scraping the interface."

## 0:38–1:12 — Search real marketplace data

**Agent request:**  
"Find in-stock smartphones under two hundred thousand Naira. Prefer credible
sellers."

**On screen:** Run `dodolink_search_products` and briefly highlight product
IDs, prices, stock, seller status, and review URLs.

**Narration:**  
"This is DodoLink's existing public marketplace data, not a challenge-only mock
catalog. The response is bounded, structured, and contains only the public
fields the agent needs."

## 1:12–1:38 — Compare options

**On screen:** Pass two returned IDs to `dodolink_compare_products`.

**Narration:**  
"The agent compares the exact listings by price, availability, category, and
seller, and calculates the price spread. It does not decide or buy."

## 1:38–2:10 — Agent-to-human handoff

**On screen:** Run `dodolink_prepare_purchase_plan` with the same request,
budget, and priorities. Show the visible shortlist appearing on the `/agent`
page.

**Narration:**  
"This is the key collaboration. The agent's structured result becomes a
visible purchase plan for the shopper. The user can inspect every shortlisted
product and supplier before continuing."

## 2:10–2:30 — Prove the safety boundary

**On screen:** Open one product review page. Briefly show the existing
human-controlled seller chat or checkout entry point.

**Narration:**  
"All WebMCP tools are read-only. There is deliberately no tool for payment,
checkout, or sending a seller message. Those existing DodoLink actions remain
under explicit human control."

## 2:30–2:35 — Close

**On screen:** Return to the purchase plan and DodoLink wordmark.

**Narration:**  
"DodoLink gives agents tools, gives shoppers context, and keeps people in
control."