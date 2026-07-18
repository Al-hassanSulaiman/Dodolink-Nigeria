# ─────────────────────────────────────────────────────────────────────────────
# Dodolink NG — API Server
# Multi-stage build for Google Cloud Run
# Cloud Run injects PORT automatically (default 8080)
# ─────────────────────────────────────────────────────────────────────────────

# ── Stage 1: base ─────────────────────────────────────────────────────────────
FROM node:24-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# ── Stage 2: install dependencies ────────────────────────────────────────────
FROM base AS deps
WORKDIR /app

# Copy manifests only — better layer caching
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./

COPY lib/db/package.json                   ./lib/db/
COPY lib/api-spec/package.json             ./lib/api-spec/
COPY lib/api-zod/package.json              ./lib/api-zod/
COPY lib/api-client-react/package.json     ./lib/api-client-react/
COPY artifacts/api-server/package.json     ./artifacts/api-server/

RUN pnpm install --frozen-lockfile --prod=false

# ── Stage 3: build ────────────────────────────────────────────────────────────
FROM deps AS build
WORKDIR /app

COPY tsconfig.json tsconfig.base.json ./
COPY lib/                              ./lib/
COPY artifacts/api-server/             ./artifacts/api-server/

# Build shared libs (generates type declarations), then bundle the server
RUN pnpm run typecheck:libs
RUN pnpm --filter @workspace/api-server run build

# ── Stage 4: production runtime ───────────────────────────────────────────────
FROM node:24-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production

# Copy compiled bundle
COPY --from=build /app/artifacts/api-server/dist ./dist

# Copy only production node_modules
COPY --from=build /app/node_modules                          ./node_modules
COPY --from=build /app/artifacts/api-server/node_modules     ./artifacts/api-server/node_modules
COPY --from=build /app/lib                                   ./lib

# Cloud Run sets PORT; expose it for documentation purposes
EXPOSE 8080

CMD ["node", "--enable-source-maps", "./dist/index.mjs"]
