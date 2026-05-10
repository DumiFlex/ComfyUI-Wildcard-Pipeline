// Constraint MatrixSection — sub_cat × sub_cat grid with 4-state cell
// cycle (allow→exclude→boost→reduce→allow) on click. Cog icon visible
// only on boost/reduce cells (factor matters there); click cog →
// CellFactorPopover anchored to cell.
//
// "disabled" state was dropped — engine treats `mode: allow`, missing
// matrix entry, AND `disabled_matrix_cells` membership all as runtime
// passthrough. Three states for one effective behavior was redundant;
// `allow` IS the neutral baseline. Engine still reads
// disabled_matrix_cells for old workflows; UI just never writes it.
//
// Override marker: orange dashed border on cell when mode OR factor
// differs from library.

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import MatrixSection from "./MatrixSection.vue";
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
      matrix: {
        red: {
          cotton: { mode: "allow", factor: 1.0 },
          silk: { mode: "boost", factor: 2.0 },
        },
        blue: {
          cotton: { mode: "allow", factor: 1.0 },
          silk: { mode: "reduce", factor: 0.5 },
        },
      },
      exceptions: [],
    },
    instance: {},
    ...overrides,
  };
}

const SOURCE_SUBS = ["red", "blue"];
const TARGET_SUBS = ["cotton", "silk"];

describe("constraint MatrixSection", () => {
  it("renders cells for each src × tgt sub_category pair", () => {
    const w = mount(MatrixSection, {
      props: { module: makeModule(), sourceSubs: SOURCE_SUBS, targetSubs: TARGET_SUBS },
    });
    expect(w.find('[data-test="mx-cell-red-cotton"]').exists()).toBe(true);
    expect(w.find('[data-test="mx-cell-red-silk"]').exists()).toBe(true);
    expect(w.find('[data-test="mx-cell-blue-cotton"]').exists()).toBe(true);
    expect(w.find('[data-test="mx-cell-blue-silk"]').exists()).toBe(true);
  });

  it("clicking allow cell cycles to exclude (writes cell_mode_overrides)", async () => {
    const w = mount(MatrixSection, {
      props: { module: makeModule(), sourceSubs: SOURCE_SUBS, targetSubs: TARGET_SUBS },
    });
    await w.find('[data-test="mx-cell-red-cotton"]').trigger("click");
    const updates = w.emitted("update")!;
    const patch = updates[0][0] as Partial<ModuleEntry>;
    expect(patch.instance?.cell_mode_overrides).toEqual({ '["red","cotton"]': "exclude" });
  });

  it("clicking boost cell cycles to reduce", async () => {
    const w = mount(MatrixSection, {
      props: { module: makeModule(), sourceSubs: SOURCE_SUBS, targetSubs: TARGET_SUBS },
    });
    await w.find('[data-test="mx-cell-red-silk"]').trigger("click");
    const updates = w.emitted("update")!;
    const patch = updates[0][0] as Partial<ModuleEntry>;
    expect(patch.instance?.cell_mode_overrides).toEqual({ '["red","silk"]': "reduce" });
  });

  it("clicking reduce cell cycles back to allow (4-state, drops override on lib match)", async () => {
    // blue×silk has lib.mode = "reduce". Cycling: reduce → allow.
    // Allow != lib.mode (reduce), so override is set to "allow".
    const w = mount(MatrixSection, {
      props: { module: makeModule(), sourceSubs: SOURCE_SUBS, targetSubs: TARGET_SUBS },
    });
    await w.find('[data-test="mx-cell-blue-silk"]').trigger("click");
    const updates = w.emitted("update")!;
    const patch = updates[0][0] as Partial<ModuleEntry>;
    expect(patch.instance?.cell_mode_overrides).toEqual({ '["blue","silk"]': "allow" });
    // No disabled_matrix_cells write — UI doesn't use that field anymore.
    expect(patch.instance?.disabled_matrix_cells ?? null).toBeNull();
  });

  it("clicking allow cell with reduce lib drops override after full cycle", async () => {
    // Lib mode = "reduce". User cycled through allow → exclude → boost
    // → reduce already; the "reduce" override matches lib so it should
    // be deleted.
    const w = mount(MatrixSection, {
      props: {
        module: makeModule({
          instance: { cell_mode_overrides: { '["blue","silk"]': "boost" } },
        }),
        sourceSubs: SOURCE_SUBS,
        targetSubs: TARGET_SUBS,
      },
    });
    await w.find('[data-test="mx-cell-blue-silk"]').trigger("click");
    const updates = w.emitted("update")!;
    const patch = updates[0][0] as Partial<ModuleEntry>;
    // boost → reduce, reduce matches lib → drop override entirely.
    expect(patch.instance?.cell_mode_overrides ?? null).toBeNull();
  });

  it("legacy disabled cell cycles forward to allow + clears disabled_matrix_cells entry", async () => {
    // Forward-compat: workflows saved with disabled_matrix_cells should
    // migrate cleanly when user clicks the cell. New cycle starts at
    // "allow" (engine-equivalent to disabled = passthrough).
    const w = mount(MatrixSection, {
      props: {
        module: makeModule({
          instance: { disabled_matrix_cells: ['["red","cotton"]'] },
        }),
        sourceSubs: SOURCE_SUBS,
        targetSubs: TARGET_SUBS,
      },
    });
    await w.find('[data-test="mx-cell-red-cotton"]').trigger("click");
    const updates = w.emitted("update")!;
    const patch = updates[updates.length - 1][0] as Partial<ModuleEntry>;
    expect(patch.instance?.disabled_matrix_cells ?? null).toBeNull();
    // Cycle from "allow" baseline → "exclude" override.
    expect(patch.instance?.cell_mode_overrides).toEqual({ '["red","cotton"]': "exclude" });
  });

  it("cycling preserves cell_factor_overrides across mode transitions", async () => {
    // User set reduce ×0.3 override; clicking cycles reduce → allow.
    // Factor override persists so a later cycle back to boost/reduce
    // restores the user's tweak instead of resetting to library.
    const w = mount(MatrixSection, {
      props: {
        module: makeModule({
          instance: {
            cell_mode_overrides: { '["blue","silk"]': "reduce" },
            cell_factor_overrides: { '["blue","silk"]': 0.3 },
          },
        }),
        sourceSubs: SOURCE_SUBS,
        targetSubs: TARGET_SUBS,
      },
    });
    await w.find('[data-test="mx-cell-blue-silk"]').trigger("click");
    const updates = w.emitted("update")!;
    const patch = updates[0][0] as Partial<ModuleEntry>;
    expect(patch.instance?.cell_factor_overrides).toEqual({ '["blue","silk"]': 0.3 });
  });

  it("renders override marker class when mode differs from library", () => {
    const w = mount(MatrixSection, {
      props: {
        module: makeModule({
          instance: { cell_mode_overrides: { '["red","cotton"]': "exclude" } },
        }),
        sourceSubs: SOURCE_SUBS,
        targetSubs: TARGET_SUBS,
      },
    });
    expect(w.find('[data-test="mx-cell-red-cotton"]').classes()).toContain("mx__cell--overridden");
  });

  it("renders override marker when factor differs from library", () => {
    const w = mount(MatrixSection, {
      props: {
        module: makeModule({
          instance: { cell_factor_overrides: { '["red","silk"]': 5.0 } },
        }),
        sourceSubs: SOURCE_SUBS,
        targetSubs: TARGET_SUBS,
      },
    });
    expect(w.find('[data-test="mx-cell-red-silk"]').classes()).toContain("mx__cell--overridden");
  });

  it("cog button visible only on boost / reduce cells", () => {
    const w = mount(MatrixSection, {
      props: { module: makeModule(), sourceSubs: SOURCE_SUBS, targetSubs: TARGET_SUBS },
    });
    expect(w.find('[data-test="mx-cog-red-cotton"]').exists()).toBe(false); // allow
    expect(w.find('[data-test="mx-cog-red-silk"]').exists()).toBe(true); // boost
    expect(w.find('[data-test="mx-cog-blue-silk"]').exists()).toBe(true); // reduce
  });

  it("clicking cog opens CellFactorPopover (no cell cycle)", async () => {
    const w = mount(MatrixSection, {
      props: { module: makeModule(), sourceSubs: SOURCE_SUBS, targetSubs: TARGET_SUBS },
    });
    await w.find('[data-test="mx-cog-red-silk"]').trigger("click");
    expect(w.findComponent({ name: "CellFactorPopover" }).exists()).toBe(true);
    // Cog click did NOT cycle the cell.
    expect(w.emitted("update")).toBeFalsy();
  });

  it("empty cell (no library rule) cycles on click — implicit allow → exclude override", async () => {
    // Sparse matrix: only red×cotton has a library rule. Empty cells
    // start with effective mode "allow" (implicit), first click sets
    // override to "exclude" (matching filled-cell cycle behavior).
    const sparse = makeModule({
      payload: {
        source_wildcard_id: "wc_color",
        target_wildcard_id: "wc_fabric",
        matrix: { red: { cotton: { mode: "allow", factor: 1.0 } } },
        exceptions: [],
      },
    });
    const w = mount(MatrixSection, {
      props: { module: sparse, sourceSubs: SOURCE_SUBS, targetSubs: TARGET_SUBS },
    });
    const empty = w.find('[data-test="mx-cell-blue-silk"]');
    expect(empty.classes()).toContain("mx__cell--empty");
    expect(empty.attributes("role")).toBe("button");
    expect(empty.attributes("tabindex")).toBe("0");
    await empty.trigger("click");
    const updates = w.emitted("update")!;
    const patch = updates[0][0] as Partial<ModuleEntry>;
    expect(patch.instance?.cell_mode_overrides).toEqual({ '["blue","silk"]': "exclude" });
  });

  it("empty cell cycling exclude → boost → reduce → allow drops override", async () => {
    // Cycle covers all 4 states + lands back on "allow" which equals
    // the implicit default for empty cells → override deleted.
    const sparse = makeModule({
      payload: {
        source_wildcard_id: "wc_color",
        target_wildcard_id: "wc_fabric",
        matrix: { red: { cotton: { mode: "allow", factor: 1.0 } } },
        exceptions: [],
      },
      instance: { cell_mode_overrides: { '["blue","silk"]': "reduce" } },
    });
    const w = mount(MatrixSection, {
      props: { module: sparse, sourceSubs: SOURCE_SUBS, targetSubs: TARGET_SUBS },
    });
    await w.find('[data-test="mx-cell-blue-silk"]').trigger("click");
    const updates = w.emitted("update")!;
    const patch = updates[updates.length - 1][0] as Partial<ModuleEntry>;
    // reduce → allow, allow == implicit default → drop override.
    expect(patch.instance?.cell_mode_overrides ?? null).toBeNull();
  });
});
