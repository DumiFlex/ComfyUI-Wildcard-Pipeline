import { describe, it, expect } from "vitest";
import { highlightExpression, type ExprToken } from "../exprHighlight";

const known = new Set(["warm", "cool", "hair-natural", "two_tone"]);
const kinds = (src: string) => highlightExpression(src, known).map((t) => `${t.kind}:${t.text}`);

describe("highlightExpression", () => {
  it("separates terms, operators and parens", () => {
    expect(kinds("(warm or cool)")).toEqual([
      "paren:(", "term:warm", "space: ", "op:or", "space: ", "term:cool", "paren:)",
    ]);
  });

  it("marks a word the wildcard does not declare", () => {
    expect(kinds("warmm")).toEqual(["bad:warmm"]);
  });

  it("treats operators case-insensitively, as the parser does", () => {
    expect(kinds("warm AND cool").filter((k) => k.startsWith("op"))).toEqual(["op:AND"]);
  });

  it("keeps hyphens and underscores inside a tag rather than splitting it", () => {
    expect(kinds("hair-natural or two_tone")).toEqual([
      "term:hair-natural", "space: ", "op:or", "space: ", "term:two_tone",
    ]);
  });

  it("REPRODUCES the source exactly — the mirror depends on it", () => {
    // Every character must land in exactly one token, in order. If this drifts,
    // the colours slide off the characters they belong to.
    for (const src of [
      "(warm or cool) and not vivid",
      "  warm   or\tcool  ",
      "warm and (cool",
      "",
      "!!weird??",
    ]) {
      const joined = highlightExpression(src, known).map((t: ExprToken) => t.text).join("");
      expect(joined).toBe(src);
    }
  });

  it("preserves runs of whitespace verbatim, not collapsed", () => {
    expect(kinds("warm   or cool")[1]).toBe("space:   ");
  });

  it("tokenizes text that does NOT parse — that is the point", () => {
    // The validator refuses this; the highlighter still has to colour it,
    // because the user is mid-keystroke.
    expect(kinds("warm and")).toEqual(["term:warm", "space: ", "op:and"]);
  });

  it("marks stray punctuation rather than dropping it", () => {
    expect(kinds("warm & cool")[2]).toBe("bad:&");
  });

  it("returns nothing for an empty expression", () => {
    expect(highlightExpression("", known)).toEqual([]);
  });

  it("marks everything bad when the wildcard declares no tags", () => {
    expect(highlightExpression("warm", new Set()).map((t) => t.kind)).toEqual(["bad"]);
  });
});
