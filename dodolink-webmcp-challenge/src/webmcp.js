import {
  compareProducts,
  discoverStores,
  preparePurchasePlan,
  searchProducts,
  productReviewUrl,
  storeReviewUrl,
} from "./api.js";

export const PLAN_EVENT = "dodolink:webmcp-plan";

function result(value) {
  return JSON.stringify(value);
}

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function number(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export async function registerWebMcpTools() {
  if (!("modelContext" in document) || !document.modelContext) {
    return { status: "unavailable", cleanup: () => {} };
  }

  const controller = new AbortController();
  const annotations = { readOnlyHint: true, untrustedContentHint: true };

  await document.modelContext.registerTool({
    name: "search_products",
    description: "Search the DodoLink public product catalog by natural-language request and optional Naira price limit. Returns real in-stock listings and human review links. This read-only tool cannot buy, pay, checkout, or contact a seller.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", minLength: 2, description: "What the shopper wants." },
        maxPrice: { type: "number", minimum: 0, description: "Maximum price in Nigerian Naira." },
        limit: { type: "integer", minimum: 1, maximum: 12 },
      },
      required: ["query"],
      additionalProperties: false,
    },
    annotations,
    execute: async (input, { signal }) => {
      const query = text(input?.query);
      if (!query) return result({ ok: false, error: "query is required" });
      const found = await searchProducts({ query, maxPrice: number(input?.maxPrice), limit: number(input?.limit) || 6 }, signal);
      return result({
        ok: true,
        query: found.query,
        appliedMaxPrice: found.appliedMaxPrice,
        totalMatches: found.totalMatches,
        products: found.products.map((product) => ({
          id: product.id,
          name: product.name,
          storeName: product.storeName,
          category: product.category,
          price: product.price,
          inStock: product.inStock,
          reviewUrl: productReviewUrl(product.id),
        })),
        humanApprovalRequired: true,
      });
    },
  }, { signal: controller.signal });

  await document.modelContext.registerTool({
    name: "discover_stores",
    description: "Discover public DodoLink stores by keyword, Nigerian location, and verification status. Returns review links only and cannot contact or modify a store.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Optional store or product keywords." },
        location: { type: "string", description: "Optional Nigerian city, state, or area." },
        verifiedOnly: { type: "boolean" },
        limit: { type: "integer", minimum: 1, maximum: 12 },
      },
      additionalProperties: false,
    },
    annotations,
    execute: async (input, { signal }) => {
      const found = await discoverStores({
        query: text(input?.query),
        location: text(input?.location),
        verifiedOnly: input?.verifiedOnly === true,
        limit: number(input?.limit) || 6,
      }, signal);
      return result({
        ok: true,
        totalMatches: found.totalMatches,
        stores: found.stores.map((store) => ({
          id: store.id,
          name: store.name,
          category: store.category,
          location: store.location,
          verificationStatus: store.verificationStatus,
          averageRating: store.avgRating ?? null,
          totalReviews: store.totalReviews,
          reviewUrl: storeReviewUrl(store.id),
        })),
      });
    },
  }, { signal: controller.signal });

  await document.modelContext.registerTool({
    name: "compare_products",
    description: "Compare two to six DodoLink product IDs by price, stock, and seller. Returns review links and never purchases, pays, or messages.",
    inputSchema: {
      type: "object",
      properties: {
        productIds: { type: "array", minItems: 2, maxItems: 6, items: { type: "integer", minimum: 1 } },
      },
      required: ["productIds"],
      additionalProperties: false,
    },
    annotations,
    execute: async (input, { signal }) => {
      const ids = Array.isArray(input?.productIds)
        ? input.productIds.filter((id) => Number.isInteger(id) && id > 0)
        : [];
      const comparison = await compareProducts(ids, signal);
      return result({
        ok: true,
        ...comparison,
        products: comparison.products.map((product) => ({
          id: product.id,
          name: product.name,
          storeName: product.storeName,
          price: product.price,
          inStock: product.inStock,
          reviewUrl: productReviewUrl(product.id),
        })),
      });
    },
  }, { signal: controller.signal });

  await document.modelContext.registerTool({
    name: "prepare_purchase_plan",
    description: "Prepare a visible, read-only DodoLink shortlist from a shopper request, budget, and priorities. It updates the page for human review and cannot pay, checkout, or send seller messages.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", minLength: 2 },
        budget: { type: "number", minimum: 0 },
        priorities: { type: "array", maxItems: 5, items: { type: "string" } },
        limit: { type: "integer", minimum: 1, maximum: 8 },
      },
      required: ["query"],
      additionalProperties: false,
    },
    annotations,
    execute: async (input, { signal }) => {
      const query = text(input?.query);
      if (!query) return result({ ok: false, error: "query is required" });
      const plan = await preparePurchasePlan({
        query,
        budget: number(input?.budget),
        priorities: Array.isArray(input?.priorities) ? input.priorities.filter((item) => typeof item === "string").slice(0, 5) : [],
        limit: number(input?.limit) || 5,
      }, signal);
      window.dispatchEvent(new CustomEvent(PLAN_EVENT, { detail: plan }));
      return result({ ok: true, ...plan, humanApprovalRequired: true });
    },
  }, { signal: controller.signal });

  return { status: "active", cleanup: () => controller.abort() };
}