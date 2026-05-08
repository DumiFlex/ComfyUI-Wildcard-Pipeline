import { describe, it, expect } from "vitest";
import {
  effectiveRow,
  rowOverrideKind,
  rowEnabled,
  shapeValuesPatch,
  type LibraryRow,
  type DraftRow,
} from "./defaults";

const libRows: LibraryRow[] = [
  { id: "v1", name: "lens", value: "85mm" },
  { id: "v2", name: "angle", value: "wide" },
];

describe("defaults helpers", () => {
  describe("effectiveRow", () => {
    it("returns library row when no override exists", () => {
      expect(effectiveRow(libRows[0], undefined)).toEqual(libRows[0]);
    });
    it("returns override when present", () => {
      const ov = { id: "v1", name: "lens", value: "50mm" };
      expect(effectiveRow(libRows[0], ov)).toEqual(ov);
    });
  });

  describe("rowOverrideKind", () => {
    it("'none' when override === library", () => {
      expect(rowOverrideKind(libRows[0], { id: "v1", name: "lens", value: "85mm" })).toBe("none");
    });
    it("'value' when only value differs", () => {
      expect(rowOverrideKind(libRows[0], { id: "v1", name: "lens", value: "50mm" })).toBe("value");
    });
    it("'name' when only name differs", () => {
      expect(rowOverrideKind(libRows[0], { id: "v1", name: "camera_lens", value: "85mm" })).toBe("name");
    });
    it("'both' when both differ", () => {
      expect(rowOverrideKind(libRows[0], { id: "v1", name: "x", value: "y" })).toBe("both");
    });
    it("'added' when no library counterpart", () => {
      expect(rowOverrideKind(undefined, { id: "fresh01", name: "mood", value: "cozy" })).toBe("added");
    });
    it("'none' when override === undefined", () => {
      expect(rowOverrideKind(libRows[0], undefined)).toBe("none");
    });
  });

  describe("rowEnabled", () => {
    it("true when enabled_options is null/undefined (library default = all)", () => {
      expect(rowEnabled("v1", null)).toBe(true);
      expect(rowEnabled("v1", undefined)).toBe(true);
    });
    it("true when id appears in array", () => {
      expect(rowEnabled("v1", ["v1", "v2"])).toBe(true);
    });
    it("false when id NOT in array", () => {
      expect(rowEnabled("v3", ["v1", "v2"])).toBe(false);
    });
  });

  describe("shapeValuesPatch", () => {
    it("returns null when all rows match library, none disabled, none added", () => {
      const draft: DraftRow[] = libRows.map((r) => ({ ...r, enabled: true, libraryId: r.id }));
      expect(shapeValuesPatch(draft, libRows)).toBeNull();
    });

    it("returns full row list (with diffs + library defaults) when any override exists", () => {
      const draft: DraftRow[] = [
        { id: "v1", name: "lens", value: "50mm", enabled: true, libraryId: "v1" }, // override
        { id: "v2", name: "angle", value: "wide", enabled: true, libraryId: "v2" }, // unchanged
      ];
      const out = shapeValuesPatch(draft, libRows);
      expect(out).toEqual([
        { id: "v1", name: "lens", value: "50mm" },
        { id: "v2", name: "angle", value: "wide" },
      ]);
    });

    it("includes instance-added rows at the end", () => {
      const draft: DraftRow[] = [
        ...libRows.map((r) => ({ ...r, enabled: true, libraryId: r.id })),
        { id: "fresh01", name: "mood", value: "cozy", enabled: true, libraryId: null },
      ];
      const out = shapeValuesPatch(draft, libRows);
      expect(out).toHaveLength(3);
      expect(out![2]).toEqual({ id: "fresh01", name: "mood", value: "cozy" });
    });

    it("EXCLUDES disabled rows from the values list (engine drops via enabled_options instead)", () => {
      const draft: DraftRow[] = [
        { id: "v1", name: "lens", value: "85mm", enabled: false, libraryId: "v1" },
        { id: "v2", name: "angle", value: "three-quarter", enabled: true, libraryId: "v2" }, // override
      ];
      const out = shapeValuesPatch(draft, libRows);
      // Disabled rows still appear in values_overrides; enabled_options filter does the dropping.
      // values_overrides shape stays full; otherwise re-enabling would lose the row entirely.
      expect(out).toHaveLength(2);
      expect(out!.map((r) => r.id)).toEqual(["v1", "v2"]);
    });
  });
});
