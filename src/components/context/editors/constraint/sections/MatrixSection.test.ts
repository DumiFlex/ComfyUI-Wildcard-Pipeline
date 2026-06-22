// Constraint MatrixSection — sub_cat × sub_cat grid.
//
// Click any cell opens CellRulePopover (4 labeled state buttons +
// numeric factor input). The old 4-state click-cycle and cog-anchored
// factor popover are gone. `mode: "allow"` / `"disabled"` collapse to
// `"neutral"` on read; touching a legacy-disabled cell strips its
// `disabled_matrix_cells` entry.

import { describe, it, expect } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import MatrixSection from "./MatrixSection.vue";
import type { ModuleEntry } from "../../../../../widgets/_shared";

/** The popover is rendered in a `<Teleport to="body">` portal so it
 *  lives outside the test wrapper's element subtree. `find()` on the
 *  wrapper won't see it. Reaching it through `findComponent` returns
 *  a wrapper rooted at the popover component, whose `find()` traverses
 *  the teleported DOM correctly. */
function popoverWrap(w: VueWrapper) {
  return w.findComponent({ name: "CellRulePopover" });
}

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
          cotton: { mode: "neutral", factor: 1.0 },
          silk: { mode: "boost", factor: 2.0 },
        },
        blue: {
          cotton: { mode: "neutral", factor: 1.0 },
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

const RED_COTTON = JSON.stringify(["red", "cotton"]);
const RED_SILK = JSON.stringify(["red", "silk"]);
const BLUE_SILK = JSON.stringify(["blue", "silk"]);

describe("constraint MatrixSection — layout", () => {
  it("renders cells for each src × tgt sub_category pair", () => {
    const w = mount(MatrixSection, {
      props: { module: makeModule(), sourceSubs: SOURCE_SUBS, targetSubs: TARGET_SUBS },
    });
    expect(w.find('[data-test="mx-cell-red-cotton"]').exists()).toBe(true);
    expect(w.find('[data-test="mx-cell-red-silk"]').exists()).toBe(true);
    expect(w.find('[data-test="mx-cell-blue-cotton"]').exists()).toBe(true);
    expect(w.find('[data-test="mx-cell-blue-silk"]').exists()).toBe(true);
  });

  it("renders the source / target axis tags", () => {
    const w = mount(MatrixSection, {
      props: {
        module: makeModule(),
        sourceSubs: SOURCE_SUBS,
        targetSubs: TARGET_SUBS,
        sourceName: "color",
        targetName: "fabric",
      },
    });
    const src = w.find('[data-test="mx-axis-src"]');
    const tgt = w.find('[data-test="mx-axis-tgt"]');
    expect(src.exists()).toBe(true);
    expect(tgt.exists()).toBe(true);
    expect(src.text()).toMatch(/color/i);
    expect(tgt.text()).toMatch(/fabric/i);
  });

  it("each cell carries its s-{state} class", () => {
    const w = mount(MatrixSection, {
      props: { module: makeModule(), sourceSubs: SOURCE_SUBS, targetSubs: TARGET_SUBS },
    });
    expect(w.find('[data-test="mx-cell-red-cotton"]').classes()).toContain("s-neutral");
    expect(w.find('[data-test="mx-cell-red-silk"]').classes()).toContain("s-boost");
    expect(w.find('[data-test="mx-cell-blue-silk"]').classes()).toContain("s-reduce");
  });
});

describe("constraint MatrixSection — grouped axes", () => {
  it("renders a column band per target axis + a row header chip per source axis", () => {
    const w = mount(MatrixSection, {
      props: {
        module: makeModule(),
        sourceSubs: SOURCE_SUBS,
        targetSubs: TARGET_SUBS,
        sourceGroups: { warmth: ["red", "blue"] },
        targetGroups: { fabric: ["cotton", "silk"] },
      },
    });
    expect(w.findAll(".mx-th-band").map((b) => b.text()).filter((t) => t.length)).toEqual(["fabric"]);
    expect(w.findAll(".mx-grp-head").map((h) => h.text())).toEqual(["warmth"]);
    // Cells stay keyed by tag name, so the grouped layout is reorder-safe.
    expect(w.find('[data-test="mx-cell-red-silk"]').exists()).toBe(true);
    expect(w.find('[data-test="mx-cell-blue-cotton"]').exists()).toBe(true);
  });

  it("a solo source axis folds its name into the tag eyebrow (no header chip)", () => {
    const w = mount(MatrixSection, {
      props: {
        module: makeModule(),
        sourceSubs: ["red", "blue", "green"],
        targetSubs: TARGET_SUBS,
        sourceGroups: { warmth: ["red", "blue"], shade: ["green"] },
      },
    });
    expect(w.findAll(".mx-grp-head").map((h) => h.text())).toEqual(["warmth"]); // shade is solo
    const solo = w.find(".mx-th-row.solo");
    expect(solo.exists()).toBe(true);
    expect(solo.text()).toContain("shade");
    expect(solo.text()).toContain("green");
  });

  it("labels the leftover ungrouped run 'uncategorized' instead of leaving it blank", () => {
    const w = mount(MatrixSection, {
      props: {
        module: makeModule(),
        sourceSubs: ["red", "blue", "extra"],
        targetSubs: ["cotton", "silk", "wool"],
        sourceGroups: { warmth: ["red", "blue"] },
        targetGroups: { fabric: ["cotton", "silk"] },
      },
    });
    expect(w.findAll(".mx-grp-head").map((h) => h.text())).toEqual(["warmth", "uncategorized"]);
    expect(w.findAll(".mx-th-band").map((b) => b.text()).filter((t) => t.length))
      .toEqual(["fabric", "uncategorized"]);
  });

  it("stays flat (no bands / chips) when no groups are passed", () => {
    const w = mount(MatrixSection, {
      props: { module: makeModule(), sourceSubs: ["red"], targetSubs: ["cotton"] },
    });
    expect(w.findAll(".mx-th-band").length).toBe(0);
    expect(w.findAll(".mx-grp-head").length).toBe(0);
  });
});

describe("constraint MatrixSection — override marker", () => {
  it("renders override marker when mode differs from library", () => {
    const w = mount(MatrixSection, {
      props: {
        module: makeModule({
          instance: { cell_mode_overrides: { [RED_COTTON]: "exclude" } },
        }),
        sourceSubs: SOURCE_SUBS,
        targetSubs: TARGET_SUBS,
      },
    });
    const cell = w.find('[data-test="mx-cell-red-cotton"]');
    expect(cell.classes()).toContain("mx-cell--mod");
    expect(cell.classes()).toContain("s-exclude");
  });

  it("renders override marker when factor differs from library", () => {
    const w = mount(MatrixSection, {
      props: {
        module: makeModule({
          instance: { cell_factor_overrides: { [RED_SILK]: 2.5 } },
        }),
        sourceSubs: SOURCE_SUBS,
        targetSubs: TARGET_SUBS,
      },
    });
    const cell = w.find('[data-test="mx-cell-red-silk"]');
    expect(cell.classes()).toContain("mx-cell--mod");
    expect(cell.classes()).toContain("s-boost");
    expect(cell.text()).toMatch(/×2\.5/);
  });
});

describe("constraint MatrixSection — popover", () => {
  it("clicking a cell opens the rule popover", async () => {
    const w = mount(MatrixSection, {
      props: { module: makeModule(), sourceSubs: SOURCE_SUBS, targetSubs: TARGET_SUBS },
    });
    expect(w.findComponent({ name: "CellRulePopover" }).exists()).toBe(false);
    await w.find('[data-test="mx-cell-red-cotton"]').trigger("click");
    expect(w.findComponent({ name: "CellRulePopover" }).exists()).toBe(true);
    expect(w.find('[data-test="mx-cell-red-cotton"]').classes()).toContain("open");
  });

  it("clicking the same cell twice closes the popover", async () => {
    const w = mount(MatrixSection, {
      props: { module: makeModule(), sourceSubs: SOURCE_SUBS, targetSubs: TARGET_SUBS },
    });
    await w.find('[data-test="mx-cell-red-cotton"]').trigger("click");
    await w.find('[data-test="mx-cell-red-cotton"]').trigger("click");
    expect(w.findComponent({ name: "CellRulePopover" }).exists()).toBe(false);
  });

  it("opening a different cell moves the popover (one open at a time)", async () => {
    const w = mount(MatrixSection, {
      props: { module: makeModule(), sourceSubs: SOURCE_SUBS, targetSubs: TARGET_SUBS },
    });
    await w.find('[data-test="mx-cell-red-cotton"]').trigger("click");
    await w.find('[data-test="mx-cell-blue-silk"]').trigger("click");
    expect(w.find('[data-test="mx-cell-red-cotton"]').classes()).not.toContain("open");
    expect(w.find('[data-test="mx-cell-blue-silk"]').classes()).toContain("open");
  });

  it("selecting boost from neutral writes the mode override + default factor 1.5", async () => {
    const updates: Array<Partial<ModuleEntry>> = [];
    const w = mount(MatrixSection, {
      props: {
        module: makeModule(),
        sourceSubs: SOURCE_SUBS,
        targetSubs: TARGET_SUBS,
        "onUpdate": (p: Partial<ModuleEntry>) => updates.push(p),
      },
    });
    await w.find('[data-test="mx-cell-red-cotton"]').trigger("click");
    await popoverWrap(w).find("button.pop-btn.b-boost").trigger("click");
    expect(updates.length).toBeGreaterThan(0);
    const last = updates[updates.length - 1].instance as Record<string, unknown>;
    expect(last.cell_mode_overrides).toEqual({ [RED_COTTON]: "boost" });
    expect(last.cell_factor_overrides).toEqual({ [RED_COTTON]: 1.5 });
  });

  it("selecting reduce from neutral writes mode + default factor 0.5", async () => {
    const updates: Array<Partial<ModuleEntry>> = [];
    const w = mount(MatrixSection, {
      props: {
        module: makeModule(),
        sourceSubs: SOURCE_SUBS,
        targetSubs: TARGET_SUBS,
        "onUpdate": (p: Partial<ModuleEntry>) => updates.push(p),
      },
    });
    await w.find('[data-test="mx-cell-red-cotton"]').trigger("click");
    await popoverWrap(w).find("button.pop-btn.b-reduce").trigger("click");
    const last = updates[updates.length - 1].instance as Record<string, unknown>;
    expect(last.cell_mode_overrides).toEqual({ [RED_COTTON]: "reduce" });
    expect(last.cell_factor_overrides).toEqual({ [RED_COTTON]: 0.5 });
  });

  it("selecting library-matching mode drops the mode override", async () => {
    // Library says blue×silk = reduce. User had a boost+factor override;
    // clicking REDUCE in the popover collapses the MODE back to library
    // default (override dropped). The factor override is intentionally
    // preserved — user-set numbers survive mode swaps within the
    // boost/reduce family so they don't lose their tuned value.
    const updates: Array<Partial<ModuleEntry>> = [];
    const w = mount(MatrixSection, {
      props: {
        module: makeModule({
          instance: {
            cell_mode_overrides: { [BLUE_SILK]: "boost" },
            cell_factor_overrides: { [BLUE_SILK]: 3.0 },
          },
        }),
        sourceSubs: SOURCE_SUBS,
        targetSubs: TARGET_SUBS,
        "onUpdate": (p: Partial<ModuleEntry>) => updates.push(p),
      },
    });
    await w.find('[data-test="mx-cell-blue-silk"]').trigger("click");
    await popoverWrap(w).find("button.pop-btn.b-reduce").trigger("click");
    const last = updates[updates.length - 1].instance as Record<string, unknown>;
    // reduce matches lib → mode override dropped.
    expect(last.cell_mode_overrides ?? null).toBeNull();
    // User-set factor preserved across the boost → reduce swap.
    expect(last.cell_factor_overrides).toEqual({ [BLUE_SILK]: 3.0 });
  });

  it("selecting neutral on a boost cell with override drops both maps", async () => {
    const updates: Array<Partial<ModuleEntry>> = [];
    const w = mount(MatrixSection, {
      props: {
        module: makeModule({
          instance: {
            cell_mode_overrides: { [RED_COTTON]: "boost" },
            cell_factor_overrides: { [RED_COTTON]: 1.8 },
          },
        }),
        sourceSubs: SOURCE_SUBS,
        targetSubs: TARGET_SUBS,
        "onUpdate": (p: Partial<ModuleEntry>) => updates.push(p),
      },
    });
    await w.find('[data-test="mx-cell-red-cotton"]').trigger("click");
    await popoverWrap(w).find("button.pop-btn.b-neutral").trigger("click");
    const last = updates[updates.length - 1].instance as Record<string, unknown>;
    // Lib mode is neutral → matches → drop mode override.
    expect(last.cell_mode_overrides ?? null).toBeNull();
    // Leaving boost → drop factor override too.
    expect(last.cell_factor_overrides ?? null).toBeNull();
  });

  it("typing a factor in the popover writes cell_factor_overrides", async () => {
    const updates: Array<Partial<ModuleEntry>> = [];
    const w = mount(MatrixSection, {
      props: { module: makeModule(), sourceSubs: SOURCE_SUBS, targetSubs: TARGET_SUBS,
        "onUpdate": (p: Partial<ModuleEntry>) => updates.push(p) },
    });
    // red×silk is library-boost ×2.0; open the popover and type a new factor.
    await w.find('[data-test="mx-cell-red-silk"]').trigger("click");
    await popoverWrap(w).find(".pop-num__field").setValue("2.5");
    const last = updates[updates.length - 1].instance as Record<string, unknown>;
    expect(last.cell_factor_overrides).toEqual({ [RED_SILK]: 2.5 });
  });

  it("Reset button drops both mode and factor overrides for the cell", async () => {
    const updates: Array<Partial<ModuleEntry>> = [];
    const w = mount(MatrixSection, {
      props: {
        module: makeModule({
          instance: {
            cell_mode_overrides: { [RED_COTTON]: "boost" },
            cell_factor_overrides: { [RED_COTTON]: 2.4 },
          },
        }),
        sourceSubs: SOURCE_SUBS,
        targetSubs: TARGET_SUBS,
        "onUpdate": (p: Partial<ModuleEntry>) => updates.push(p),
      },
    });
    await w.find('[data-test="mx-cell-red-cotton"]').trigger("click");
    expect(popoverWrap(w).find(".pop-reset").exists()).toBe(true);
    await popoverWrap(w).find(".pop-reset").trigger("click");
    const last = updates[updates.length - 1].instance as Record<string, unknown>;
    expect(last.cell_mode_overrides ?? null).toBeNull();
    expect(last.cell_factor_overrides ?? null).toBeNull();
  });

  it("Reset button hidden when cell has no override", async () => {
    const w = mount(MatrixSection, {
      props: { module: makeModule(), sourceSubs: SOURCE_SUBS, targetSubs: TARGET_SUBS },
    });
    // red×silk is library-boost, no instance override.
    await w.find('[data-test="mx-cell-red-silk"]').trigger("click");
    expect(popoverWrap(w).find(".pop-reset").exists()).toBe(false);
  });

  it("typing the library factor in the popover drops the override", async () => {
    const updates: Array<Partial<ModuleEntry>> = [];
    const w = mount(MatrixSection, {
      props: {
        module: makeModule({
          instance: { cell_factor_overrides: { [RED_SILK]: 2.5 } },
        }),
        sourceSubs: SOURCE_SUBS,
        targetSubs: TARGET_SUBS,
        "onUpdate": (p: Partial<ModuleEntry>) => updates.push(p),
      },
    });
    // Library factor on red×silk is 2.0; typing that exact value should clear.
    await w.find('[data-test="mx-cell-red-silk"]').trigger("click");
    await popoverWrap(w).find(".pop-num__field").setValue("2");
    const last = updates[updates.length - 1].instance as Record<string, unknown>;
    expect(last.cell_factor_overrides ?? null).toBeNull();
  });
});

describe("constraint MatrixSection — legacy migration", () => {
  it("touching a legacy-disabled cell clears its disabled_matrix_cells entry", async () => {
    const updates: Array<Partial<ModuleEntry>> = [];
    const key = JSON.stringify(["a", "b"]);
    const module = makeModule({
      payload: { matrix: { a: { b: { mode: "neutral", factor: 1 } } } },
      instance: { disabled_matrix_cells: [key] },
    });
    const wrap = mount(MatrixSection, {
      props: {
        module,
        sourceSubs: ["a"],
        targetSubs: ["b"],
        sourceName: "src",
        targetName: "tgt",
        "onUpdate": (p: Partial<ModuleEntry>) => updates.push(p),
      },
    });
    // Open the popover.
    await wrap.find('[data-test="mx-cell-a-b"]').trigger("click");
    // Click EXCLUDE — this writes the override AND should strip the
    // disabled-set entry for the same cell.
    await popoverWrap(wrap).find("button.pop-btn.b-exclude").trigger("click");
    expect(updates.length).toBeGreaterThan(0);
    const lastInstance = (updates[updates.length - 1].instance ?? {}) as Record<string, unknown>;
    const dset = lastInstance.disabled_matrix_cells;
    expect(dset === null || (Array.isArray(dset) && !dset.includes(key))).toBe(true);
    const modeMap = lastInstance.cell_mode_overrides as Record<string, string> | null;
    expect(modeMap && modeMap[key]).toBe("exclude");
  });

  it("legacy `mode: 'allow'` library cells render as s-neutral", () => {
    // Older workflows stored neutral cells as `mode: "allow"`; on read
    // these fold to "neutral" so the UI shows one consistent baseline.
    const legacy = makeModule({
      payload: {
        matrix: { red: { cotton: { mode: "allow" as unknown as "neutral", factor: 1 } } },
      },
    });
    const w = mount(MatrixSection, {
      props: { module: legacy, sourceSubs: ["red"], targetSubs: ["cotton"] },
    });
    expect(w.find('[data-test="mx-cell-red-cotton"]').classes()).toContain("s-neutral");
  });
});

// ── Stranded (read-only) matrix, mirroring the SPA ConstraintMatrix ─
//
// When the parent modal reports a dangling source/target wildcard
// (`stranded`), the grid becomes a read-only snapshot of the configured
// rules: cells are inert (no popover opens), the section root carries a
// `mx--readonly` modifier (dashed frame + muted cells via CSS), and a
// read-only lock affordance replaces the click-to-edit interaction.
describe("constraint MatrixSection — stranded read-only", () => {
  it("marks the section read-only and shows a lock affordance when stranded", () => {
    const w = mount(MatrixSection, {
      props: {
        module: makeModule(),
        sourceSubs: SOURCE_SUBS,
        targetSubs: TARGET_SUBS,
        stranded: true,
      },
    });
    expect(w.find('[data-test="mx-section"]').classes()).toContain("mx--readonly");
    expect(w.find('[data-test="mx-readonly-lock"]').exists()).toBe(true);
  });

  it("cells are inert — clicking does NOT open the rule popover when stranded", async () => {
    const w = mount(MatrixSection, {
      props: {
        module: makeModule(),
        sourceSubs: SOURCE_SUBS,
        targetSubs: TARGET_SUBS,
        stranded: true,
      },
    });
    await w.find('[data-test="mx-cell-red-cotton"]').trigger("click");
    expect(w.findComponent({ name: "CellRulePopover" }).exists()).toBe(false);
    expect(w.find('[data-test="mx-cell-red-cotton"]').classes()).not.toContain("open");
  });

  it("cells keep their s-{state} hue class so the snapshot stays legible", () => {
    const w = mount(MatrixSection, {
      props: {
        module: makeModule(),
        sourceSubs: SOURCE_SUBS,
        targetSubs: TARGET_SUBS,
        stranded: true,
      },
    });
    // Same mode hues as the editable grid (muting is a CSS concern).
    expect(w.find('[data-test="mx-cell-red-silk"]').classes()).toContain("s-boost");
    expect(w.find('[data-test="mx-cell-blue-silk"]').classes()).toContain("s-reduce");
  });

  it("control: a healthy (non-stranded) matrix stays interactive", async () => {
    const w = mount(MatrixSection, {
      props: { module: makeModule(), sourceSubs: SOURCE_SUBS, targetSubs: TARGET_SUBS },
    });
    expect(w.find('[data-test="mx-section"]').classes()).not.toContain("mx--readonly");
    expect(w.find('[data-test="mx-readonly-lock"]').exists()).toBe(false);
    await w.find('[data-test="mx-cell-red-cotton"]').trigger("click");
    expect(w.findComponent({ name: "CellRulePopover" }).exists()).toBe(true);
  });
});

describe("constraint MatrixSection — keyboard", () => {
  it("Escape closes the popover", async () => {
    const w = mount(MatrixSection, {
      props: { module: makeModule(), sourceSubs: SOURCE_SUBS, targetSubs: TARGET_SUBS },
      attachTo: document.body,
    });
    await w.find('[data-test="mx-cell-red-cotton"]').trigger("click");
    expect(w.findComponent({ name: "CellRulePopover" }).exists()).toBe(true);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await w.vm.$nextTick();
    expect(w.findComponent({ name: "CellRulePopover" }).exists()).toBe(false);
    w.unmount();
  });
});
