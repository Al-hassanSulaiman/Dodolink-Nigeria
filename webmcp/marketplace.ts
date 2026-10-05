import {
  getProduct,
  listProducts,
  listStores,
  type Product,
  type Store,
} from "@workspace/api-client-react";

export const WEBMCP_PLAN_EVENT = "dodolink:webmcp-plan";
export const WEBMCP_STATUS_EVENT = "dodolink:webmcp-status";
export const WEBMCP_PLAN_STORAGE_KEY = "dodolink:webmcp:last-plan";

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "at",
  "best",
  "buy",
  "for",
  "find",
  "from",
  "good",
  "i",
  "in",
  "is",
  "local",
  "looking",
  "me",
  "my",
  "need",
  "of",
  "option",
  "options",
  "product",
  "products",
  "reliable",
  "seller",
  "show",
  "store",
  "supplier",
  "the",
  "to",
  "under",
  "want",
  "with",
]);

const SYNONYMS: Record<string, string[]> = {
  apparel: ["clothes", "clothing", "fashion", "wear"],
  clothes: ["apparel", "clothing", "fashion", "wear"],
  fashion: ["apparel", "clothes", "clothing", "wear"],
  honey: ["organic", "natural"],
  laptop: ["computer", "notebook"],
  mobile: ["phone", "smartphone"],
  phone: ["mobile", "smartphone"],
  smartphone: ["mobile", "phone"],
  wholesale: ["bulk", "supplier"],
};

export interface ProductSearchInput {
  query: string;
  category?: string;
  minPrice?: number;
  maxPrice?: number;
  inStockOnly?: boolean;
  limit?: number;
}

export interface StoreSearchInput {
  query?: string;
  category?: string;
  location?: string;
  verifiedOnly?: boolean;
  limit?: number;
}

export interface ProductSummary {
  id: number;
  name: string;
  storeId: number;
  storeName: string;
  category: string;
  description: string;
  price: number;
  inStock: boolean;
  reviewUrl: string;
}

export interface StoreSummary {
  id: number;
  name: string;
  category: string;
  description: string;
  location: string;
  verificationStatus: Store["verificationStatus"];
  averageRating: number | null;
  totalReviews: number;
  reviewUrl: string;
}

export interface ProductSearchResult {
  query: string;
  appliedMaxPrice: number | null;
  totalMatches: number;
  products: Product[];
  stores: Store[];
  productSummaries: ProductSummary[];
  storeSummaries: StoreSummary[];
}

export interface ProductComparison {
  comparedAt: string;
  products: ProductSummary[];
  cheapestProductId: number | null;
  lowestPrice: number | null;
  highestPrice: number | null;
  priceDifference: number | null;
  humanAction: string;
}

export interface PurchasePlan {
  query: string;
  budget: number | null;
  priorities: string[];
  generatedAt: string;
  products: Product[];
  stores: Store[];
  productSummaries: ProductSummary[];
  storeSummaries: StoreSummary[];
  priceRange:
    | {
        lowest: number;
        highest: number;
      }
    | null;
  explanation: string;
  humanApprovalRequired: true;
  humanNextStep: string;
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function queryTokens(query: string): string[] {
  const base = normalize(query)
    .split(" ")
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token) && !/^\d+$/.test(token));
  return Array.from(new Set(base.flatMap((token) => [token, ...(SYNONYMS[token] ?? [])])));
}

function inferBudget(query: string): number | null {
  const normalized = query.replace(/,/g, "");
  const explicitCurrency = normalized.match(/(?:₦|ngn)\s*(\d+(?:\.\d+)?)([km])?/i);
  const underAmount = normalized.match(
    /(?:under|below|less than|budget(?: of| is)?|up to)\s*(?:₦|ngn)?\s*(\d+(?:\.\d+)?)([km])?/i,
  );
  const match = explicitCurrency ?? underAmount;
  if (!match) return null;

  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  const multiplier = match[2]?.toLowerCase() === "m" ? 1_000_000 : match[2]?.toLowerCase() === "k" ? 1_000 : 1;
  return value * multiplier;
}

function scoreText(text: string, tokens: string[]): number {
  if (tokens.length === 0) return 1;
  const normalizedText = normalize(text);
  return tokens.reduce((score, token) => {
    if (normalizedText === token) return score + 8;
    if (normalizedText.startsWith(`${token} `)) return score + 5;
    return normalizedText.includes(token) ? score + 2 : score;
  }, 0);
}

function scoreProduct(product: Product, tokens: string[]): number {
  return (
    scoreText(product.name, tokens) * 3 +
    scoreText(product.category, tokens) * 2 +
    scoreText(product.storeName, tokens) +
    scoreText(product.description, tokens)
  );
}

function scoreStore(store: Store, tokens: string[]): number {
  return (
    scoreText(store.name, tokens) * 3 +
    scoreText(store.category, tokens) * 2 +
    scoreText(store.location, tokens) * 2 +
    scoreText(store.description, tokens)
  );
}

function clampLimit(limit: number | undefined, fallback: number, maximum: number): number {
  if (!Number.isFinite(limit)) return fallback;
  return Math.min(Math.max(Math.trunc(limit ?? fallback), 1), maximum);
}

function pageUrl(path: string): string {
  if (typeof window === "undefined") return path;
  return new URL(path, window.location.origin).toString();
}

function clip(value: string, length = 240): string {
  const trimmed = value.trim();
  return trimmed.length <= length ? trimmed : `${trimmed.slice(0, length - 1)}…`;
}

export function summarizeProduct(product: Product): ProductSummary {
  return {
    id: product.id,
    name: product.name,
    storeId: product.storeId,
    storeName: product.storeName,
    category: product.category,
    description: clip(product.description),
    price: product.price,
    inStock: product.inStock,
    reviewUrl: pageUrl(`/product/${product.id}`),
  };
}

export function summarizeStore(store: Store): StoreSummary {
  return {
    id: store.id,
    name: store.name,
    category: store.category,
    description: clip(store.description),
    location: store.location,
    verificationStatus: store.verificationStatus,
    averageRating: store.avgRating ?? null,
    totalReviews: store.totalReviews,
    reviewUrl: pageUrl(`/store/${store.id}`),
  };
}

export async function searchMarketplaceProducts(
  input: ProductSearchInput,
  signal?: AbortSignal,
): Promise<ProductSearchResult> {
  const query = input.query.trim();
  const tokens = queryTokens(query);
  const limit = clampLimit(input.limit, 5, 12);
  const maxPrice = input.maxPrice ?? inferBudget(query);
  const category = input.category ? normalize(input.category) : null;
  const [allProducts, allStores] = await Promise.all([
    listProducts({ limit: 100 }, { signal }),
    listStores({ limit: 100 }, { signal }),
  ]);

  const scored = allProducts
    .map((product) => ({ product, score: scoreProduct(product, tokens) }))
    .filter(({ product, score }) => {
      if (tokens.length > 0 && score === 0) return false;
      if (input.inStockOnly !== false && !product.inStock) return false;
      if (input.minPrice !== undefined && product.price < input.minPrice) return false;
      if (maxPrice !== null && maxPrice !== undefined && product.price > maxPrice) return false;
      if (category && !normalize(product.category).includes(category)) return false;
      return true;
    })
    .sort((a, b) => b.score - a.score || a.product.price - b.product.price);

  const products = scored.slice(0, limit).map(({ product }) => product);
  const storeIds = new Set(products.map((product) => product.storeId));
  const stores = allStores
    .filter((store) => storeIds.has(store.id))
    .sort((a, b) => {
      const verifiedDelta =
        Number(b.verificationStatus === "verified") - Number(a.verificationStatus === "verified");
      return verifiedDelta || (b.avgRating ?? 0) - (a.avgRating ?? 0);
    });

  return {
    query,
    appliedMaxPrice: maxPrice ?? null,
    totalMatches: scored.length,
    products,
    stores,
    productSummaries: products.map(summarizeProduct),
    storeSummaries: stores.map(summarizeStore),
  };
}

export async function discoverMarketplaceStores(
  input: StoreSearchInput,
  signal?: AbortSignal,
): Promise<{ totalMatches: number; stores: Store[]; storeSummaries: StoreSummary[] }> {
  const stores = await listStores(
    { category: input.category, limit: 100 },
    { signal },
  );
  const tokens = queryTokens(input.query ?? "");
  const location = input.location ? normalize(input.location) : null;
  const limit = clampLimit(input.limit, 5, 12);
  const scored = stores
    .map((store) => ({ store, score: scoreStore(store, tokens) }))
    .filter(({ store, score }) => {
      if (tokens.length > 0 && score === 0) return false;
      if (input.verifiedOnly && store.verificationStatus !== "verified") return false;
      if (location && !normalize(store.location).includes(location)) return false;
      return true;
    })
    .sort((a, b) => {
      const verifiedDelta =
        Number(b.store.verificationStatus === "verified") -
        Number(a.store.verificationStatus === "verified");
      return verifiedDelta || b.score - a.score || (b.store.avgRating ?? 0) - (a.store.avgRating ?? 0);
    });
  const selected = scored.slice(0, limit).map(({ store }) => store);

  return {
    totalMatches: scored.length,
    stores: selected,
    storeSummaries: selected.map(summarizeStore),
  };
}

export async function compareMarketplaceProducts(
  productIds: number[],
  signal?: AbortSignal,
): Promise<ProductComparison> {
  const uniqueIds = Array.from(new Set(productIds)).slice(0, 6);
  if (uniqueIds.length < 2) {
    throw new Error("Provide at least two different product IDs to compare.");
  }

  const products = await Promise.all(uniqueIds.map((id) => getProduct(id, { signal })));
  const sorted = [...products].sort((a, b) => a.price - b.price);
  const lowest = sorted[0]?.price ?? null;
  const highest = sorted.at(-1)?.price ?? null;

  return {
    comparedAt: new Date().toISOString(),
    products: sorted.map(summarizeProduct),
    cheapestProductId: sorted[0]?.id ?? null,
    lowestPrice: lowest,
    highestPrice: highest,
    priceDifference: lowest === null || highest === null ? null : highest - lowest,
    humanAction:
      "Review the product links and seller details before deciding. This comparison cannot purchase, pay, or message a seller.",
  };
}

export async function createPurchasePlan(
  input: {
    query: string;
    budget?: number;
    priorities?: string[];
    limit?: number;
  },
  signal?: AbortSignal,
): Promise<PurchasePlan> {
  const budget = input.budget ?? inferBudget(input.query);
  const result = await searchMarketplaceProducts(
    {
      query: input.query,
      maxPrice: budget ?? undefined,
      inStockOnly: true,
      limit: input.limit ?? 5,
    },
    signal,
  );
  const prices = result.products.map((product) => product.price);
  const explanation =
    result.products.length > 0
      ? `Found ${result.totalMatches} matching in-stock listing${result.totalMatches === 1 ? "" : "s"}${budget ? ` within a ₦${budget.toLocaleString("en-NG")} budget` : ""}. The shortlist favors relevance, then lower price.`
      : `No in-stock listing matched "${input.query}"${budget ? ` within a ₦${budget.toLocaleString("en-NG")} budget` : ""}. Try broader product terms or a different budget.`;

  return {
    query: input.query.trim(),
    budget: budget ?? null,
    priorities: (input.priorities ?? []).slice(0, 5),
    generatedAt: new Date().toISOString(),
    products: result.products,
    stores: result.stores,
    productSummaries: result.productSummaries,
    storeSummaries: result.storeSummaries,
    priceRange:
      prices.length > 0
        ? {
            lowest: Math.min(...prices),
            highest: Math.max(...prices),
          }
        : null,
    explanation,
    humanApprovalRequired: true,
    humanNextStep:
      "Open a review URL to inspect the seller and product. Only the human shopper can continue to seller chat or checkout.",
  };
}

export function publishPurchasePlan(plan: PurchasePlan): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(WEBMCP_PLAN_STORAGE_KEY, JSON.stringify(plan));
  } catch {
    // The live event still works when browser storage is unavailable.
  }
  window.dispatchEvent(new CustomEvent<PurchasePlan>(WEBMCP_PLAN_EVENT, { detail: plan }));
}

export function getStoredPurchasePlan(): PurchasePlan | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(WEBMCP_PLAN_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PurchasePlan) : null;
  } catch {
    return null;
  }
}

export function clearStoredPurchasePlan(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(WEBMCP_PLAN_STORAGE_KEY);
  } catch {
    // Nothing else is required when browser storage is unavailable.
  }
}