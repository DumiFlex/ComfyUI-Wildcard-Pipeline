import { describe, it, expect } from "vitest";
import { baseCodename, assignCodenames } from "./node-codename";

describe("baseCodename", () => {
  it("is a lowercase adjective-noun pair", () => {
    expect(baseCodename(7)).toMatch(/^[a-z]+-[a-z]+$/);
  });

  it("is deterministic — same id always yields the same name", () => {
    expect(baseCodename(42)).toBe(baseCodename(42));
    expect(baseCodename("node-99")).toBe(baseCodename("node-99"));
  });

  it("treats numeric and string forms of an id identically", () => {
    // Litegraph ids are numbers; some call sites stringify. Both must agree.
    expect(baseCodename(13)).toBe(baseCodename("13"));
  });

  it("spreads distinct ids across distinct names (mostly)", () => {
    // Not a uniqueness guarantee (that's assignCodenames' job) — just a
    // sanity check that the hash actually varies the output.
    const names = new Set(Array.from({ length: 50 }, (_, i) => baseCodename(i)));
    expect(names.size).toBeGreaterThan(40);
  });
});

describe("assignCodenames", () => {
  it("maps each id to its base codename when there are no collisions", () => {
    const ids = [1, 2, 3];
    const map = assignCodenames(ids);
    for (const id of ids) {
      // No collision among these → pure base name, no suffix.
      expect(map.get(String(id))).toBe(baseCodename(id));
    }
  });

  it("GUARANTEES uniqueness across a large id set (the core contract)", () => {
    // Even if base codenames collide within this set, every assigned name
    // must be distinct — that's the "does not duplicate on the canvas"
    // guarantee. 300 ids comfortably forces some base collisions at 4096
    // combos, exercising the dedup path.
    const ids = Array.from({ length: 300 }, (_, i) => i + 1);
    const map = assignCodenames(ids);
    const values = [...map.values()];
    expect(values.length).toBe(ids.length);
    expect(new Set(values).size).toBe(ids.length); // all unique
  });

  it("deduped names keep the adjective-noun base + a numeric suffix", () => {
    const ids = Array.from({ length: 300 }, (_, i) => i + 1);
    for (const name of assignCodenames(ids).values()) {
      expect(name).toMatch(/^[a-z]+-[a-z]+(-\d+)?$/);
    }
  });

  it("is order-independent: the assigned name for an id doesn't depend on input order", () => {
    // Stable identity — feeding the same id set in any order yields the same
    // per-id name (dedup resolves deterministically by id, not arrival order).
    const a = assignCodenames([10, 20, 30, 40]);
    const b = assignCodenames([40, 10, 30, 20]);
    for (const id of [10, 20, 30, 40]) {
      expect(b.get(String(id))).toBe(a.get(String(id)));
    }
  });

  it("handles an empty input", () => {
    expect(assignCodenames([]).size).toBe(0);
  });
});
