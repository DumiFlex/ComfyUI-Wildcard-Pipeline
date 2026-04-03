import { describe, it, expect } from "vitest";
import {
  moveModule,
  moveModuleUp,
  moveModuleDown,
  moveModuleToTop,
  moveModuleToBottom,
  duplicateModule,
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
