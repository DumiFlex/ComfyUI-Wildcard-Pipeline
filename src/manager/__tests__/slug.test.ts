import { describe, expect, it } from "vitest";
import { extractModuleUuid, toIdentifier, VALID_IDENTIFIER_RE } from "../utils/slug";

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

describe("extractModuleUuid", () => {
  it("returns the trailing 8-hex suffix from a normal DB id", () => {
    expect(extractModuleUuid("wc_test2_ea67b173")).toBe("ea67b173");
    expect(extractModuleUuid("co_subject_aabbccdd")).toBe("aabbccdd");
    expect(extractModuleUuid("fv_my_consts_00112233")).toBe("00112233");
  });

  it("accepts ids whose slug section contains digits and underscores", () => {
    expect(extractModuleUuid("wc_test_2_ea67b173")).toBe("ea67b173");
    expect(extractModuleUuid("wc_a_b_c_d_e_deadbeef")).toBe("deadbeef");
  });

  it("returns null when the id does not end in `_<8 lowercase hex>`", () => {
    expect(extractModuleUuid("wc_test2")).toBeNull();
    expect(extractModuleUuid("wc_test2_EA67B173")).toBeNull(); // uppercase rejected
    expect(extractModuleUuid("wc_test2_eaa67b173")).toBeNull(); // 9 chars
    expect(extractModuleUuid("wc_test2_ea67b17")).toBeNull(); // 7 chars
    expect(extractModuleUuid("ea67b173")).toBeNull(); // missing underscore prefix
    expect(extractModuleUuid("")).toBeNull();
  });
});
