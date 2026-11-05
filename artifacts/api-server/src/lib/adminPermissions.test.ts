import { describe, expect, it } from "vitest";
import { canOpen, pageForPath, parsePermissions } from "./adminPermissions";

describe("admin page access", () => {
  it("maps every admin URL to its page", () => {
    expect(pageForPath("/admin/stores/5/verify")).toBe("stores");
    expect(pageForPath("/admin/analytics")).toBe("dashboard");
    expect(pageForPath("/admin/delivery-agents/3/exempt")).toBe("delivery");
    expect(pageForPath("/admin/delivery-banks")).toBe("delivery");
    expect(pageForPath("/admin/reports/2/chat")).toBe("reports");
    expect(pageForPath("/admin/review-access/u1")).toBe("admins");
    expect(pageForPath("/admin/portfolio-analytics/links")).toBe("portfolio");
    expect(pageForPath("/admin/me")).toBe("any");
    expect(pageForPath("/admin/something-new")).toBeNull();
  });
  it("lets full-access admins everywhere and limited admins only their pages", () => {
    expect(canOpen(null, "stores")).toBe(true);
    expect(canOpen(null, null)).toBe(true);
    expect(canOpen(["stores"], "stores")).toBe(true);
    expect(canOpen(["stores"], "users")).toBe(false);
    expect(canOpen(["stores"], "any")).toBe(true);
    expect(canOpen(["stores"], null)).toBe(false); // unknown admin URLs need full access
  });
  it("accepts only known pages and at least one", () => {
    expect(parsePermissions(undefined)).toBeNull();
    expect(parsePermissions(["stores", "stores", "users"])).toEqual(["stores", "users"]);
    expect(parsePermissions([])).toBe("invalid");
    expect(parsePermissions(["stores", "hack"])).toBe("invalid");
    expect(parsePermissions("stores")).toBe("invalid");
  });
});
