# AWS runtime image. Same as infra/gcp/runtime.Dockerfile plus the two AWS SDK
# packages that the S3 storage option loads when STORAGE_PROVIDER=s3.
# The build context is the generated-artifacts/gcp-runtime folder produced by
# infra/gcp/build-source.sh, exactly as for Cloud Run.
FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
# Pinned to the major version; --no-save keeps package.json/lockfile untouched.
RUN npm install --no-save --omit=dev --ignore-scripts --no-audit --no-fund \
    @aws-sdk/client-s3@3 @aws-sdk/s3-request-presigner@3
COPY --chown=node:node dist ./dist
COPY --chown=node:node web ./web
USER node
CMD ["node", "--enable-source-maps", "dist/index.mjs"]
