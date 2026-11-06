/** Owner emails: seeded as admins on first run and can never be revoked or actioned. */
export const BOOTSTRAP_ADMIN_EMAILS = [
  "alhassansulaiman1369@gmail.com",
  "alhassansulaiman5star@gmail.com",
];

export const isProtectedAdminEmail = (email: string) =>
  BOOTSTRAP_ADMIN_EMAILS.some((owner) => owner.toLowerCase() === email.toLowerCase());
