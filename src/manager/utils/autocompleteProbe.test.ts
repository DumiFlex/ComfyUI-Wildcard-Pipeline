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

  // --- Partial brace-form refs (`@{…`) -----------------------------------
  // The canonical stored form is `@{uuid#name}`, so users type the `{`, and
  // display names carry spaces + dashes. The bare-identifier scan rejected
  // all of it, so the popover died on the documented syntax and only came
  // back after deleting the whole run.

  it("keeps the popover alive the moment the user types `@{`", () => {
    expect(probeAutocomplete("@{", 2)).toEqual({ start: 0, query: "", trigger: "@" });
  });

  it("treats a partial `@{name` as an @ query", () => {
    expect(probeAutocomplete("@{pose", 6)).toEqual({ start: 0, query: "pose", trigger: "@" });
  });

  it("keeps matching across spaces and dashes in a display name", () => {
    const s = "@{Pose pool — presenting";
    expect(probeAutocomplete(s, s.length)).toEqual({
      start: 0,
      query: "Pose pool — presenting",
      trigger: "@",
    });
  });

  it("stops once the ref is closed", () => {
    // `}` present before the caret — the ref is complete, don't reopen.
    expect(probeAutocomplete("@{aabbccdd}", 11)).toBeNull();
  });

  it("does NOT treat an inline brace block as a ref", () => {
    // `{a|b|c}` is multi-arm inline syntax, not a nested ref — no `@` before
    // the brace, so the ref branch must not claim it.
    expect(probeAutocomplete("{a|b", 4)).toBeNull();
  });

  it("probes the LAST open brace when a completed chip precedes the caret", () => {
    const s = "@{aabbccdd#Portrait} and @{pos";
    expect(probeAutocomplete(s, s.length)).toEqual({
      start: s.indexOf("@{pos"),
      query: "pos",
      trigger: "@",
    });
  });
});
