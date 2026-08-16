---
name: EAS iOS credentials non-interactive setup
description: How to set up EAS iOS build credentials non-interactively using an App Store Connect API key, bypassing the interactive Apple login requirement.
---

# EAS iOS Credentials — Non-Interactive Setup

## The rule
EAS CLI `eas build --platform ios --non-interactive` always fails with "Credentials are not set up" unless credentials are pre-configured. The `EXPO_APPLE_API_KEY_*` env vars are ignored by the build credential setup phase.

**Why:** EAS managed credentials require an interactive Apple OAuth flow the first time. In a headless server (Replit), this is impossible.

## How to apply
Use the App Store Connect API key to manually create credentials via Apple's REST API, write a `credentials.json`, and set `credentialsSource: "local"` in `eas.json`.

### Step-by-step
1. Get an ASC API key (Key ID, Issuer ID, `.p8` file) from App Store Connect → Users and Access → Integrations
2. Run a Node.js script that:
   - Generates RSA 2048 key + CSR via `openssl`
   - Authenticates with Apple API using ES256 JWT from the `.p8`
   - POSTs CSR to `POST /v1/certificates` with type `IOS_DISTRIBUTION`
   - Fetches bundle ID via `GET /v1/bundleIds?filter[identifier]=<bundleId>`
   - Creates provisioning profile via `POST /v1/profiles` with `profileType: IOS_APP_STORE`
   - Exports `credentials.json` with `distributionCertificate` (p12 + password) and `provisioningProfilePath`
3. Set `"credentialsSource": "local"` in `eas.json` production build profile
4. Run `eas build --platform ios --profile production --non-interactive`

### For eas submit (no Apple ID needed)
Configure `eas.json` submit profile with:
```json
"ascApiKeyPath": "/path/to/AuthKey.p8",
"ascApiKeyId": "<KEY_ID>",
"ascApiKeyIssuerId": "<ISSUER_ID>",
"ascAppId": "<NUMERIC_APP_ID>",
"appleTeamId": "<10_CHAR_TEAM_ID>"
```
Team ID is extractable from provisioning profile XML: `TeamIdentifier → array → string`.
App ID is from `GET /v1/apps?filter[bundleId]=<bundleId>` → `data[0].id`.

**Why:** `eas submit` fully supports API key auth without Apple ID/password.

## Cleanup
Delete `credentials.json` and `.p8` files after the build runs — they contain private key material and must not be committed.
