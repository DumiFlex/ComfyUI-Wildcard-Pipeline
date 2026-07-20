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

describe("expandInlineChoices — multi-pick {N-M$$sep$$…} (engine parity)", () => {
  it("fixed count picks exactly N unique branches joined by sep", () => {
    for (let i = 0; i < 50; i++) {
      const out = expandInlineChoices("{2$$, $$a|b|c}");
      const parts = out.split(", ");
      expect(parts).toHaveLength(2);
      expect(new Set(parts).size).toBe(2); // unique (no replacement)
      for (const p of parts) expect(["a", "b", "c"]).toContain(p);
      expect(out).not.toContain("$$");
    }
  });

  it("range count picks between min and max branches", () => {
    const counts = new Set<number>();
    for (let i = 0; i < 100; i++) {
      const out = expandInlineChoices("{1-2$$, $$a|b|c}");
      const parts = out.split(", ");
      expect(parts.length).toBeGreaterThanOrEqual(1);
      expect(parts.length).toBeLessThanOrEqual(2);
      counts.add(parts.length);
      expect(out).not.toContain("$$");
    }
    // Over 100 draws a 1-2 range should exercise both counts.
    expect(counts.has(1) && counts.has(2)).toBe(true);
  });

  it("empty separator concatenates the picks", () => {
    for (let i = 0; i < 30; i++) {
      const out = expandInlineChoices("{2$$$$a|b}");
      expect(["ab", "ba"]).toContain(out);
    }
  });

  it("independent (~) draws WITH replacement — repeats allowed", () => {
    let sawRepeat = false;
    for (let i = 0; i < 100; i++) {
      const out = expandInlineChoices("{2~$$, $$a|b}");
      const parts = out.split(", ");
      expect(parts).toHaveLength(2);
      for (const p of parts) expect(["a", "b"]).toContain(p);
      if (parts[0] === parts[1]) sawRepeat = true;
    }
    expect(sawRepeat).toBe(true); // replacement makes a|a / b|b possible
  });

  it("user repro: {1-2$$, $$smirk|smug|half-closed eyes} never leaks the raw prefix", () => {
    for (let i = 0; i < 50; i++) {
      const out = expandInlineChoices(
        "dark brown eyes, {1-2$$, $$smirk|smug|half-closed eyes}",
      );
      expect(out).not.toContain("$$");
      expect(out).not.toContain("1-2");
      expect(out.startsWith("dark brown eyes, ")).toBe(true);
      const picked = out.slice("dark brown eyes, ".length).split(", ");
      for (const p of picked) expect(["smirk", "smug", "half-closed eyes"]).toContain(p);
    }
  });
});
