import { describe, it, expect } from "vitest";
import { buildReattachRemap, type InstallDependencyEdge } from "../reattach";

const deps = (...e: Array<[string, string]>): InstallDependencyEdge[] =>
  e.map(([module_id, slug]) => ({ module_id, slug }));

describe("buildReattachRemap", () => {
  it("collision-rename wins, even when the uuid also has a dep edge", () => {
    const remap = buildReattachRemap(
      ["aaaa1111"],
      deps(["aaaa1111", "author/sub"]),
      new Map([["author/sub", ["zzzz9999"]]]),
      new Set<string>(),
      { aaaa1111: "renamed01" },
    );
    expect(remap).toEqual({ aaaa1111: "renamed01" });
  });

  it("skips a uuid that already resolves locally (exact match)", () => {
    const remap = buildReattachRemap(
      ["aaaa1111"],
      deps(["aaaa1111", "author/sub"]),
      new Map([["author/sub", ["bbbb2222"]]]),
      new Set(["aaaa1111"]),
      {},
    );
    expect(remap).toEqual({});
  });

  it("slug-bridges a dangling uuid to the single local module for its dep slug", () => {
    const remap = buildReattachRemap(
      ["aaaa1111"],
      deps(["aaaa1111", "author/sub"]),
      new Map([["author/sub", ["bbbb2222"]]]),
      new Set<string>(),
      {},
    );
    expect(remap).toEqual({ aaaa1111: "bbbb2222" });
  });

  it("skips when the dep slug is not installed locally (zero matches)", () => {
    const remap = buildReattachRemap(
      ["aaaa1111"],
      deps(["aaaa1111", "author/sub"]),
      new Map(),
      new Set<string>(),
      {},
    );
    expect(remap).toEqual({});
  });

  it("skips when the dep slug maps to MULTIPLE local modules (ambiguous)", () => {
    const remap = buildReattachRemap(
      ["aaaa1111"],
      deps(["aaaa1111", "author/sub"]),
      new Map([["author/sub", ["bbbb2222", "cccc3333"]]]),
      new Set<string>(),
      {},
    );
    expect(remap).toEqual({});
  });

  it("skips a dangling uuid with no matching dep edge", () => {
    const remap = buildReattachRemap(
      ["aaaa1111"],
      deps(["dddd4444", "author/other"]),
      new Map([["author/other", ["bbbb2222"]]]),
      new Set<string>(),
      {},
    );
    expect(remap).toEqual({});
  });

  it("treats a nested-@{} uuid identically to a whole-id ref", () => {
    const remap = buildReattachRemap(
      ["aaaa1111", "eeee5555"],
      deps(["aaaa1111", "author/sub"], ["eeee5555", "author/mood"]),
      new Map([
        ["author/sub", ["bbbb2222"]],
        ["author/mood", ["ffff6666"]],
      ]),
      new Set<string>(),
      {},
    );
    expect(remap).toEqual({ aaaa1111: "bbbb2222", eeee5555: "ffff6666" });
  });

  it("ignores dep edges missing a module_id", () => {
    const remap = buildReattachRemap(
      ["aaaa1111"],
      [{ slug: "author/sub" }],
      new Map([["author/sub", ["bbbb2222"]]]),
      new Set<string>(),
      {},
    );
    expect(remap).toEqual({});
  });
});
