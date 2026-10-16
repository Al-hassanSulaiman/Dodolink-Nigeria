# Dodolink NG

Nigerian marketplace: buyers browse local stores and products, chat with sellers, and leave reviews; sellers run a store with a ₦5,000/month Paystack subscription. Expo mobile app (live at dodolink.com.ng) + admin dashboard (`/admin`) + Express API.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required local env: `DATABASE_URL` — Postgres connection string

## Production hosting

- DodoLink customer web, `/admin/`, and API run on Google Cloud in Johannesburg (`africa-south1`), using the existing `dodolink.com.ng` domain. See `infra/gcp/README.md` for infrastructure, verification limits, and recovery instructions.
- Replit remains the development workspace and retains the old source database/media. Its old published DodoLink runtime is unpublished. Do not republish it or restart its billing jobs as an ordinary release or DNS-only rollback; Google and Replit have separate data copies.
- Google web containers keep background timers disabled. Separate Cloud Run maintenance jobs own billing, retention, and deletion schedules. Reconcile data/auth before any rollback.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

- API security model: public reads (stores/products/search/reviews lists), authenticated writes. Every write and all conversation routes require a Clerk bearer token (`requireUser` in `artifacts/api-server/src/lib/auth.ts`) plus ownership/participant checks. Identity fields in request bodies are never trusted.
- Paystack subscription verify checks amount (+NGN currency), reference prefix `dodolink_sub_<storeId>_`, and replay protection via the timestamp embedded in the reference vs `subscriptionLastPaidAt` — no schema change needed.
- `GET /stores?ownerUserId=X` returns only X's stores including hidden past-due ones, so owners can always reach the subscription screen to pay.
- One store per user, enforced at store creation (409 if one exists).
- Support messaging: one flat thread per user in `support_messages` (`lib/db/src/schema/support_messages.ts`) with `senderRole` + per-side read flags; user routes in `artifacts/api-server/src/routes/support.ts` (identity always from Clerk), admin routes in `admin.ts` behind the `requireAdmin` allowlist. Admin replies 404 without an existing thread and snapshot userName/email from the latest row; mark-read endpoints are idempotent bulk updates.

## Product

- Support/help messaging: mobile users reach a support chat via the help icon (question mark) on Home (`app/support.tsx`, 15s polling); admins triage from a two-pane inbox at `/admin/support` with an unread badge in the sidebar; each thread shows the sender's name, email, and a Retailer/Customer badge (`isSeller` = user owns a store row). Admin replies trigger a push notification ("Dodolink Support") to the user.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- The legacy Replit Dodolink NG deployment build (`artifacts/dodolink-ng/scripts/build.js`) exports a react-native-web build (`expo export --platform web`) before building native bundles; `server/serve.js` serves it at `/`, the QR/Expo Go landing page at `/go`, and native manifests via the `expo-platform` header. This is not the active Google production release path. `static-build/` is gitignored build output.
- `EXPO_PUBLIC_*` env vars are baked into bundles at export/Metro start time — set them in the build env, they cannot be read at runtime.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
