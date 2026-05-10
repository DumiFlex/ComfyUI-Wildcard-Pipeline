// nextBindingSuffix — picks the lowest free `_N` suffix for a binding
// name given a set of bindings already in use. Strips an existing
// `_N` suffix from the input so multiple duplications of the same
// module yield `$foo`, `$foo_2`, `$foo_3` rather than `$foo_2`,
// `$foo_2_2`, `$foo_2_2_2`.

import { describe, it, expect } from "vitest";
import { nextBindingSuffix } from "./binding-suffix";

describe("nextBindingSuffix", () => {
  it("returns base_2 when only base is taken", () => {
    expect(nextBindingSuffix("foo", new Set(["foo"]))).toBe("foo_2");
  });

  it("skips taken suffixes", () => {
    expect(nextBindingSuffix("foo", new Set(["foo", "foo_2"]))).toBe("foo_3");
    expect(nextBindingSuffix("foo", new Set(["foo", "foo_2", "foo_3"]))).toBe("foo_4");
  });

  it("strips existing _N suffix to find canonical base", () => {
    expect(nextBindingSuffix("foo_2", new Set(["foo", "foo_2"]))).toBe("foo_3");
    expect(nextBindingSuffix("foo_5", new Set(["foo", "foo_2", "foo_5"]))).toBe("foo_3");
  });

  it("treats names with embedded numbers but no _N suffix as canonical bases", () => {
    expect(nextBindingSuffix("hair2style", new Set(["hair2style"]))).toBe("hair2style_2");
  });

  it("returns base_2 when no taken bindings overlap", () => {
    expect(nextBindingSuffix("foo", new Set())).toBe("foo_2");
    expect(nextBindingSuffix("foo", new Set(["bar", "baz"]))).toBe("foo_2");
  });

  it("uses safety fallback after 1000 collisions", () => {
    const taken = new Set<string>();
    for (let i = 1; i < 1000; i++) taken.add(`foo_${i}`);
    taken.add("foo");
    const result = nextBindingSuffix("foo", taken);
    expect(result).toMatch(/^foo_\d+$/);
    expect(result.length).toBeGreaterThan(4);
  });
});
