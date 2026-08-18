import { describe, it, expect } from "vitest";
import { probeAutocomplete } from "./autocompleteProbe";

describe("probeAutocomplete", () => {
  it("triggers on a plain $var", () => {
    expect(probeAutocomplete("$sty", 4)).toEqual({ start: 0, query: "sty", trigger: "$" });
  });

  it("triggers on a plain @ref", () => {
    expect(probeAutocomplete("@col", 4)).toEqual({ start: 0, query: "col", trigger: "@" });
  });

  it("does NOT trigger on a `$$` escape followed by a literal", () => {
    // `$$x` = literal `$` + text `x` — even run, no var.
    expect(probeAutocomplete("$$x", 3)).toBeNull();
  });

  it("triggers on a $var that abuts the $$sep$$ multi-pick delimiter (the bug)", () => {
    // `{3$$,$$$style` — the `$$` closing delimiter + `$style` var branch.
    const s = "{3$$,$$$style";
    expect(probeAutocomplete(s, s.length)).toEqual({
      start: s.length - "style".length - 1, // index of the unpaired `$`
      query: "style",
      trigger: "$",
    });
  });

  it("does NOT trigger inside an even ($$$$) run", () => {
    expect(probeAutocomplete("$$$$x", 5)).toBeNull();
  });

  it("keeps the $mood.0 accessor resolving back to the $ trigger (SP2a)", () => {
    // The `.K` skip relocates the backward scan past the accessor so the
    // trigger is still found at `$`; the query slices through to the caret.
    expect(probeAutocomplete("$mood.0", 7)).toEqual({ start: 0, query: "mood.0", trigger: "$" });
  });

  it("returns null when there is no trigger before the caret", () => {
    expect(probeAutocomplete("plain text", 10)).toBeNull();
  });

  // The `@{uuid#name}` brace form is an internal serialisation the user never
  // types, and a space commits the chip rather than extending the query — so
  // neither is a valid query shape and the probe must not claim them.

  it("does NOT treat an inline brace block as a trigger", () => {
    expect(probeAutocomplete("{a|b", 4)).toBeNull();
  });

  it("stops at a space — the settle delimiter that commits a chip", () => {
    expect(probeAutocomplete("@pose pool", 10)).toBeNull();
  });
});

describe("probeAutocomplete — accessor accessors keep the $ trigger", () => {
  // Without these the probe met a dot it did not recognise, gave up, and the
  // booru-tag probe took the caret — offering shoe TAGS for `$outfit.SHOES`,
  // none of which can be inserted at that position.
  it("walks back over an axis accessor", () => {
    const p = probeAutocomplete("wearing $outfit.SHOES", 21);
    expect(p).toMatchObject({ trigger: "$", query: "outfit.SHOES" });
  });

  it("walks back over an index then an axis", () => {
    const p = probeAutocomplete("$outfit.0.SHOES", 15);
    expect(p).toMatchObject({ trigger: "$", query: "outfit.0.SHOES" });
  });

  it("walks back over an axis then an index", () => {
    const p = probeAutocomplete("$outfit.SHOES.1", 15);
    expect(p).toMatchObject({ trigger: "$", query: "outfit.SHOES.1" });
  });

  it("still handles the plain list accessor", () => {
    expect(probeAutocomplete("$mood.0", 7)).toMatchObject({ query: "mood.0" });
  });

  it("stops after two segments, so prose is not swallowed", () => {
    // `a.b.c.d` is not a reference; the probe must not chew backwards through
    // an entire dotted sentence looking for a sigil.
    expect(probeAutocomplete("see file.tar.gz.bak", 19)).toBeNull();
  });
});
