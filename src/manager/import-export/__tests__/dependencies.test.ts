import { describe, expect, it } from "vitest";
import { listReferencedUuids, type ReferencingModule } from "../dependencies";

/** Minimal module-shape builder. `listReferencedUuids` reads only
 *  `id` / `type` / `payload`, so the test fixtures carry just those —
 *  matching the structural intersection of `ModuleRow` and `ModuleEntry`
 *  the helper accepts. */
function mod(parts: Partial<ReferencingModule> & { id: string; type: ReferencingModule["type"] }): ReferencingModule {
  return { payload: {}, ...parts };
}

describe("listReferencedUuids", () => {
  describe("constraint", () => {
    it("returns [source, target]", () => {
      const m = mod({
        id: "cccc1111",
        type: "constraint",
        payload: { source_wildcard_id: "aaaa1111", target_wildcard_id: "bbbb2222" },
      });
      expect(new Set(listReferencedUuids(m))).toEqual(new Set(["aaaa1111", "bbbb2222"]));
    });

    it("skips a null target (keeps the source)", () => {
      const m = mod({
        id: "cccc1111",
        type: "constraint",
        payload: { source_wildcard_id: "aaaa1111", target_wildcard_id: null },
      });
      expect(listReferencedUuids(m)).toEqual(["aaaa1111"]);
    });

    it("skips empty / whitespace-only ids", () => {
      const m = mod({
        id: "cccc1111",
        type: "constraint",
        payload: { source_wildcard_id: "", target_wildcard_id: "   " },
      });
      expect(listReferencedUuids(m)).toEqual([]);
    });

    it("combines source/target with `@{}` refs in exceptions", () => {
      const m = mod({
        id: "cccc1111",
        type: "constraint",
        payload: {
          source_wildcard_id: "aaaa1111",
          target_wildcard_id: "bbbb2222",
          exceptions: [
            { source: "see @{dddd4444}", target: "literal", mode: "exclude", factor: 0 },
            { source_value: "@{eeee5555}", target_value: "@{ffff6666}", mode: "boost", factor: 2 },
          ],
        },
      });
      expect(new Set(listReferencedUuids(m))).toEqual(
        new Set(["aaaa1111", "bbbb2222", "dddd4444", "eeee5555", "ffff6666"]),
      );
    });
  });

  describe("wildcard", () => {
    it("returns the `@{uuid}` ref inside an option value", () => {
      const m = mod({
        id: "11111111",
        type: "wildcard",
        payload: { options: [{ id: "o1", value: "a @{a1b2c3d4} b", weight: 1 }] },
      });
      expect(listReferencedUuids(m)).toEqual(["a1b2c3d4"]);
    });

    it("dedupes across multiple options + multiple refs", () => {
      const m = mod({
        id: "11111111",
        type: "wildcard",
        payload: {
          options: [
            { id: "o1", value: "@{aaaaaaaa} and @{bbbbbbbb}", weight: 1 },
            { id: "o2", value: "@{aaaaaaaa} again", weight: 1 },
          ],
        },
      });
      expect(new Set(listReferencedUuids(m))).toEqual(new Set(["aaaaaaaa", "bbbbbbbb"]));
      expect(listReferencedUuids(m)).toHaveLength(2);
    });
  });

  describe("derivation", () => {
    it("returns `@{}` refs from branch action values and the else action value", () => {
      const m = mod({
        id: "dddd1111",
        type: "derivation",
        payload: {
          rules: [
            {
              id: "r1",
              branches: [
                {
                  condition: { var: "mood", op: "equals", value: "x" },
                  action: { target_var: "out", mode: "replace", value: "branch @{aaaaaaaa}" },
                },
              ],
              else: { action: { target_var: "out", mode: "replace", value: "else @{bbbbbbbb}" } },
            },
          ],
        },
      });
      expect(new Set(listReferencedUuids(m))).toEqual(new Set(["aaaaaaaa", "bbbbbbbb"]));
    });

    it("handles missing/optional rule shapes without throwing", () => {
      const m = mod({
        id: "dddd1111",
        type: "derivation",
        payload: { rules: [{ id: "r1" }, { id: "r2", branches: [] }] },
      });
      expect(listReferencedUuids(m)).toEqual([]);
    });
  });

  describe("self-reference exclusion", () => {
    it("excludes the module's OWN id", () => {
      const m = mod({
        id: "a1b2c3d4",
        type: "wildcard",
        payload: { options: [{ id: "o1", value: "self @{a1b2c3d4} and @{bbbbbbbb}", weight: 1 }] },
      });
      expect(listReferencedUuids(m)).toEqual(["bbbbbbbb"]);
    });

    it("excludes a self-referencing constraint source", () => {
      const m = mod({
        id: "cccc1111",
        type: "constraint",
        payload: { source_wildcard_id: "cccc1111", target_wildcard_id: "bbbb2222" },
      });
      expect(listReferencedUuids(m)).toEqual(["bbbb2222"]);
    });
  });

  describe("types without refs", () => {
    it("fixed_values returns []", () => {
      expect(listReferencedUuids(mod({ id: "ffff1111", type: "fixed_values", payload: { values: [{ name: "x", value: "y" }] } }))).toEqual([]);
    });

    it("combine returns [] (templates treat `@{}` as literal text)", () => {
      expect(
        listReferencedUuids(mod({ id: "cccc9999", type: "combine", payload: { template: "hi @{aaaaaaaa}", output_var: "o", input_vars: [] } })),
      ).toEqual([]);
    });

    it("bundle returns []", () => {
      expect(
        listReferencedUuids(mod({ id: "bbbb1111", type: "bundle", payload: { children: [{ id: "aaaaaaaa", type: "wildcard" }] } })),
      ).toEqual([]);
    });

    it("a wildcard with no refs returns []", () => {
      expect(
        listReferencedUuids(mod({ id: "11111111", type: "wildcard", payload: { options: [{ id: "o1", value: "plain text", weight: 1 }] } })),
      ).toEqual([]);
    });

    it("a constraint with no ids and no exceptions returns []", () => {
      expect(listReferencedUuids(mod({ id: "cccc1111", type: "constraint", payload: {} }))).toEqual([]);
    });
  });
});
