const configuredBase = globalThis.__DODOLINK_API_BASE__ || "https://dodolink.com.ng";
export const API_BASE = configuredBase.replace(/\/+$/, "");
export const APP_BASE = globalThis.__DODOLINK_APP_BASE__ || API_BASE;

async function getJson(path, signal) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { Accept: "application/json" },
    signal,
  });
  if (!response.ok) throw new Error(`DodoLink API returned ${response.status}.`);
  return response.json();
}

export function listProducts({ limit = 100 } = {}, signal) {
  return getJson(`/api/products?limit=${Math.min(Math.max(limit, 1), 100)}`, signal);
}

export function listStores({ limit = 100 } = {}, signal) {
  return getJson(`/api/stores?limit=${Math.min(Math.max(limit, 1), 100)}`, signal);
}

export function getProduct(id, signal) {
  return getJson(`/api/products/${encodeURIComponent(id)}`, signal);
}

export function getStore(id, signal) {
  return getJson(`/api/stores/${encodeURIComponent(id)}`, signal);
}

const stopWords = new Set([
  "a", "an", "and", "at", "best", "buy", "for", "find", "from", "good",
  "i", "in", "is", "local", "me", "my", "need", "of", "option", "products",
  "reliable", "seller", "show", "store", "supplier", "the", "to", "under",
  "want", "with",
]);

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(query) {
  return [...new Set(normalize(query).split(" ").filter((token) => token.length > 1 && !stopWords.has(token)))];
}

function inferMaxPrice(query) {
  const normalized = String(query).replace(/,/g, "");
  const match = normalized.match(/(?:₦|ngn|under|below|up to)\s*(\d+(?:\.\d+)?)([km])?/i);
  if (!match) return null;
  const multiplier = match[2]?.toLowerCase() === "m" ? 1_000_000 : match[2]?.toLowerCase() === "k" ? 1_000 : 1;
  return Number(match[1]) * multiplier;
}

function score(product, queryTokens) {
  const text = normalize(`${product.name} ${product.category} ${product.storeName} ${product.description}`);
  return queryTokens.reduce((total, token) => total + (text.includes(token) ? 1 : 0), 0);
}

export async function searchProducts({ query, maxPrice, limit = 6 } = {}, signal) {
  const queryTokens = tokens(query);
  const priceLimit = maxPrice ?? inferMaxPrice(query);
  const products = await listProducts({ limit: 100 }, signal);
  const matches = products
    .map((product) => ({ product, score: score(product, queryTokens) }))
    .filter(({ product, score: matchScore }) =>
      (!queryTokens.length || matchScore > 0) &&
      product.inStock &&
      (priceLimit === null || product.price <= priceLimit),
    )
    .sort((a, b) => b.score - a.score || a.product.price - b.product.price)
    .slice(0, Math.min(Math.max(limit, 1), 12))
    .map(({ product }) => product);
  return { query, appliedMaxPrice: priceLimit, totalMatches: matches.length, products: matches };
}

export async function discoverStores({ query = "", location = "", verifiedOnly = false, limit = 6 } = {}, signal) {
  const queryTokens = tokens(`${query} ${location}`);
  const stores = await listStores({ limit: 100 }, signal);
  const matches = stores
    .filter((store) => {
      const text = normalize(`${store.name} ${store.category} ${store.location} ${store.description}`);
      return (!queryTokens.length || queryTokens.some((token) => text.includes(token))) &&
        (!verifiedOnly || store.verificationStatus === "verified");
    })
    .sort((a, b) => Number(b.verificationStatus === "verified") - Number(a.verificationStatus === "verified") || (b.avgRating || 0) - (a.avgRating || 0))
    .slice(0, Math.min(Math.max(limit, 1), 12));
  return { query, totalMatches: matches.length, stores: matches };
}

export async function compareProducts(productIds, signal) {
  const ids = [...new Set(productIds)].slice(0, 6);
  if (ids.length < 2) throw new Error("Provide at least two product IDs.");
  const products = await Promise.all(ids.map((id) => getProduct(id, signal)));
  const sorted = products.sort((a, b) => a.price - b.price);
  return {
    products: sorted,
    cheapestProductId: sorted[0].id,
    priceDifference: sorted.at(-1).price - sorted[0].price,
    humanAction: "Review the links before deciding. This tool cannot purchase, pay, or message a seller.",
  };
}

export async function preparePurchasePlan({ query, budget, priorities = [], limit = 5 } = {}, signal) {
  const result = await searchProducts({ query, maxPrice: budget, limit }, signal);
  const prices = result.products.map((product) => product.price);
  return {
    query,
    budget: budget ?? result.appliedMaxPrice,
    priorities,
    products: result.products,
    priceRange: prices.length ? { lowest: Math.min(...prices), highest: Math.max(...prices) } : null,
    explanation: result.products.length
      ? `Found ${result.totalMatches} in-stock listing${result.totalMatches === 1 ? "" : "s"} for this request.`
      : `No in-stock listing matched "${query}". Try broader terms or a different budget.`,
    humanApprovalRequired: true,
    humanNextStep: "Open a review link to inspect the seller and product. Only the human shopper can continue to chat or checkout.",
  };
}

export function productReviewUrl(id) {
  return `${APP_BASE}/product/${encodeURIComponent(id)}`;
}

export function storeReviewUrl(id) {
  return `${APP_BASE}/store/${encodeURIComponent(id)}`;
}