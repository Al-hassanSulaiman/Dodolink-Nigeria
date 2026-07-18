FROM node:24-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# ── deps stage: install all workspace dependencies ──────────────────────────
FROM base AS deps
WORKDIR /app

# Copy manifests first for better layer caching
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY lib/db/package.json ./lib/db/
COPY lib/api-spec/package.json ./lib/api-spec/
COPY lib/api-zod/package.json ./lib/api-zod/
COPY lib/api-client-react/package.json ./lib/api-client-react/
COPY artifacts/api-server/package.json ./artifacts/api-server/

RUN pnpm install --frozen-lockfile

# ── build stage: compile everything ─────────────────────────────────────────
FROM deps AS build
WORKDIR /app

# Copy all source
COPY lib/ ./lib/
COPY artifacts/api-server/ ./artifacts/api-server/
COPY tsconfig.json tsconfig.base.json ./

# Build shared libs, then the server
RUN pnpm run typecheck:libs
RUN pnpm --filter @workspace/api-server run build

# ── runtime stage: minimal image ────────────────────────────────────────────
FROM node:24-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Copy only the compiled bundle and production deps
COPY --from=build /app/artifacts/api-server/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/artifacts/api-server/node_modules ./artifacts/api-server/node_modules
COPY --from=build /app/lib ./lib

# Cloud Run injects PORT automatically
EXPOSE 8080
CMD ["node", "--enable-source-maps", "./dist/index.mjs"]
