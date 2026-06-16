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
});
