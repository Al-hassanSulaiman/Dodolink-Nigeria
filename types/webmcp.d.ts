export {};

declare global {
  interface WebMcpToolContext {
    signal: AbortSignal;
  }

  interface WebMcpToolDefinition {
    name: string;
    title?: string;
    description: string;
    inputSchema: Record<string, unknown>;
    execute: (
      input: Record<string, unknown>,
      context: WebMcpToolContext,
    ) => string | Promise<string>;
    annotations?: {
      readOnlyHint?: boolean;
      untrustedContentHint?: boolean;
    };
  }

  interface WebMcpModelContext extends EventTarget {
    registerTool(
      tool: WebMcpToolDefinition,
      options?: { signal?: AbortSignal; exposedTo?: string[] },
    ): Promise<void>;
    getTools?(): Promise<unknown[]>;
  }

  interface Document {
    modelContext?: WebMcpModelContext;
  }
}