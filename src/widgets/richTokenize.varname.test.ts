import { describe, it, expect } from "vitest";
import { varBaseName } from "./richTokenize";

describe("varBaseName — strips every accessor shape", () => {
  // The chip lookup keys off this. Before it understood an axis,
  // `$outfit.SHOES` matched no known variable and rendered as inert text
  // instead of a chip, even though the engine resolved it fine.
  it.each([
    ["$mood.0", "mood"],
    ["$outfit.SHOES", "outfit"],
    ["$outfit.0.SHOES", "outfit"],
    ["$outfit.SHOES.0", "outfit"],
    ["outfit.SHOES", "outfit"],
    ["mood", "mood"],
    ["$mood", "mood"],
  ])("%s -> %s", (raw, want) => {
    expect(varBaseName(raw)).toBe(want);
  });

  it("leaves a shape that is not a valid reference untouched", () => {
    // Two indices is not legal syntax, so there is no base to reduce to —
    // returning `outfit` would claim a reference the engine will not resolve.
    expect(varBaseName("$outfit.0.1")).toBe("outfit.0.1");
    expect(varBaseName("$outfit.A.B.C")).toBe("outfit.A.B.C");
  });
});
