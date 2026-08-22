---
name: EAS Submit credential conflicts
description: Resolve an Expo MCP iOS submission conflict between Apple authentication mechanisms.
---

When the Expo MCP submission action reports an exclusive-peer conflict between an Apple app-specific password and an App Store Connect API key, use the EAS CLI submission route with one configured authentication method instead.

**Why:** The MCP submission route can combine credentials persisted for the Expo project with credentials declared in the submission profile, even though Apple submission accepts only one mechanism. The CLI accepts a specific EAS build ID and uses the selected profile directly.

**How to apply:** In this pnpm monorepo, run `eas submit --platform ios --profile production --id <build-id> --non-interactive --wait` from the mobile artifact directory—not the repository root—so EAS resolves that artifact's `eas.json`. Supply credentials through the secrets mechanism without printing or retaining them.