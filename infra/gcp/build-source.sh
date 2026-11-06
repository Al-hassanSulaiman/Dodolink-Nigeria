#!/usr/bin/env bash
set -euo pipefail
# Runs in a clean Google Cloud Build worker, not in the Replit workspace.
# Runtime credentials and database access are deliberately unavailable here.
npm install --global pnpm@10.14.0 --ignore-scripts --no-audit --no-fund
pnpm install --frozen-lockfile
python3 -m unittest discover -s infra/gcp -p 'test_deploy_release.py' -v
# Only the disposable worker-local test database may receive schema setup.
# Never fall back to DATABASE_URL inherited from another environment.
if [[ "${CI_DATABASE_URL:-}" != "postgresql://ci:ci@ci-postgres:5432/dodolink_ci" ]]; then
  echo "Refusing schema setup outside the disposable CI database." >&2
  exit 1
fi
pnpm --filter @workspace/db exec node --input-type=module -e '
import pg from "pg";
for (let attempt = 0; ; attempt++) {
  const client = new pg.Client({ connectionString: process.env.CI_DATABASE_URL,
    connectionTimeoutMillis: 1000 });
  try { await client.connect(); break; }
  catch { if (attempt === 29) throw new Error("Disposable test database did not start."); }
  finally { await client.end(); }
  await new Promise(resolve => setTimeout(resolve, 1000));
}
'
DATABASE_URL="$CI_DATABASE_URL" pnpm --filter @workspace/db run push --force
DATABASE_URL="$CI_DATABASE_URL" pnpm --filter @workspace/api-server run test
pnpm --filter @workspace/dodolink-ng run test
pnpm run typecheck:libs
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/admin-dashboard run typecheck
pnpm --filter @workspace/api-server run build
node artifacts/api-server/scripts/gcp-build-frontends.mjs
node artifacts/api-server/scripts/gcp-prepare-runtime.mjs --with-frontends
echo "ICON DIAG:"; cd generated-artifacts/gcp-web/app; grep -rhoE "[^\"'(]*Feather[^\"')]*\.ttf" _expo index.html 2>/dev/null | sort -u | head -5; grep -rhoE "uri:[^}]{0,200}Feather[^}]{0,80}" _expo 2>/dev/null | head -3; grep -rhoE "httpServerLocation[^}]{0,200}Feather[^}]{0,60}" _expo 2>/dev/null | head -3; grep -rhoE ".{120}Feather\.[a-f0-9]{32}.{60}" _expo 2>/dev/null | head -3; cd - >/dev/null
echo "LIVE DIAG:"; U="https://dodolink.com.ng/assets/__node_modules/.pnpm/@expo+vector-icons@15.1.1_expo-font@14.0.12_expo@54.0.37_react-native@0.81.5_@babel+cor_a2f91e192e3696edb7475709e2b3594d/node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/Feather.ca4b48e04dc1ce10bfbddb262c8b835f.ttf"; curl -sS -m 30 -D - -o /tmp/f.bin "$U" | head -15; ls -l /tmp/f.bin; head -c 120 /tmp/f.bin | tr -c '[:print:]' '.'; echo; curl -sS -m 30 -I https://dodolink.com.ng/assets/assets/fonts/Inter_400Regular.51b6ad87261f18b6433ec52871ddfabc.ttf | head -3; exit 0
