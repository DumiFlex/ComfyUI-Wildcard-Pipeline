import { mount } from "@vue/test-utils";
import { describe, it, expect } from "vitest";
import PoolSection from "../sections/PoolSection.vue";
import type { ModuleEntry } from "@/widgets/_shared";

const module = {
  payload: {
    options: [
      { id: "a", value: "cat", weight: 1, sub_categories: ["feline", "warm"] },
      { id: "b", value: "wolf", weight: 1, sub_categories: ["canine", "cold"] },
    ],
    sub_categories: ["feline", "canine", "warm", "cold"],
    tag_groups: { family: ["feline", "canine"], temp: ["warm", "cold"] },
  },
  instance: {},
} as unknown as ModuleEntry;

function makeModule(overrides: Partial<ModuleEntry> = {}): ModuleEntry {
  return {
    id: "ab12cd34",
    type: "wildcard",
    enabled: true,
    meta: { name: "outfit" },
    entries: [],
    payload: {
      var_binding: "outfit",
      sub_categories: ["feline", "canine", "warm", "cold"],
      tag_groups: { family: ["feline", "canine"], temp: ["warm", "cold"] },
      options: [
        { id: "a", value: "cat", weight: 1, sub_categories: ["feline", "warm"] },
        { id: "b", value: "wolf", weight: 1, sub_categories: ["canine", "cold"] },
        { id: "c", value: "owl", weight: 1, sub_categories: ["warm"] },
      ],
    },
    instance: {},
    ...overrides,
  } as unknown as ModuleEntry;
}

function lastPatch(w: ReturnType<typeof mount>): Partial<ModuleEntry> {
  const updates = w.emitted("update")!;
  return updates[updates.length - 1][0] as Partial<ModuleEntry>;
}

describe("PoolSection pick-count (SP2a)", () => {
  it("min stepper emits a pick_min update", async () => {
    const w = mount(PoolSection, { props: { module: makeModule() } });
    const min = w.get('[data-test="pool-pick-min"]');
    (min.element as HTMLInputElement).value = "2";
    await min.trigger("input");
    expect(lastPatch(w).instance?.pick_min).toBe(2);
  });

  it("max stepper emits a pick_max update", async () => {
    const w = mount(PoolSection, { props: { module: makeModule() } });
    const max = w.get('[data-test="pool-pick-max"]');
    (max.element as HTMLInputElement).value = "3";
    await max.trigger("input");
    expect(lastPatch(w).instance?.pick_max).toBe(3);
  });

  it("'Allow repeats' toggle hides for single-pick, shows for multi + emits pick_independent (SP2c)", async () => {
    // Single-pick (default 1..1): toggle irrelevant → hidden.
    const single = mount(PoolSection, { props: { module: makeModule() } });
    expect(single.find('[data-test="pool-allow-repeats"]').exists()).toBe(false);
    // Multi-pick (1..3): toggle shows; checking it emits pick_independent=true.
    const w = mount(PoolSection, {
      props: { module: makeModule({ instance: { pick_min: 1, pick_max: 3 } } as Partial<ModuleEntry>) },
    });
    const toggle = w.find('[data-test="pool-allow-repeats"]');
    expect(toggle.exists()).toBe(true);
    await toggle.find(".wp-check").trigger("click"); // shared Checkbox toggles on box-click
    expect(lastPatch(w).instance?.pick_independent).toBe(true);
  });

  it("clamps max UP to min when min is set above max (SP2a — no inverted range)", async () => {
    const w = mount(PoolSection, {
      props: { module: makeModule({ instance: { pick_min: 1, pick_max: 2 } } as Partial<ModuleEntry>) },
    });
    const min = w.get('[data-test="pool-pick-min"]');
    (min.element as HTMLInputElement).value = "5";
    await min.trigger("input");
    const inst = lastPatch(w).instance;
    expect(inst?.pick_min).toBe(5);
    expect(inst?.pick_max).toBe(5);
  });

  it("clamps min DOWN to max when max is set below min (SP2a — no inverted range)", async () => {
    const w = mount(PoolSection, {
      props: { module: makeModule({ instance: { pick_min: 3, pick_max: 4 } } as Partial<ModuleEntry>) },
    });
    const max = w.get('[data-test="pool-pick-max"]');
    (max.element as HTMLInputElement).value = "1";
    await max.trigger("input");
    const inst = lastPatch(w).instance;
    expect(inst?.pick_max).toBe(1);
    expect(inst?.pick_min).toBe(1);
  });

  it("min up-arrow button bumps pick_min by 1 (SP2a)", async () => {
    const w = mount(PoolSection, {
      props: { module: makeModule({ instance: { pick_min: 1, pick_max: 3 } } as Partial<ModuleEntry>) },
    });
    await w.get('[data-test="pool-pick-min-up"]').trigger("click");
    expect(lastPatch(w).instance?.pick_min).toBe(2);
  });

  it("enabled count excludes the null option in multi-pick (SP2a)", () => {
    const m = {
      id: "x", type: "wildcard", enabled: true, meta: { name: "w" }, entries: [],
      payload: {
        var_binding: "w", sub_categories: [], tag_groups: {},
        options: [
          { id: "a", value: "cat", weight: 1, sub_categories: [] },
          { id: "n", value: "", weight: 1, is_null: true, sub_categories: [] },
        ],
      },
      instance: { pick_min: 1, pick_max: 3 },
    } as unknown as ModuleEntry;
    const w = mount(PoolSection, { props: { module: m } });
    // Only "a" counts — null is dropped from the multi pool (was wrongly 2 of 2).
    expect(w.find('[data-test="pool-summary"]').text()).toMatch(/1\s*of\s*2/);
  });

  it("separator input appears only when max > 1", () => {
    const single = mount(PoolSection, { props: { module: makeModule() } });
    expect(single.find('[data-test="pool-pick-sep"]').exists()).toBe(false);
    const multi = mount(PoolSection, {
      props: { module: makeModule({ instance: { pick_min: 1, pick_max: 3 } } as Partial<ModuleEntry>) },
    });
    expect(multi.find('[data-test="pool-pick-sep"]').exists()).toBe(true);
  });

  it("disables exclude_null when multi-pick is active", () => {
    const m = {
      id: "x", type: "wildcard", enabled: true, meta: { name: "w" }, entries: [],
      payload: {
        var_binding: "w", sub_categories: [], tag_groups: {},
        options: [
          { id: "a", value: "cat", weight: 1, sub_categories: [] },
          { id: "n", value: "", weight: 1, is_null: true, sub_categories: [] },
        ],
      },
      instance: { pick_min: 0, pick_max: 2 },
    } as unknown as ModuleEntry;
    const w = mount(PoolSection, { props: { module: m } });
    // Inline wp-check span; locked state surfaces as aria-disabled.
    const cb = w.get('[data-test="pool-exclude-null"] .wp-check');
    expect(cb.attributes("aria-disabled")).toBe("true");
  });

  it("pool summary surfaces the pick range when multi-pick (SP2a)", () => {
    const w = mount(PoolSection, {
      props: { module: makeModule({ instance: { pick_min: 1, pick_max: 3 } } as Partial<ModuleEntry>) },
    });
    const picks = w.find('[data-test="pool-summary-picks"]');
    expect(picks.exists()).toBe(true);
    expect(picks.text()).toBe("1–3");
  });

  it("pool summary omits the pick range in single-pick mode", () => {
    const w = mount(PoolSection, { props: { module: makeModule() } });
    expect(w.find('[data-test="pool-summary-picks"]').exists()).toBe(false);
  });
});

describe("PoolSection grouped quick pills", () => {
  it("ticking family=feline + temp=warm builds 'feline and warm'", async () => {
    const w = mount(PoolSection, { props: { module } });
    await w.get('[data-test="cat-chip-feline"]').trigger("click");
    await w.get('[data-test="cat-chip-warm"]').trigger("click");
    const updates = w.emitted("update")!;
    const patch = updates[updates.length - 1]![0] as Partial<ModuleEntry>;
    expect(patch.instance?.category_filter).toBe("feline and warm");
  });

  it("shows an Advanced toggle that reveals the expression editor", async () => {
    const w = mount(PoolSection, { props: { module } });
    await w.get('[data-test="pool-advanced"]').trigger("click");
    expect(w.find('[data-test="expr-input"]').exists()).toBe(true);
  });

  it("advanced palette inserts a sub-category token at the cursor (#7)", async () => {
    const w = mount(PoolSection, { props: { module } });
    await w.get('[data-test="pool-advanced"]').trigger("click");
    await w.get('[data-test="pool-ins-feline"]').trigger("click");
    expect(lastPatch(w).instance?.category_filter).toBe("feline");
  });

  it("ticking two tags in the same group ORs them inside parens", async () => {
    const w = mount(PoolSection, { props: { module } });
    await w.get('[data-test="cat-chip-feline"]').trigger("click");
    await w.get('[data-test="cat-chip-canine"]').trigger("click");
    expect(lastPatch(w).instance?.category_filter).toBe("(feline or canine)");
  });

  it("multi-term group AND'd with a single-term group keeps parens only on the multi", async () => {
    const w = mount(PoolSection, { props: { module } });
    await w.get('[data-test="cat-chip-feline"]').trigger("click");
    await w.get('[data-test="cat-chip-canine"]').trigger("click");
    await w.get('[data-test="cat-chip-warm"]').trigger("click");
    expect(lastPatch(w).instance?.category_filter).toBe("(feline or canine) and warm");
  });

  it("unticking the last tag clears the filter to empty string", async () => {
    const w = mount(PoolSection, {
      props: { module: makeModule({ instance: { category_filter: "feline" } }) },
    });
    await w.get('[data-test="cat-chip-feline"]').trigger("click");
    expect(lastPatch(w).instance?.category_filter).toBe("");
  });

  it("renders pills grouped under their axis headings", () => {
    const w = mount(PoolSection, { props: { module } });
    const groups = w.findAll('[data-test^="pool-group-"]');
    // family + temp = two axis clusters.
    expect(groups.length).toBe(2);
  });

  it("places ungrouped tags into an 'other' cluster", () => {
    const w = mount(PoolSection, {
      props: {
        module: {
          payload: {
            options: [{ id: "a", value: "x", weight: 1, sub_categories: ["loose"] }],
            sub_categories: ["feline", "loose"],
            tag_groups: { family: ["feline"] },
          },
          instance: {},
        } as unknown as ModuleEntry,
      },
    });
    expect(w.find('[data-test="pool-group-other"]').exists()).toBe(true);
    expect(w.find('[data-test="cat-chip-loose"]').exists()).toBe(true);
  });
});

describe("PoolSection advanced expression editor", () => {
  it("prefills the expression input from the existing category_filter", async () => {
    const w = mount(PoolSection, {
      props: { module: makeModule({ instance: { category_filter: "feline and warm" } }) },
    });
    await w.get('[data-test="pool-advanced"]').trigger("click");
    const input = w.get<HTMLInputElement>('[data-test="expr-input"]').element;
    expect(input.value).toBe("feline and warm");
  });

  it("emits category_filter when a valid expression is typed", async () => {
    const w = mount(PoolSection, { props: { module: makeModule() } });
    await w.get('[data-test="pool-advanced"]').trigger("click");
    const input = w.get<HTMLInputElement>('[data-test="expr-input"]');
    input.element.value = "not canine";
    await input.trigger("input");
    expect(lastPatch(w).instance?.category_filter).toBe("not canine");
  });

  it("does NOT emit while the expression is invalid", async () => {
    const w = mount(PoolSection, { props: { module: makeModule() } });
    await w.get('[data-test="pool-advanced"]').trigger("click");
    const input = w.get<HTMLInputElement>('[data-test="expr-input"]');
    input.element.value = "feline and";
    await input.trigger("input");
    expect(w.emitted("update")).toBeUndefined();
  });

  it("flags an unknown sub-category as invalid", async () => {
    const w = mount(PoolSection, { props: { module: makeModule() } });
    await w.get('[data-test="pool-advanced"]').trigger("click");
    const input = w.get<HTMLInputElement>('[data-test="expr-input"]');
    input.element.value = "zebra";
    await input.trigger("input");
    expect(w.find('[data-test="expr-error"]').exists()).toBe(true);
    expect(w.emitted("update")).toBeUndefined();
  });

  it("shows a 'reads as' normalized preview for a valid expression", async () => {
    const w = mount(PoolSection, {
      props: { module: makeModule({ instance: { category_filter: "feline,warm" } }) },
    });
    await w.get('[data-test="pool-advanced"]').trigger("click");
    // Comma is OR sugar — reads-as normalizes it to the word form.
    expect(w.get('[data-test="expr-reads-as"]').text()).toContain("feline or warm");
  });
});

describe("PoolSection exclude-null toggle", () => {
  // The toggle only renders when the wildcard has a null option (#5), so
  // append one to the fixture for the toggle/reflect cases.
  function withNullOption(m: ModuleEntry): ModuleEntry {
    (m.payload as { options: Array<Record<string, unknown>> }).options.push({
      id: "n", value: "", weight: 1, is_null: true,
    });
    return m;
  }

  it("emits exclude_null=true when toggled on", async () => {
    const w = mount(PoolSection, { props: { module: withNullOption(makeModule()) } });
    // Clicking the shared Checkbox box toggles exclude_null (#4).
    await w.get('[data-test="pool-exclude-null"] .wp-check').trigger("click");
    expect(lastPatch(w).instance?.exclude_null).toBe(true);
  });

  it("reflects an existing exclude_null instance value", () => {
    const w = mount(PoolSection, {
      props: { module: withNullOption(makeModule({ instance: { exclude_null: true } })) },
    });
    // "On" reads off aria-checked on the wp-check span.
    const cb = w.get('[data-test="pool-exclude-null"] .wp-check');
    expect(cb.attributes("aria-checked")).toBe("true");
  });

  it("hides the toggle entirely when the wildcard has no null option (#5)", () => {
    const w = mount(PoolSection, { props: { module: makeModule() } });
    expect(w.find('[data-test="pool-exclude-null"]').exists()).toBe(false);
  });

  it("toggling the null option row drives exclude_null, not enabled_options (#3)", async () => {
    const w = mount(PoolSection, { props: { module: withNullOption(makeModule()) } });
    // The appended null option renders as the last row; unchecking its box is
    // the same control as "Exclude null", so it must flip exclude_null.
    const checks = w.findAll('[data-test="opt-check"]');
    await checks[checks.length - 1].trigger("click");
    const patch = lastPatch(w);
    expect(patch.instance?.exclude_null).toBe(true);
    expect(patch.instance?.enabled_options).toBeUndefined();
  });
});

describe("PoolSection option rows", () => {
  it("renders one OptionRow per payload.options entry", () => {
    const w = mount(PoolSection, { props: { module: makeModule() } });
    const rows = w.findAllComponents({ name: "OptionRow" });
    expect(rows).toHaveLength(3);
  });

  it("OptionRow toggle event emits enabled_options patch", async () => {
    const w = mount(PoolSection, { props: { module: makeModule() } });
    const firstRow = w.findComponent({ name: "OptionRow" });
    firstRow.vm.$emit("toggle", "a");
    await w.vm.$nextTick();
    // a was enabled by default → toggle disables it → enabled_options = ["b", "c"]
    expect(lastPatch(w).instance?.enabled_options).toEqual(["b", "c"]);
  });

  it("toggling all options back on emits enabled_options=null", async () => {
    const w = mount(PoolSection, {
      props: { module: makeModule({ instance: { enabled_options: ["a", "b"] } }) },
    });
    const rows = w.findAllComponents({ name: "OptionRow" });
    rows[2].vm.$emit("toggle", "c");
    await w.vm.$nextTick();
    expect(lastPatch(w).instance?.enabled_options).toBeNull();
  });

  it("OptionRow weight event emits option_weights patch", async () => {
    const w = mount(PoolSection, { props: { module: makeModule() } });
    const firstRow = w.findComponent({ name: "OptionRow" });
    firstRow.vm.$emit("weight", "a", 2.5);
    await w.vm.$nextTick();
    expect(lastPatch(w).instance?.option_weights).toEqual({ a: 2.5 });
  });

  it("weight = null deletes the entry from option_weights map", async () => {
    const w = mount(PoolSection, {
      props: { module: makeModule({ instance: { option_weights: { a: 2.5 } } }) },
    });
    const firstRow = w.findComponent({ name: "OptionRow" });
    firstRow.vm.$emit("weight", "a", null);
    await w.vm.$nextTick();
    expect(lastPatch(w).instance?.option_weights).toEqual({});
  });

  it("passes tag_groups down to each OptionRow for axis colouring", () => {
    const w = mount(PoolSection, { props: { module: makeModule() } });
    const firstRow = w.findComponent({ name: "OptionRow" });
    expect(firstRow.props("tagGroups")).toEqual({
      family: ["feline", "canine"],
      temp: ["warm", "cold"],
    });
  });

  it("summary shows enabled count", () => {
    const w = mount(PoolSection, {
      props: { module: makeModule({ instance: { enabled_options: ["a", "b"] } }) },
    });
    expect(w.find('[data-test="pool-summary"]').text()).toContain("2 of 3");
  });
});
