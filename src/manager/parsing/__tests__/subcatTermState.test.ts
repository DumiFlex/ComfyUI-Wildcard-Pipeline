import { describe, it, expect } from "vitest";
import { parse } from "../subcatFilter";
import {
  collectTermPolarity,
  livingTags,
  nearestTerm,
  termState,
} from "../subcatTermState";

const polarityOf = (expr: string) => collectTermPolarity(parse(expr));

describe("collectTermPolarity", () => {
  it("marks a plain term positive", () => {
    expect(polarityOf("warm").get("warm")).toBe("pos");
  });

  it("marks a negated term negative", () => {
    expect(polarityOf("not warm").get("warm")).toBe("neg");
  });

  it("flips back on a double negation, matching the parser's semantics", () => {
    expect(polarityOf("not (not warm)").get("warm")).toBe("pos");
  });

  it("carries negation down through a group", () => {
    const p = polarityOf("not (warm or cool)");
    expect(p.get("warm")).toBe("neg");
    expect(p.get("cool")).toBe("neg");
  });

  it("keeps each side's own polarity in a mixed expression", () => {
    const p = polarityOf("(warm or cool) and not vivid");
    expect(p.get("warm")).toBe("pos");
    expect(p.get("cool")).toBe("pos");
    expect(p.get("vivid")).toBe("neg");
  });

  it("lets positive win when a tag appears both ways", () => {
    // Legal if useless. The chip should read as participating; the negation is
    // still visible in the expression text itself.
    expect(polarityOf("warm or not warm").get("warm")).toBe("pos");
  });

  it("returns an empty map for an empty expression", () => {
    expect(collectTermPolarity(parse("")).size).toBe(0);
  });
});

describe("livingTags", () => {
  it("collects every tag carried by at least one option", () => {
    expect([...livingTags([["warm"], ["cool", "warm"], []])].sort())
      .toEqual(["cool", "warm"]);
  });

  it("is empty when no option carries anything", () => {
    expect(livingTags([[], []]).size).toBe(0);
  });
});

describe("termState", () => {
  const live = livingTags([["warm"], ["cool"]]);

  it("idle when unused but carried by an option", () => {
    expect(termState("warm", polarityOf(""), live)).toBe("idle");
  });

  it("in when used positively", () => {
    expect(termState("warm", polarityOf("warm"), live)).toBe("in");
  });

  it("negated when used under a not", () => {
    expect(termState("warm", polarityOf("not warm"), live)).toBe("negated");
  });

  it("dead when declared but carried by NO option — the original trap", () => {
    expect(termState("skin-tone", polarityOf(""), live)).toBe("dead");
  });

  it("shows what the expression does with a dead tag rather than 'dead'", () => {
    // The zero-match warning already covers this; two alarms for one mistake
    // is noise, so participation wins the chip.
    expect(termState("skin-tone", polarityOf("skin-tone"), live)).toBe("in");
  });
});

describe("nearestTerm", () => {
  const known = ["warm", "cool", "cold", "vivid", "hair-natural"];

  it("offers a one-edit correction", () => {
    expect(nearestTerm("colde", known)).toBe("cold");
  });

  it("allows two edits on a longer word", () => {
    expect(nearestTerm("hair-naturel", known)).toBe("hair-natural");
  });

  it("stays silent when nothing is close — a wrong guess is worse than none", () => {
    expect(nearestTerm("magenta", known)).toBeNull();
  });

  it("never suggests the word itself", () => {
    expect(nearestTerm("warm", known)).toBeNull();
  });

  it("is case-insensitive about the typed term", () => {
    expect(nearestTerm("COLDE", known)).toBe("cold");
  });

  it("returns null against an empty vocabulary", () => {
    expect(nearestTerm("warm", [])).toBeNull();
  });
});
