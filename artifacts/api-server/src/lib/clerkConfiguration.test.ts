import { describe, expect, it } from "vitest";
import { resolveClerkPublishableKey } from "./clerkConfiguration";

describe("personal Clerk instance selection", () => {
  const fixtureKey = `pk_live_${Buffer.from("clerk.example.com$").toString("base64")}`;
  it.each(["service.a.run.app", "spoofed.invalid", ""])(
    "uses the configured personal instance for host %j", host => {
      expect(resolveClerkPublishableKey(host, {
        CLERK_AUTH_MODE: "external", CLERK_PUBLISHABLE_KEY: fixtureKey,
      })).toBe(fixtureKey);
    },
  );
  it("refuses an external configuration without a key", () => {
    expect(() => resolveClerkPublishableKey("service.a.run.app", {
      CLERK_AUTH_MODE: "external",
    })).toThrow("required");
  });
  it("preserves managed host selection outside external mode", () => {
    expect(resolveClerkPublishableKey("example.com", {
      CLERK_PUBLISHABLE_KEY: fixtureKey,
    })).toBe(fixtureKey);
  });
});
