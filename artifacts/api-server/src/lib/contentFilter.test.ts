import { describe, expect, it } from "vitest";
import { containsObjectionable } from "./contentFilter";

describe("objectionable text filter", () => {
  it("catches clearly objectionable words, including simple disguises", () => {
    expect(containsObjectionable("free porn here")).toBe(true);
    expect(containsObjectionable("p0rn")).toBe(true);
    expect(containsObjectionable("pooorn")).toBe(true);
    expect(containsObjectionable("Kill yourself")).toBe(true);
    expect(containsObjectionable("selling cocaine")).toBe(true);
  });
  it("never flags ordinary shop and chat words", () => {
    for (const ok of [
      "Hello, is the nude lipstick shade in stock?", "Scunthorpe", "class assessment", "the method works",
      "police escort for delivery", "weed killer 5 litres", "tweed jacket", "Essex", "classic", "document",
      "Can you deliver to Kaduna by tomorrow?", "Price is ₦25,000", "", "I need an electrical hookup",
    ]) expect(containsObjectionable(ok), ok).toBe(false);
  });
});
