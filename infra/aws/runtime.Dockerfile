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
# Amazon's official CA list, so the app can verify RDS's TLS certificate
# (sslmode=require fails with SELF_SIGNED_CERT_IN_CHAIN without it). The build
# fails loudly if the download is not a certificate bundle.
RUN node -e "fetch('https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem').then(r=>{if(!r.ok)throw new Error('download failed '+r.status);return r.text()}).then(t=>{if(!t.includes('BEGIN CERTIFICATE'))throw new Error('not a certificate bundle');require('fs').writeFileSync('/app/rds-global-bundle.pem',t)})"
COPY --chown=node:node dist ./dist
COPY --chown=node:node web ./web
USER node
CMD ["node", "--enable-source-maps", "dist/index.mjs"]
