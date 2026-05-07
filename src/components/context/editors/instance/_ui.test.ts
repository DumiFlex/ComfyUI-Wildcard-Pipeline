import { describe, it, expect } from "vitest";
import { parseWidgetJsonWithRecovery } from "../../../../widgets/_shared";
import { patchInstance } from "./patch";
import { pruneStaleInstanceRefs } from "./prune";
import type { ModuleEntry } from "../../../../widgets/_shared";

describe("_ui lifecycle invariant — bit-exact survival", () => {
  it("survives serialize → deserialize round-trip", () => {
    const original = {
      modules: [{
        id: "ab12cd34", type: "wildcard", enabled: true,
        meta: { name: "x" }, entries: [],
        payload: { options: [{ id: "a", value: "red", weight: 1 }] },
        instance: { _ui: { last_locked_seed: 42 } },
      }],
    };
    const json = JSON.stringify(original);
    type ContextValue = { modules: ModuleEntry[] };
    const result = parseWidgetJsonWithRecovery<ContextValue>(json, { modules: [] });
    expect(result.value.modules[0].instance?._ui?.last_locked_seed).toBe(42);
  });

  it("survives patchInstance on a different field", () => {
    const m: ModuleEntry = {
      id: "ab12cd34", type: "wildcard", enabled: true,
      meta: { name: "x" }, entries: [],
      payload: { options: [] },
      instance: { _ui: { last_locked_seed: 99 } },
    };
    const patch = patchInstance(m, "locked_seed", 5);
    const patchedInstance = patch.instance as ModuleEntry["instance"];
    expect(patchedInstance?._ui?.last_locked_seed).toBe(99);
  });

  it("survives pruneStaleInstanceRefs on a different field", () => {
    const inst = { _ui: { last_locked_seed: 50 }, enabled_options: ["ghost"] };
    const newPayload = { options: [{ id: "real" }] };
    const result = pruneStaleInstanceRefs(inst, newPayload, "wildcard");
    expect(result.instance?._ui?.last_locked_seed).toBe(50);
  });
});
