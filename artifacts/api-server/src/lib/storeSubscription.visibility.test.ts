import { describe, expect, it } from "vitest";
import { isStoreHidden } from "./storeSubscription";

const overdueStore = {
  qualifiedAt: new Date("2026-08-01T00:00:00.000Z"),
  subscriptionStatus: "past_due",
  subscriptionDueAt: new Date("2026-09-01T00:00:00.000Z"),
  subscriptionExempt: false,
  hiddenByAdmin: false,
};

describe("store payment exemptions", () => {
  it("hides an overdue store without an exemption", () => {
    expect(isStoreHidden(overdueStore)).toBe(true);
  });

  it("keeps an overdue store visible while exempt", () => {
    expect(isStoreHidden({ ...overdueStore, subscriptionExempt: true })).toBe(false);
  });

  it("keeps an explicitly admin-hidden store hidden even while exempt", () => {
    expect(
      isStoreHidden({
        ...overdueStore,
        subscriptionExempt: true,
        hiddenByAdmin: true,
      }),
    ).toBe(true);
  });
});