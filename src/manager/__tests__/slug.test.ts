import { describe, expect, it } from "vitest";
import { toIdentifier, VALID_IDENTIFIER_RE } from "../utils/slug";

describe("toIdentifier", () => {
  it("lowercases and slug-joins runs of non-identifier chars", () => {
    expect(toIdentifier("Hello World")).toBe("hello_world");
    expect(toIdentifier("Foo--Bar  Baz")).toBe("foo_bar_baz");
  });

  it("strips leading/trailing underscores left over from punctuation", () => {
    expect(toIdentifier("  Outfit!  ")).toBe("outfit");
    expect(toIdentifier("--name--")).toBe("name");
  });

  it("prefixes wc_ when the result would start with a digit", () => {
    expect(toIdentifier("123 Things")).toBe("wc_123_things");
    expect(toIdentifier("9lives")).toBe("wc_9lives");
  });

  it("returns wc_x for empty / fully-stripped inputs", () => {
    expect(toIdentifier("")).toBe("wc_x");
    expect(toIdentifier("   ")).toBe("wc_x");
    expect(toIdentifier("???")).toBe("wc_x");
  });

  it("preserves already-valid identifiers (after lowercasing)", () => {
    expect(toIdentifier("subject_phrase")).toBe("subject_phrase");
    expect(toIdentifier("HairColor")).toBe("haircolor");
  });

  it("produces output that always satisfies VALID_IDENTIFIER_RE", () => {
    for (const input of ["Hello World", "123 zip", "", "$$$", "Foo!Bar"]) {
      expect(toIdentifier(input)).toMatch(VALID_IDENTIFIER_RE);
    }
  });
});

