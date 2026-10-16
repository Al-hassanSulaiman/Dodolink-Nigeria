---
name: Clerk reviewer access
description: Safe reusable access for app-store reviewers when Clerk Device Trust challenges new devices
---

Give app-store reviewers a separate, ordinary account with a per-user Device Trust exception. Never hardcode an OTP, exempt an owner's account, or disable Device Trust for all users.

**Why:** Clerk verifies email codes on its server, and Device Trust challenges a new device even when an ordinary account has not enabled MFA. Reviewers need to sign in independently without access to an owner's email. Clerk's Backend API supports a per-user `bypass_client_trust` setting even when an installed JavaScript SDK's types do not expose it.

**How to apply:** Set the exception only through the server-side Clerk Backend API for a dedicated reviewer account that cannot become an admin. Keep its password out of source code. Development and production Clerk accounts are separate; verify the production account on clean devices using the released Android and iOS builds before giving credentials to stores. Revoke the reviewer account after both reviews finish.

Verify that the current instance accepts the per-user exception before relying on it.

**Why:** An earlier production request returned HTTP 422 and was initially treated as an unsupported exception. The production instance subsequently accepted the documented field for the approved reviewer. A validation failure alone does not establish that a feature is unavailable.

**How to apply:** Do not blindly repeat rejected probes or disable Device Trust globally. Inspect the provider's field-specific error codes before choosing a fix. Confirm the saved per-user flag and review marker through a fresh API read, then test password sign-in from a new client. Official short-lived sign-in tickets can independently verify session/API authorization, but do not prove the password/device journey.

## Fresh-directory migration scope

Starting the personal Clerk directory fresh does not mean retiring the product's app-store reviewer access.

**Why:** After choosing a fresh user directory, the user asked whether the existing dashboard-created review account still works and supplied its email for restoration.

**How to apply:** Reprovision only the approved dedicated reviewer account, without recovering legacy users or transferring legacy ownership/admin privileges. Obtain its password through the secure secrets flow, not chat. Preserve the real reviewer account during synthetic-test cleanup. Do not claim that copying SQL preserves the reviewer login, or that a successful sign-in ticket proves an OTP-free password login.