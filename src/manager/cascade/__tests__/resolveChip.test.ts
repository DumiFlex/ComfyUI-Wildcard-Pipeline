import { describe, expect, it } from "vitest";

import {
  resolveWildcardChip,
  resolveOptionChip,
  resolveModuleChip,
  tokenizeRefString,
} from "../resolveChip";
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

/** Fixture covering every module kind — drives `resolveModuleChip`
 *  tests. Each kind has exactly ONE row with a distinct 8-hex id so
 *  the resolver's search order is testable. */
const kindFixture: LibraryFixture = {
  wildcards:    [{ id: "11111111", name: "mood",       payload: {} }],
  fixed_values: [{ id: "22222222", name: "globals",    payload: {} }],
  combines:     [{ id: "33333333", name: "joiner",     payload: {} }],
  derivations:  [{ id: "44444444", name: "if_rules",   payload: {} }],
  constraints:  [{ id: "55555555", name: "exclude",    payload: {} }],
  bundles:      [{ id: "66666666", name: "pack",       children: [] }],
  categories:   [],
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

describe("resolveModuleChip", () => {
  it("resolves wildcard kind by uuid", () => {
    expect(resolveModuleChip("11111111", kindFixture)).toEqual({
      name: "mood", kind: "wildcard", resolved: true,
    });
  });
  it("resolves fixed_values kind by uuid", () => {
    expect(resolveModuleChip("22222222", kindFixture)).toEqual({
      name: "globals", kind: "fixed_values", resolved: true,
    });
  });
  it("resolves combine kind by uuid", () => {
    expect(resolveModuleChip("33333333", kindFixture)).toEqual({
      name: "joiner", kind: "combine", resolved: true,
    });
  });
  it("resolves derivation kind by uuid", () => {
    expect(resolveModuleChip("44444444", kindFixture)).toEqual({
      name: "if_rules", kind: "derivation", resolved: true,
    });
  });
  it("resolves constraint kind by uuid — the bug-fix case from constraint_never_applied", () => {
    // The engine wraps a constraint module's own id as `@{uuid}` in the
    // `constraint_never_applied` warning text. Pre-fix this fell
    // through as an unresolved wildcard chip; now it reports
    // `kind: "constraint"` so RefChip paints with the pink palette
    // + pi-filter icon.
    expect(resolveModuleChip("55555555", kindFixture)).toEqual({
      name: "exclude", kind: "constraint", resolved: true,
    });
  });
  it("resolves bundle kind by uuid", () => {
    expect(resolveModuleChip("66666666", kindFixture)).toEqual({
      name: "pack", kind: "bundle", resolved: true,
    });
  });
  it("returns resolved:false for unknown uuid", () => {
    expect(resolveModuleChip("ffffffff", kindFixture)).toEqual({ resolved: false });
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
