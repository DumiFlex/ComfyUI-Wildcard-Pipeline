import { describe, it, expect } from "vitest";
import {
  moveModule,
  moveModuleUp,
  moveModuleDown,
  moveModuleToTop,
  moveModuleToBottom,
  duplicateModule,
  insertModuleAt,
  removeModuleAt,
} from "../actions";
import { DISMISSABLE_CONFLICT_TYPES } from "@/types";
import type { PipelineModule, WildcardModule } from "@/types";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeModules(count: number): PipelineModule[] {
  return Array.from({ length: count }, (_, i) => ({
    type: "wildcard" as const,
    capture_as: `$var${i}`,
  }));
}

function labels(modules: PipelineModule[]): string[] {
  return modules.map(m => ("capture_as" in m ? m.capture_as ?? "" : ""));
}

// ---------------------------------------------------------------------------
// moveModule
// ---------------------------------------------------------------------------

describe("moveModule", () => {
  it("moves a module from one index to another", () => {
    const mods = makeModules(3); // $var0, $var1, $var2
    const result = moveModule(mods, 0, 2);
    expect(labels(result)).toEqual(["$var1", "$var2", "$var0"]);
  });

  it("returns a copy when fromIndex === toIndex", () => {
    const mods = makeModules(3);
    const result = moveModule(mods, 1, 1);
    expect(result).not.toBe(mods);
    expect(labels(result)).toEqual(["$var0", "$var1", "$var2"]);
  });

  it("returns unchanged copy for out-of-bounds fromIndex", () => {
    const mods = makeModules(3);
    const result = moveModule(mods, 5, 1);
    expect(labels(result)).toEqual(["$var0", "$var1", "$var2"]);
  });

  it("returns unchanged copy for out-of-bounds toIndex", () => {
    const mods = makeModules(3);
    const result = moveModule(mods, 0, 10);
    expect(labels(result)).toEqual(["$var0", "$var1", "$var2"]);
  });

  it("does not mutate the original array", () => {
    const mods = makeModules(3);
    const original = [...mods];
    moveModule(mods, 0, 2);
    expect(mods).toEqual(original);
  });
});

// ---------------------------------------------------------------------------
// moveModuleUp
// ---------------------------------------------------------------------------

describe("moveModuleUp", () => {
  it("moves module at index 1 up to index 0", () => {
    const mods = makeModules(3);
    const result = moveModuleUp(mods, 1);
    expect(labels(result)).toEqual(["$var1", "$var0", "$var2"]);
  });

  it("moves module at last index up by 1", () => {
    const mods = makeModules(3);
    const result = moveModuleUp(mods, 2);
    expect(labels(result)).toEqual(["$var0", "$var2", "$var1"]);
  });

  it("no-op when already at index 0", () => {
    const mods = makeModules(3);
    const result = moveModuleUp(mods, 0);
    expect(labels(result)).toEqual(["$var0", "$var1", "$var2"]);
  });

  it("no-op on single-element array", () => {
    const mods = makeModules(1);
    const result = moveModuleUp(mods, 0);
    expect(labels(result)).toEqual(["$var0"]);
  });

  it("returns a new array (no mutation)", () => {
    const mods = makeModules(3);
    const result = moveModuleUp(mods, 2);
    expect(result).not.toBe(mods);
  });
});

// ---------------------------------------------------------------------------
// moveModuleDown
// ---------------------------------------------------------------------------

describe("moveModuleDown", () => {
  it("moves module at index 0 down to index 1", () => {
    const mods = makeModules(3);
    const result = moveModuleDown(mods, 0);
    expect(labels(result)).toEqual(["$var1", "$var0", "$var2"]);
  });

  it("moves module at index 1 down to index 2", () => {
    const mods = makeModules(3);
    const result = moveModuleDown(mods, 1);
    expect(labels(result)).toEqual(["$var0", "$var2", "$var1"]);
  });

  it("no-op when already at last index", () => {
    const mods = makeModules(3);
    const result = moveModuleDown(mods, 2);
    expect(labels(result)).toEqual(["$var0", "$var1", "$var2"]);
  });

  it("no-op on single-element array", () => {
    const mods = makeModules(1);
    const result = moveModuleDown(mods, 0);
    expect(labels(result)).toEqual(["$var0"]);
  });

  it("returns a new array (no mutation)", () => {
    const mods = makeModules(3);
    const result = moveModuleDown(mods, 0);
    expect(result).not.toBe(mods);
  });
});

// ---------------------------------------------------------------------------
// moveModuleToTop
// ---------------------------------------------------------------------------

describe("moveModuleToTop", () => {
  it("moves last element to top", () => {
    const mods = makeModules(4);
    const result = moveModuleToTop(mods, 3);
    expect(labels(result)).toEqual(["$var3", "$var0", "$var1", "$var2"]);
  });

  it("moves middle element to top", () => {
    const mods = makeModules(4);
    const result = moveModuleToTop(mods, 2);
    expect(labels(result)).toEqual(["$var2", "$var0", "$var1", "$var3"]);
  });

  it("no-op when already at top", () => {
    const mods = makeModules(3);
    const result = moveModuleToTop(mods, 0);
    expect(labels(result)).toEqual(["$var0", "$var1", "$var2"]);
  });

  it("no-op on single-element array", () => {
    const mods = makeModules(1);
    const result = moveModuleToTop(mods, 0);
    expect(labels(result)).toEqual(["$var0"]);
  });
});

// ---------------------------------------------------------------------------
// moveModuleToBottom
// ---------------------------------------------------------------------------

describe("moveModuleToBottom", () => {
  it("moves first element to bottom", () => {
    const mods = makeModules(4);
    const result = moveModuleToBottom(mods, 0);
    expect(labels(result)).toEqual(["$var1", "$var2", "$var3", "$var0"]);
  });

  it("moves middle element to bottom", () => {
    const mods = makeModules(4);
    const result = moveModuleToBottom(mods, 1);
    expect(labels(result)).toEqual(["$var0", "$var2", "$var3", "$var1"]);
  });

  it("no-op when already at bottom", () => {
    const mods = makeModules(3);
    const result = moveModuleToBottom(mods, 2);
    expect(labels(result)).toEqual(["$var0", "$var1", "$var2"]);
  });

  it("no-op on single-element array", () => {
    const mods = makeModules(1);
    const result = moveModuleToBottom(mods, 0);
    expect(labels(result)).toEqual(["$var0"]);
  });
});

// ---------------------------------------------------------------------------
// duplicateModule
// ---------------------------------------------------------------------------

describe("duplicateModule", () => {
  it("inserts clone immediately after the source index", () => {
    const mods = makeModules(3);
    const result = duplicateModule(mods, 1);
    expect(result).toHaveLength(4);
    expect(labels(result)).toEqual(["$var0", "$var1", "$var1", "$var2"]);
  });

  it("duplicating first element inserts at index 1", () => {
    const mods = makeModules(3);
    const result = duplicateModule(mods, 0);
    expect(result).toHaveLength(4);
    expect(labels(result)).toEqual(["$var0", "$var0", "$var1", "$var2"]);
  });

  it("duplicating last element appends after it", () => {
    const mods = makeModules(3);
    const result = duplicateModule(mods, 2);
    expect(result).toHaveLength(4);
    expect(labels(result)).toEqual(["$var0", "$var1", "$var2", "$var2"]);
  });

  it("produces a deep clone — modifying clone does not affect original", () => {
    const mods: PipelineModule[] = [
      {
        type: "wildcard",
        capture_as: "$a",
        options: [{ value: "x", weight: 1 }],
      },
    ];
    const result = duplicateModule(mods, 0);
    const clone = result[1] as WildcardModule;
    clone.options![0].value = "mutated";
    const original = mods[0] as WildcardModule;
    expect(original.options![0].value).toBe("x");
  });

  it("strips __dismissed_conflicts from the clone", () => {
    const mods: PipelineModule[] = [
      {
        type: "wildcard",
        capture_as: "$a",
        __dismissed_conflicts: ["context_overwrite"],
      },
    ];
    const result = duplicateModule(mods, 0);
    const clone = result[1] as WildcardModule;
    expect(clone.__dismissed_conflicts).toBeUndefined();
  });

  it("original retains its __dismissed_conflicts after duplication", () => {
    const mods: PipelineModule[] = [
      {
        type: "wildcard",
        capture_as: "$a",
        __dismissed_conflicts: ["duplicate_variable"],
      },
    ];
    const result = duplicateModule(mods, 0);
    const original = result[0] as WildcardModule;
    expect(original.__dismissed_conflicts).toEqual(["duplicate_variable"]);
  });

  it("returns unchanged copy for out-of-bounds index", () => {
    const mods = makeModules(2);
    const result = duplicateModule(mods, 10);
    expect(result).toHaveLength(2);
    expect(labels(result)).toEqual(["$var0", "$var1"]);
  });

  it("does not mutate the original array", () => {
    const mods = makeModules(3);
    const before = [...mods];
    duplicateModule(mods, 1);
    expect(mods).toEqual(before);
    expect(mods).toHaveLength(3);
  });
});

describe("insertModuleAt", () => {
  it("inserts module at the specified middle index", () => {
    const mods = makeModules(3);
    const module: PipelineModule = { type: "fixed", value: "x", capture_as: "$new" };
    const result = insertModuleAt(mods, module, 1);
    expect(labels(result)).toEqual(["$var0", "$new", "$var1", "$var2"]);
  });

  it("inserts at the beginning when index is 0", () => {
    const mods = makeModules(2);
    const module: PipelineModule = { type: "fixed", value: "x", capture_as: "$new" };
    const result = insertModuleAt(mods, module, 0);
    expect(labels(result)).toEqual(["$new", "$var0", "$var1"]);
  });

  it("appends to the end when atIndex is greater than or equal to length", () => {
    const mods = makeModules(2);
    const module: PipelineModule = { type: "fixed", value: "x", capture_as: "$new" };
    const result = insertModuleAt(mods, module, 10);
    expect(labels(result)).toEqual(["$var0", "$var1", "$new"]);
  });

  it("clamps negative index to the beginning", () => {
    const mods = makeModules(2);
    const module: PipelineModule = { type: "fixed", value: "x", capture_as: "$new" };
    const result = insertModuleAt(mods, module, -5);
    expect(labels(result)).toEqual(["$new", "$var0", "$var1"]);
  });

  it("deep-clones the inserted module", () => {
    const mods = makeModules(1);
    const module: PipelineModule = {
      type: "wildcard",
      capture_as: "$new",
      options: [{ value: "original", weight: 1 }],
    };
    const result = insertModuleAt(mods, module, 1);
    const inserted = result[1] as WildcardModule;
    inserted.options![0].value = "mutated";
    expect((module as WildcardModule).options![0].value).toBe("original");
  });

  it("strips __dismissed_conflicts from the inserted module", () => {
    const mods = makeModules(1);
    const module: PipelineModule = {
      type: "wildcard",
      capture_as: "$new",
      __dismissed_conflicts: ["duplicate_variable"],
    };
    const result = insertModuleAt(mods, module, 1);
    const inserted = result[1] as WildcardModule;
    expect(inserted.__dismissed_conflicts).toBeUndefined();
  });

  it("does not mutate the original array", () => {
    const mods = makeModules(2);
    const before = [...mods];
    const module: PipelineModule = { type: "fixed", value: "x", capture_as: "$new" };
    insertModuleAt(mods, module, 1);
    expect(mods).toEqual(before);
    expect(mods).toHaveLength(2);
  });
});

describe("removeModuleAt", () => {
  it("removes the element at the specified index", () => {
    const mods = makeModules(3);
    const result = removeModuleAt(mods, 1);
    expect(labels(result)).toEqual(["$var0", "$var2"]);
  });

  it("returns an unchanged copy for a negative index", () => {
    const mods = makeModules(3);
    const result = removeModuleAt(mods, -1);
    expect(result).not.toBe(mods);
    expect(labels(result)).toEqual(["$var0", "$var1", "$var2"]);
  });

  it("returns an unchanged copy for an index beyond the end", () => {
    const mods = makeModules(3);
    const result = removeModuleAt(mods, 3);
    expect(result).not.toBe(mods);
    expect(labels(result)).toEqual(["$var0", "$var1", "$var2"]);
  });

  it("does not mutate the original array", () => {
    const mods = makeModules(3);
    const before = [...mods];
    removeModuleAt(mods, 1);
    expect(mods).toEqual(before);
    expect(mods).toHaveLength(3);
  });

  it("works on a single-element array", () => {
    const mods = makeModules(1);
    const result = removeModuleAt(mods, 0);
    expect(result).toHaveLength(0);
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// DISMISSABLE_CONFLICT_TYPES
// ---------------------------------------------------------------------------

describe("DISMISSABLE_CONFLICT_TYPES", () => {
  it("contains exactly context_overwrite and duplicate_variable", () => {
    expect(DISMISSABLE_CONFLICT_TYPES).toHaveLength(2);
    expect(DISMISSABLE_CONFLICT_TYPES).toContain("context_overwrite");
    expect(DISMISSABLE_CONFLICT_TYPES).toContain("duplicate_variable");
  });

  it("does not contain functional conflict types", () => {
    expect(DISMISSABLE_CONFLICT_TYPES).not.toContain("unresolved_constraint_target");
    expect(DISMISSABLE_CONFLICT_TYPES).not.toContain("unresolved_constraint_when_variable");
    expect(DISMISSABLE_CONFLICT_TYPES).not.toContain("missing_template_variable");
  });
});
