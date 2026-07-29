import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // Each test file gets an isolated module registry so vi.mock is clean
    isolate: true,
    // Resolve workspace packages by following the "workspace" custom condition
    // (same as the base tsconfig)
    alias: {
      "@workspace/db": new URL("../../lib/db/src/index.ts", import.meta.url).pathname,
      "@workspace/api-zod": new URL("../../lib/api-zod/src/index.ts", import.meta.url).pathname,
    },
  },
});
