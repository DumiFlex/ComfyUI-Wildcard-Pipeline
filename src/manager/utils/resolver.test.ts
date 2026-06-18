import { describe, expect, it } from "vitest";
import { expandInlineChoices } from "./resolver";

describe("expandInlineChoices — branch weights (engine parity)", () => {
  it("strips the N:: weight prefix — never leaks into output", () => {
    for (let i = 0; i < 50; i++) {
      const out = expandInlineChoices("{2::a|b}");
      expect(["a", "b"]).toContain(out);
      expect(out).not.toContain("::");
    }
  });

  it("a zero-weight branch is never picked", () => {
    for (let i = 0; i < 50; i++) {
      expect(expandInlineChoices("{1::keep|0::drop}")).toBe("keep");
    }
  });

  it("user repro: {0::|, long shadows} resolves to the non-empty branch", () => {
    for (let i = 0; i < 50; i++) {
      expect(expandInlineChoices("{0::|, long shadows}")).toBe(", long shadows");
    }
  });

  it("unweighted choices still resolve to one branch verbatim", () => {
    const out = expandInlineChoices("{a|b|c}");
    expect(["a", "b", "c"]).toContain(out);
  });

  it("a literal foo::bar (non-numeric prefix) is left intact", () => {
    // Only a NUMERIC `N::` prefix is a weight; `http::x` style stays put.
    expect(expandInlineChoices("{x::y|x::y}")).toBe("x::y");
  });
});
