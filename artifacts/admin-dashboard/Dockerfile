FROM node:24-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# ── deps stage ───────────────────────────────────────────────────────────────
FROM base AS deps
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY lib/db/package.json ./lib/db/
COPY lib/api-spec/package.json ./lib/api-spec/
COPY lib/api-zod/package.json ./lib/api-zod/
COPY lib/api-client-react/package.json ./lib/api-client-react/
COPY artifacts/admin-dashboard/package.json ./artifacts/admin-dashboard/

RUN pnpm install --frozen-lockfile

# ── build stage ───────────────────────────────────────────────────────────────
FROM deps AS build
WORKDIR /app

COPY lib/ ./lib/
COPY artifacts/admin-dashboard/ ./artifacts/admin-dashboard/
COPY tsconfig.json tsconfig.base.json ./

# Build shared libs first
RUN pnpm run typecheck:libs

# Vite config requires PORT and BASE_PATH at build time
ENV PORT=8080
ENV BASE_PATH=/admin/
ENV NODE_ENV=production

RUN pnpm --filter @workspace/admin-dashboard run build

# ── runtime stage: nginx serving static files ────────────────────────────────
FROM nginx:1.27-alpine AS runtime

# Remove default nginx config
RUN rm /etc/nginx/conf.d/default.conf

COPY --from=build /app/artifacts/admin-dashboard/dist/public /usr/share/nginx/html/admin
COPY artifacts/admin-dashboard/nginx.conf /etc/nginx/conf.d/dodolink-admin.conf

EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
