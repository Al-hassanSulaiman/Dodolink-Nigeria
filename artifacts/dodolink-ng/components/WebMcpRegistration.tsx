import { useEffect } from "react";
import { Platform } from "react-native";

import {
  compareMarketplaceProducts,
  createPurchasePlan,
  discoverMarketplaceStores,
  publishPurchasePlan,
  searchMarketplaceProducts,
  WEBMCP_STATUS_EVENT,
} from "@/webmcp/marketplace";

type ToolStatus = "active" | "registering" | "unavailable" | "error";

function setToolStatus(status: ToolStatus): void {
  if (typeof document === "undefined" || typeof window === "undefined") return;
  document.documentElement.dataset.webmcpStatus = status;
  window.dispatchEvent(new CustomEvent(WEBMCP_STATUS_EVENT, { detail: status }));
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string").slice(0, 5);
}

function serializeToolResult(value: unknown): string {
  return JSON.stringify(value);
}

export function WebMcpRegistration() {
  useEffect(() => {
    if (
      Platform.OS !== "web" ||
      typeof document === "undefined" ||
      !document.modelContext
    ) {
      setToolStatus("unavailable");
      return;
    }

    const controller = new AbortController();
    setToolStatus("registering");

    const registerTools = async () => {
      if (!document.modelContext) return;

      await document.modelContext.registerTool(
        {
          name: "dodolink_search_products",
          title: "Search DodoLink products",
          description:
            "Search real public DodoLink marketplace listings using natural-language terms, optional category and Naira price limits. Returns in-stock product and seller review links. This tool is read-only and cannot buy, pay, or contact a seller.",
          inputSchema: {
            type: "object",
            properties: {
              query: {
                type: "string",
                minLength: 2,
                description: "What the shopper wants, such as 'smartphone' or 'bulk honey'.",
              },
              category: {
                type: "string",
                description: "Optional DodoLink marketplace category.",
              },
              minPrice: {
                type: "number",
                minimum: 0,
                description: "Optional minimum price in Nigerian Naira.",
              },
              maxPrice: {
                type: "number",
                minimum: 0,
                description: "Optional maximum price in Nigerian Naira.",
              },
              inStockOnly: {
                type: "boolean",
                description: "Return only in-stock products. Defaults to true.",
              },
              limit: {
                type: "integer",
                minimum: 1,
                maximum: 12,
                description: "Maximum number of results. Defaults to 5.",
              },
            },
            required: ["query"],
            additionalProperties: false,
          },
          annotations: {
            readOnlyHint: true,
            untrustedContentHint: true,
          },
          execute: async (input, { signal }) => {
            const query = stringValue(input.query);
            if (!query) return serializeToolResult({ ok: false, error: "A search query is required." });
            const result = await searchMarketplaceProducts(
              {
                query,
                category: stringValue(input.category),
                minPrice: numberValue(input.minPrice),
                maxPrice: numberValue(input.maxPrice),
                inStockOnly:
                  typeof input.inStockOnly === "boolean" ? input.inStockOnly : true,
                limit: numberValue(input.limit),
              },
              signal,
            );
            return serializeToolResult({
              ok: true,
              query: result.query,
              appliedMaxPrice: result.appliedMaxPrice,
              totalMatches: result.totalMatches,
              products: result.productSummaries,
              sellers: result.storeSummaries,
              humanApprovalRequired: true,
            });
          },
        },
        { signal: controller.signal },
      );

      await document.modelContext.registerTool(
        {
          name: "dodolink_discover_stores",
          title: "Discover DodoLink stores",
          description:
            "Discover real public DodoLink stores by keyword, category, location, verification, and rating. Returns only review information and links; it cannot contact or alter a store.",
          inputSchema: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description: "Optional business, product, or supplier keywords.",
              },
              category: {
                type: "string",
                description: "Optional store category.",
              },
              location: {
                type: "string",
                description: "Optional Nigerian city, state, or area.",
              },
              verifiedOnly: {
                type: "boolean",
                description: "Whether to return only DodoLink-verified stores.",
              },
              limit: {
                type: "integer",
                minimum: 1,
                maximum: 12,
                description: "Maximum number of stores. Defaults to 5.",
              },
            },
            additionalProperties: false,
          },
          annotations: {
            readOnlyHint: true,
            untrustedContentHint: true,
          },
          execute: async (input, { signal }) => {
            const result = await discoverMarketplaceStores(
              {
                query: stringValue(input.query),
                category: stringValue(input.category),
                location: stringValue(input.location),
                verifiedOnly:
                  typeof input.verifiedOnly === "boolean" ? input.verifiedOnly : undefined,
                limit: numberValue(input.limit),
              },
              signal,
            );
            return serializeToolResult({
              ok: true,
              totalMatches: result.totalMatches,
              stores: result.storeSummaries,
            });
          },
        },
        { signal: controller.signal },
      );

      await document.modelContext.registerTool(
        {
          name: "dodolink_compare_products",
          title: "Compare DodoLink products",
          description:
            "Compare two to six real DodoLink product IDs by price, stock, category, and seller. Returns human review links and never chooses, purchases, pays, or messages on the shopper's behalf.",
          inputSchema: {
            type: "object",
            properties: {
              productIds: {
                type: "array",
                minItems: 2,
                maxItems: 6,
                uniqueItems: true,
                items: { type: "integer", minimum: 1 },
                description: "DodoLink product IDs returned by product search.",
              },
            },
            required: ["productIds"],
            additionalProperties: false,
          },
          annotations: {
            readOnlyHint: true,
            untrustedContentHint: true,
          },
          execute: async (input, { signal }) => {
            const ids = Array.isArray(input.productIds)
              ? input.productIds.filter(
                  (id): id is number => typeof id === "number" && Number.isInteger(id) && id > 0,
                )
              : [];
            const comparison = await compareMarketplaceProducts(ids, signal);
            return serializeToolResult({ ok: true, ...comparison });
          },
        },
        { signal: controller.signal },
      );

      await document.modelContext.registerTool(
        {
          name: "dodolink_prepare_purchase_plan",
          title: "Prepare a DodoLink purchase plan",
          description:
            "Build a visible, read-only DodoLink shortlist from a shopper's request, optional Naira budget, and priorities. The plan appears on the page for human review. It cannot purchase, pay, start checkout, or send seller messages.",
          inputSchema: {
            type: "object",
            properties: {
              query: {
                type: "string",
                minLength: 2,
                description: "The shopper's complete request in natural language.",
              },
              budget: {
                type: "number",
                minimum: 0,
                description: "Optional maximum total budget in Nigerian Naira.",
              },
              priorities: {
                type: "array",
                maxItems: 5,
                items: { type: "string" },
                description: "Optional priorities such as price, rating, location, or verification.",
              },
              limit: {
                type: "integer",
                minimum: 1,
                maximum: 8,
                description: "Maximum shortlist size. Defaults to 5.",
              },
            },
            required: ["query"],
            additionalProperties: false,
          },
          annotations: {
            readOnlyHint: true,
            untrustedContentHint: true,
          },
          execute: async (input, { signal }) => {
            const query = stringValue(input.query);
            if (!query) return serializeToolResult({ ok: false, error: "A purchase request is required." });
            const plan = await createPurchasePlan(
              {
                query,
                budget: numberValue(input.budget),
                priorities: stringArray(input.priorities),
                limit: numberValue(input.limit),
              },
              signal,
            );
            publishPurchasePlan(plan);
            return serializeToolResult({
              ok: true,
              query: plan.query,
              budget: plan.budget,
              priorities: plan.priorities,
              explanation: plan.explanation,
              priceRange: plan.priceRange,
              products: plan.productSummaries,
              sellers: plan.storeSummaries,
              humanApprovalRequired: plan.humanApprovalRequired,
              humanNextStep: plan.humanNextStep,
            });
          },
        },
        { signal: controller.signal },
      );

      setToolStatus("active");
    };

    void registerTools().catch((error) => {
      if (!controller.signal.aborted) {
        console.error("Failed to register DodoLink WebMCP tools", error);
        setToolStatus("error");
      }
    });

    return () => {
      controller.abort();
    };
  }, []);

  return null;
}