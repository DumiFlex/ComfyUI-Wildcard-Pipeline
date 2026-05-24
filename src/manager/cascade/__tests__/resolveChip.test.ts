import { describe, expect, it } from "vitest";

import { resolveWildcardChip, resolveOptionChip, tokenizeRefString } from "../resolveChip";
import type { LibraryFixture } from "../reverse-dep-index";

const fixture: LibraryFixture = {
  wildcards: [
    {
      id: "deadbeef",
      name: "mood",
      payload: {
        sub_categories: ["positive"],
        options: [
          { id: "opt_aaaa", value: "serene", sub_category: "positive" },
        ],
      },
    },
  ],
  constraints: [],
  fixed_values: [],
  combines: [],
  derivations: [],
  bundles: [],
  categories: [],
};

describe("resolveWildcardChip", () => {
  it("returns name for known uuid", () => {
    expect(resolveWildcardChip("deadbeef", fixture)).toEqual({ name: "mood", missing: false });
  });
  it("returns missing for unknown uuid", () => {
    expect(resolveWildcardChip("cafef00d", fixture)).toEqual({ raw: "cafef00d", missing: true });
  });
});

describe("resolveOptionChip", () => {
  it("returns value for known option_id", () => {
    expect(resolveOptionChip("deadbeef", "opt_aaaa", fixture)).toEqual({ name: "serene", missing: false });
  });
  it("returns missing for unknown option_id", () => {
    expect(resolveOptionChip("deadbeef", "cafef00d", fixture)).toEqual({ raw: "cafef00d", missing: true });
  });
  it("returns missing for unknown wildcard", () => {
    expect(resolveOptionChip("1a2b3c4d", "opt_aaaa", fixture)).toEqual({ raw: "opt_aaaa", missing: true });
  });
});

describe("tokenizeRefString", () => {
  it("splits text and ref tokens", () => {
    const out = tokenizeRefString("i love @{deadbeef} and @{deadbeef:positive}");
    expect(out).toEqual([
      { type: "text", value: "i love " },
      { type: "ref", uuid: "deadbeef", subcat: undefined },
      { type: "text", value: " and " },
      { type: "ref", uuid: "deadbeef", subcat: "positive" },
    ]);
  });
  it("returns single text token for ref-free string", () => {
    expect(tokenizeRefString("plain")).toEqual([{ type: "text", value: "plain" }]);
  });
  it("returns empty array for empty string", () => {
    expect(tokenizeRefString("")).toEqual([]);
  });
});
