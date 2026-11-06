import { describe, expect, it } from "vitest";
import { containsObjectionable } from "./contentFilter";

describe("containsObjectionable", () => {
  it("catches abusive words", () => {
    expect(containsObjectionable("you are a bitch")).toBe(true);
    expect(containsObjectionable("Send NUDES")).toBe(true);
  });
  it("lets normal text through", () => {
    expect(containsObjectionable("Brand new Scunthorpe assessment class, 5000 naira")).toBe(false);
    expect(containsObjectionable("Hello, is this still available?")).toBe(false);
    expect(containsObjectionable(null, undefined, "")).toBe(false);
  });
});
