// Constraint ExceptionsSection — library exception list (with disable
// checkbox + mode-cycle chip + factor input on boost/reduce) plus
// extra-exceptions section (instance-only, source/target editable
// with sibling-wildcard autocomplete) plus "+ Add extra" button.

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import ExceptionsSection from "./ExceptionsSection.vue";
import type { ModuleEntry } from "../../../../../widgets/_shared";

function makeModule(overrides: Partial<ModuleEntry> = {}): ModuleEntry {
  return {
    id: "cn012345",
    type: "constraint",
    enabled: true,
    meta: { name: "rules" },
    entries: [],
    payload: {
      source_wildcard_id: "wc_color",
      target_wildcard_id: "wc_fabric",
      matrix: {},
      exceptions: [
        { source_value: "red", target_value: "black", mode: "exclude", factor: 1.0 },
        { source_value: "blue", target_value: "green", mode: "boost", factor: 2.0 },
      ],
    },
    instance: {},
    ...overrides,
  };
}

const SOURCE_VALUES = ["red", "blue", "silver", "ivory"];
const TARGET_VALUES = ["black", "green", "white", "ivory"];

describe("constraint ExceptionsSection", () => {
  it("renders one row per library exception", () => {
    const w = mount(ExceptionsSection, {
      props: { module: makeModule(), sourceValues: SOURCE_VALUES, targetValues: TARGET_VALUES },
    });
    expect(w.find('[data-test="ex-row-0"]').exists()).toBe(true);
    expect(w.find('[data-test="ex-row-1"]').exists()).toBe(true);
  });

  it("checkbox unchecked → adds key to disabled_exception_keys (enabled-by-default polarity)", async () => {
    const w = mount(ExceptionsSection, {
      props: { module: makeModule(), sourceValues: SOURCE_VALUES, targetValues: TARGET_VALUES },
    });
    // Default state: no disabled keys → checkbox renders checked.
    // Unchecking it tells the engine to disable this exception.
    await w.find('[data-test="ex-cb-0"]').trigger("click");
    const updates = w.emitted("update")!;
    const patch = updates[updates.length - 1][0] as Partial<ModuleEntry>;
    expect(patch.instance?.disabled_exception_keys).toEqual(['["red","black"]']);
  });

  it("checkbox checked again → removes key from disabled_exception_keys", async () => {
    const w = mount(ExceptionsSection, {
      props: {
        module: makeModule({
          instance: { disabled_exception_keys: ['["red","black"]'] },
        }),
        sourceValues: SOURCE_VALUES,
        targetValues: TARGET_VALUES,
      },
    });
    await w.find('[data-test="ex-cb-0"]').trigger("click");
    const updates = w.emitted("update")!;
    const patch = updates[updates.length - 1][0] as Partial<ModuleEntry>;
    expect(patch.instance?.disabled_exception_keys).toBeNull();
  });

  it("disabled rows render with the ex__row--off visual class", () => {
    const w = mount(ExceptionsSection, {
      props: {
        module: makeModule({
          instance: { disabled_exception_keys: ['["red","black"]'] },
        }),
        sourceValues: SOURCE_VALUES,
        targetValues: TARGET_VALUES,
      },
    });
    expect(w.find('[data-test="ex-row-0"]').classes()).toContain("ex__row--off");
  });

  it("enabled rows do NOT receive the disabled visual class", () => {
    const w = mount(ExceptionsSection, {
      props: { module: makeModule(), sourceValues: SOURCE_VALUES, targetValues: TARGET_VALUES },
    });
    expect(w.find('[data-test="ex-row-0"]').classes()).not.toContain("ex__row--off");
  });

  it("mode chip click cycles 4 modes (no disabled)", async () => {
    const w = mount(ExceptionsSection, {
      props: { module: makeModule(), sourceValues: SOURCE_VALUES, targetValues: TARGET_VALUES },
    });
    await w.find('[data-test="ex-mode-0"]').trigger("click");
    const updates = w.emitted("update")!;
    const patch = updates[0][0] as Partial<ModuleEntry>;
    expect(patch.instance?.exception_mode_overrides).toEqual({ '["red","black"]': "boost" });
  });

  it("mode cycle from reduce goes back to allow (4-state, no disabled)", async () => {
    const w = mount(ExceptionsSection, {
      props: {
        module: makeModule({
          instance: { exception_mode_overrides: { '["red","black"]': "reduce" } },
        }),
        sourceValues: SOURCE_VALUES,
        targetValues: TARGET_VALUES,
      },
    });
    await w.find('[data-test="ex-mode-0"]').trigger("click");
    const updates = w.emitted("update")!;
    const patch = updates[updates.length - 1][0] as Partial<ModuleEntry>;
    expect(patch.instance?.exception_mode_overrides).toEqual({ '["red","black"]': "allow" });
  });

  it("factor input visible only when effective mode is boost or reduce", () => {
    const w = mount(ExceptionsSection, {
      props: { module: makeModule(), sourceValues: SOURCE_VALUES, targetValues: TARGET_VALUES },
    });
    expect(w.find('[data-test="ex-factor-0"]').exists()).toBe(false);
    expect(w.find('[data-test="ex-factor-1"]').exists()).toBe(true);
  });

  it("factor input commits via change event", async () => {
    const w = mount(ExceptionsSection, {
      props: { module: makeModule(), sourceValues: SOURCE_VALUES, targetValues: TARGET_VALUES },
    });
    const input = w.find<HTMLInputElement>('[data-test="ex-factor-1"]');
    input.element.value = "5";
    await input.trigger("input");
    await input.trigger("change");
    const updates = w.emitted("update")!;
    const patch = updates[updates.length - 1][0] as Partial<ModuleEntry>;
    expect(patch.instance?.exception_factor_overrides).toEqual({ '["blue","green"]': 5 });
  });

  it("renders extra-exception rows with badge + trash", () => {
    const w = mount(ExceptionsSection, {
      props: {
        module: makeModule({
          instance: {
            extra_exceptions: [
              { source_value: "silver", target_value: "ivory", mode: "exclude", factor: 1.0 },
            ],
          },
        }),
        sourceValues: SOURCE_VALUES,
        targetValues: TARGET_VALUES,
      },
    });
    expect(w.find('[data-test="ex-extra-0"]').exists()).toBe(true);
    expect(w.find('[data-test="ex-extra-trash-0"]').exists()).toBe(true);
  });

  it("Add extra exception button appends an empty row", async () => {
    const w = mount(ExceptionsSection, {
      props: { module: makeModule(), sourceValues: SOURCE_VALUES, targetValues: TARGET_VALUES },
    });
    await w.find('[data-test="ex-add-extra"]').trigger("click");
    const updates = w.emitted("update")!;
    const patch = updates[updates.length - 1][0] as Partial<ModuleEntry>;
    expect(patch.instance?.extra_exceptions).toEqual([
      { source_value: "", target_value: "", mode: "allow", factor: 1 },
    ]);
  });

  it("extra row trash removes it from extra_exceptions", async () => {
    const w = mount(ExceptionsSection, {
      props: {
        module: makeModule({
          instance: {
            extra_exceptions: [
              { source_value: "a", target_value: "b", mode: "allow", factor: 1.0 },
              { source_value: "c", target_value: "d", mode: "boost", factor: 2.0 },
            ],
          },
        }),
        sourceValues: SOURCE_VALUES,
        targetValues: TARGET_VALUES,
      },
    });
    await w.find('[data-test="ex-extra-trash-0"]').trigger("click");
    const updates = w.emitted("update")!;
    const patch = updates[updates.length - 1][0] as Partial<ModuleEntry>;
    expect(patch.instance?.extra_exceptions).toHaveLength(1);
    expect(patch.instance?.extra_exceptions?.[0].source_value).toBe("c");
  });

  it("renders legacy-shape exceptions with `source`/`target` fields (engine accepts both)", () => {
    // Engine accepts BOTH legacy (`source`/`target`) and tier 2
    // (`source_value`/`target_value`) — see constraint_handler.py:154.
    // UI must mirror the fallback so older saved constraints render.
    const w = mount(ExceptionsSection, {
      props: {
        module: makeModule({
          payload: {
            source_wildcard_id: "wc_color",
            target_wildcard_id: "wc_fabric",
            matrix: {},
            // Legacy shape — bare `source`/`target`, no `_value` suffix.
            exceptions: [
              { source: "red", target: "black", mode: "exclude", factor: 1.0 },
            ],
          },
        }),
        sourceValues: SOURCE_VALUES,
        targetValues: TARGET_VALUES,
      },
    });
    const row = w.find('[data-test="ex-row-0"]');
    expect(row.exists()).toBe(true);
    expect(row.text()).toContain("red");
    expect(row.text()).toContain("black");
  });

  it("legacy-shape exception unchecking keys correctly into disabled_exception_keys", async () => {
    const w = mount(ExceptionsSection, {
      props: {
        module: makeModule({
          payload: {
            source_wildcard_id: "wc_color",
            target_wildcard_id: "wc_fabric",
            matrix: {},
            exceptions: [
              { source: "red", target: "black", mode: "exclude", factor: 1.0 },
            ],
          },
        }),
        sourceValues: SOURCE_VALUES,
        targetValues: TARGET_VALUES,
      },
    });
    // Inverted polarity: enabled-by-default means we uncheck to disable.
    await w.find('[data-test="ex-cb-0"]').trigger("click");
    const updates = w.emitted("update")!;
    const patch = updates[updates.length - 1][0] as Partial<ModuleEntry>;
    // Key uses legacy values via fallback chain.
    expect(patch.instance?.disabled_exception_keys).toEqual(['["red","black"]']);
  });

  it("extra row source/target use VarAutocompleteInput", () => {
    const w = mount(ExceptionsSection, {
      props: {
        module: makeModule({
          instance: {
            extra_exceptions: [
              { source_value: "", target_value: "", mode: "allow", factor: 1.0 },
            ],
          },
        }),
        sourceValues: SOURCE_VALUES,
        targetValues: TARGET_VALUES,
      },
    });
    expect(w.findAllComponents({ name: "VarAutocompleteInput" }).length).toBeGreaterThan(0);
  });

  it("library exception with source='' renders the pi-ban chip when sourceHasNull=true", () => {
    const w = mount(ExceptionsSection, {
      props: {
        module: makeModule({
          payload: {
            exceptions: [
              { source: "", target: "black", mode: "exclude", factor: 1 },
            ],
          },
        }),
        sourceValues: SOURCE_VALUES,
        targetValues: TARGET_VALUES,
        sourceHasNull: true,
        targetHasNull: false,
      },
    });
    const row = w.find('[data-test="ex-row-0"]');
    const src = row.find(".ex__src");
    expect(src.find(".pi-ban").exists()).toBe(true);
    expect(src.text()).toMatch(/null/i);
  });

  it("library exception renders raw text when has-null flag is false", () => {
    const w = mount(ExceptionsSection, {
      props: {
        module: makeModule({
          payload: {
            exceptions: [
              { source: "", target: "black", mode: "exclude", factor: 1 },
            ],
          },
        }),
        sourceValues: SOURCE_VALUES,
        targetValues: TARGET_VALUES,
        sourceHasNull: false,
        targetHasNull: false,
      },
    });
    const src = w.find('[data-test="ex-row-0"] .ex__src');
    // No chip — empty text rendered as-is.
    expect(src.find(".pi-ban").exists()).toBe(false);
  });
});
