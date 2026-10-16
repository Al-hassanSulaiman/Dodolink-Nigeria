---
name: Clerk reviewer access
description: Safe reusable access for app-store reviewers when Clerk Device Trust challenges new devices
---

Give app-store reviewers a separate, ordinary account with a per-user Device Trust exception. Never hardcode an OTP, exempt an owner's account, or disable Device Trust for all users.

**Why:** Clerk verifies email codes on its server, and Device Trust challenges a new device even when an ordinary account has not enabled MFA. Reviewers need to sign in independently without access to an owner's email. Clerk's Backend API supports a per-user `bypass_client_trust` setting even when an installed JavaScript SDK's types do not expose it.

**How to apply:** Set the exception only through the server-side Clerk Backend API for a dedicated reviewer account that cannot become an admin. Keep its password out of source code. Development and production Clerk accounts are separate; verify the production account on clean devices using the released Android and iOS builds before giving credentials to stores. Revoke the reviewer account after both reviews finish.

Verify that the current instance accepts the per-user exception before relying on it.

**Why:** The personal production instance rejected the setting with HTTP 422. Prior success on a different instance did not prove support on this one.

**How to apply:** Do not repeat rejected flag requests or disable Device Trust globally. A real mailbox is needed to finish normal password/device-verification testing. Official short-lived sign-in tickets can independently verify session/API authorization, but do not prove the password/device journey.