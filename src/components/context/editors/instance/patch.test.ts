import { describe, it, expect } from "vitest";
import type { ModuleEntry } from "../../../../widgets/_shared";
import { patchInstance, patchInstanceMapEntry } from "./patch";

const baseModule = (): ModuleEntry => ({
  id: "ab12cd34", type: "wildcard", enabled: true,
  meta: { name: "test" }, entries: [],
  payload: { options: [{ id: "o1", value: "red", weight: 1 }] },
  instance: {
    variable_binding: "foo",
    enabled_options: ["o1"],
    option_weights: { o1: 2 },
    _ui: { last_locked_seed: 99 },
  },
});

describe("patchInstance", () => {
  it("merges field/value into instance shallow-spread, preserves siblings", () => {
    const patch = patchInstance(baseModule(), "locked_seed", 123);
    expect(patch.instance?.locked_seed).toBe(123);
    expect(patch.instance?.variable_binding).toBe("foo");
    expect(patch.instance?.enabled_options).toEqual(["o1"]);
    expect(patch.instance?.option_weights).toEqual({ o1: 2 });
    expect(patch.instance?._ui?.last_locked_seed).toBe(99);
  });

  it("clears field with null without nuking siblings", () => {
    const patch = patchInstance(baseModule(), "variable_binding", null);
    expect(patch.instance?.variable_binding).toBeNull();
    expect(patch.instance?.option_weights).toEqual({ o1: 2 });
  });

  it("creates fresh instance object when module.instance is undefined", () => {
    const m = baseModule();
    delete m.instance;
    const patch = patchInstance(m, "locked_seed", 5);
    expect(patch.instance?.locked_seed).toBe(5);
  });
});

describe("patchInstanceMapEntry", () => {
  it("adds/updates entry in option_weights without nuking other keys", () => {
    const m = baseModule();
    m.instance!.option_weights = { o1: 2, o2: 3 };
    const patch = patchInstanceMapEntry(m, "option_weights", "o3", 4);
    expect(patch.instance?.option_weights).toEqual({ o1: 2, o2: 3, o3: 4 });
  });

  it("deletes key from map when value is null", () => {
    const m = baseModule();
    m.instance!.option_weights = { o1: 2, o2: 3 };
    const patch = patchInstanceMapEntry(m, "option_weights", "o1", null);
    expect(patch.instance?.option_weights).toEqual({ o2: 3 });
  });

  it("creates fresh map when field was null/undefined", () => {
    const m = baseModule();
    m.instance!.option_weights = null;
    const patch = patchInstanceMapEntry(m, "option_weights", "o1", 5);
    expect(patch.instance?.option_weights).toEqual({ o1: 5 });
  });
});
