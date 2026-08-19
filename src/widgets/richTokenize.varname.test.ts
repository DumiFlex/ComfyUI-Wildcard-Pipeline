import { describe, it, expect } from "vitest";
import { varAccessorParts, varBaseName } from "./richTokenize";

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

describe("inlineTokenHtml — accessor sub-span", () => {
  it("splits the accessor into its own span inside one var atom", async () => {
    const { inlineTokenHtml } = await import("./richTokenize");
    const html = inlineTokenHtml("go $outfit.SHOES now");
    // One `.wp-rt-var` — the reference must still delete and move as a unit.
    expect(html.match(/class="wp-rt-var"/g)).toHaveLength(1);
    expect(html).toContain('<span class="wp-rt-var__accessor">.SHOES</span>');
  });

  it("leaves a plain variable as a single undivided span", async () => {
    const { inlineTokenHtml } = await import("./richTokenize");
    const html = inlineTokenHtml("go $outfit now");
    expect(html).not.toContain("wp-rt-var__accessor");
  });

  it("renders a numeric accessor in the NEUTRAL index span, not the axis span", async () => {
    const { inlineTokenHtml } = await import("./richTokenize");
    // A pick index is positional, not an axis, so it gets its own dimmed span
    // rather than the amber `__accessor`. (Was `__accessor">.0`.)
    const html = inlineTokenHtml("$mood.0");
    expect(html).toContain('__index">.0</span>');
    expect(html).not.toContain('__accessor">.0');
  });

  it("puts the index in __index and the axis in __accessor for `$o.0.SHOES`", async () => {
    const { inlineTokenHtml } = await import("./richTokenize");
    const html = inlineTokenHtml("$outfit.0.SHOES");
    expect(html).toContain('__index">.0</span>');
    expect(html).toContain('__accessor">.SHOES</span>');
  });
});

describe("varAccessorParts — index and axis, either order", () => {
  // The inline renderer used a hand-rolled `.replace(/\.\d+$/,"")` that only
  // stripped a TRAILING index, so `$outfit.0.SHOES` yielded axis "0.SHOES" —
  // matched no declared axis and wore the unknown-axis warning on a perfectly
  // valid reference. This is the parser that replaced it.
  it.each([
    ["$outfit.SHOES", { base: "outfit", axis: "SHOES" }],
    ["$outfit.0", { base: "outfit", index: 0 }],
    ["$outfit.0.SHOES", { base: "outfit", index: 0, axis: "SHOES" }],
    ["$outfit.SHOES.0", { base: "outfit", index: 0, axis: "SHOES" }],
    ["$mood", { base: "mood" }],
    ["outfit.12.EXPOSES", { base: "outfit", index: 12, axis: "EXPOSES" }],
  ])("%s parses correctly", (raw, want) => {
    expect(varAccessorParts(raw)).toEqual(want);
  });
});
