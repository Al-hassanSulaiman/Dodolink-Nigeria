FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
# The context is generated from an explicit allowlist, never the workspace.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY --chown=node:node dist ./dist
USER node
CMD ["node", "--enable-source-maps", "dist/index.mjs"]
