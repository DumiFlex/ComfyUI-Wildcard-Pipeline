// Constraint MatrixSection — sub_cat × sub_cat grid with 5-state cell
// cycle (allow→exclude→boost→reduce→disabled→allow) on click. Cog
// icon visible only on boost/reduce cells (factor matters there);
// click cog → CellFactorPopover anchored to cell.
//
// Override marker: orange dashed border on cell when mode OR factor
// differs from library. Disabled state renders with diagonal stripe
// pattern, distinct from "exclude" solid red.

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

  it("clicking reduce cell cycles to disabled (writes disabled_matrix_cells)", async () => {
    const w = mount(MatrixSection, {
      props: { module: makeModule(), sourceSubs: SOURCE_SUBS, targetSubs: TARGET_SUBS },
    });
    await w.find('[data-test="mx-cell-blue-silk"]').trigger("click");
    const updates = w.emitted("update")!;
    const patch = updates[0][0] as Partial<ModuleEntry>;
    expect(patch.instance?.disabled_matrix_cells).toEqual(['["blue","silk"]']);
  });

  it("clicking disabled cell cycles back to allow (removes from disabled_matrix_cells)", async () => {
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
    const post = patch.instance?.disabled_matrix_cells;
    expect(post == null || post.length === 0).toBe(true);
  });

  it("disabling a reduce cell preserves its cell_factor_overrides", async () => {
    // User has set reduce ×0.3 override, then clicks → cycles to disabled.
    // Factor override must persist through the disable so cycling back
    // restores the user's tweak.
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
    expect(patch.instance?.disabled_matrix_cells).toContain('["blue","silk"]');
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

  it("empty cell (no library rule) is non-interactive — no role/tabindex/click", async () => {
    // Sparse matrix: only red×cotton has a library rule. The other 3
    // cells are "neutral" — no library rule, should not be cyclable.
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
    expect(empty.attributes("role")).toBeUndefined();
    expect(empty.attributes("tabindex")).toBeUndefined();
    expect(empty.attributes("aria-disabled")).toBe("true");
    await empty.trigger("click");
    expect(w.emitted("update")).toBeFalsy();
  });
});
