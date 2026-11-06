/** The admin console pages an admin can be given. null means "all pages". */
export const ADMIN_PAGES = [
  "dashboard", "stores", "users", "delivery", "reports", "support", "leads", "portfolio", "admins",
] as const;
export type AdminPage = (typeof ADMIN_PAGES)[number];
export type AdminPermissions = AdminPage[] | null;

export function parsePermissions(value: unknown): AdminPermissions | "invalid" {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || value.length === 0) return "invalid";
  const known = new Set<string>(ADMIN_PAGES);
  if (!value.every(v => typeof v === "string" && known.has(v))) return "invalid";
  return [...new Set(value as AdminPage[])];
}

/** Which page an /admin URL belongs to. "any" = every admin; null = owners and full-access admins only. */
export function pageForPath(path: string): AdminPage | "any" | null {
  if (path === "/admin/me" || path === "/admin/badges") return "any";
  const rules: Array<[RegExp, AdminPage]> = [
    [/^\/admin\/stores(\/|$)/, "stores"],
    [/^\/admin\/analytics(\/|$)/, "dashboard"],
    [/^\/admin\/users(\/|$)/, "users"],
    [/^\/admin\/(admins|review-access)(\/|$)/, "admins"],
    [/^\/admin\/support(\/|$)/, "support"],
    [/^\/admin\/leads(\/|$)/, "leads"],
    [/^\/admin\/portfolio-analytics(\/|$)/, "portfolio"],
    [/^\/admin\/(delivery-agents|delivery-banks|delivery-orders)(\/|$)/, "delivery"],
    [/^\/admin\/reports(\/|$)/, "reports"],
  ];
  return rules.find(([re]) => re.test(path))?.[1] ?? null;
}

export function canOpen(perms: AdminPermissions, page: AdminPage | "any" | null): boolean {
  if (page === "any") return true;
  if (perms === null) return true;
  return page !== null && perms.includes(page);
}
