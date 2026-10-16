#!/usr/bin/env bash
set -euo pipefail
# Runs in a clean Google Cloud Build worker, not in the Replit workspace.
# Runtime credentials and database access are deliberately unavailable here.
npm install --global pnpm@10.14.0 --ignore-scripts --no-audit --no-fund
pnpm install --frozen-lockfile
python3 -m unittest discover -s infra/gcp -p 'test_deploy_release.py' -v
pnpm --filter @workspace/api-server run test
pnpm run typecheck:libs
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/admin-dashboard run typecheck
pnpm --filter @workspace/api-server run build
node artifacts/api-server/scripts/gcp-build-frontends.mjs
node artifacts/api-server/scripts/gcp-prepare-runtime.mjs --with-frontends
