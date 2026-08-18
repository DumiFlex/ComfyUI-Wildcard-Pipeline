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

  it("splits a numeric accessor the same way", async () => {
    const { inlineTokenHtml } = await import("./richTokenize");
    expect(inlineTokenHtml("$mood.0")).toContain('__accessor">.0</span>');
  });
});
