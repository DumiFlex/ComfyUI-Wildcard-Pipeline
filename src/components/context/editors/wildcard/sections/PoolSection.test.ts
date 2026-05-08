import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import PoolSection from "./PoolSection.vue";
import type { ModuleEntry } from "../../../../../widgets/_shared";

function makeModule(overrides: Partial<ModuleEntry> = {}): ModuleEntry {
  return {
    id: "ab12cd34",
    type: "wildcard",
    enabled: true,
    meta: { name: "outfit" },
    entries: [],
    payload: {
      var_binding: "outfit",
      sub_categories: ["warm", "cool", "neutral"],
      options: [
        { id: "o1", value: "red", weight: 1, sub_category: "warm" },
        { id: "o2", value: "blue", weight: 1, sub_category: "cool" },
        { id: "o3", value: "green", weight: 1, sub_category: "neutral" },
      ],
    },
    instance: {},
    ...overrides,
  };
}

describe("PoolSection", () => {
  it("renders one chip per sub-category with option count", () => {
    const w = mount(PoolSection, { props: { module: makeModule() } });
    const chips = w.findAll('[data-test^="cat-chip-"]');
    expect(chips).toHaveLength(3);
    expect(chips[0].text()).toContain("warm");
    expect(chips[0].text()).toContain("1");
  });

  it("all chips on (highlighted) when category_filter is null", () => {
    const w = mount(PoolSection, { props: { module: makeModule() } });
    const chips = w.findAll('[data-test^="cat-chip-"]');
    chips.forEach((c) => {
      expect(c.classes()).toContain("cat-chip--on");
    });
  });

  it("only filtered chips highlighted when category_filter is set", () => {
    const w = mount(PoolSection, {
      props: { module: makeModule({ instance: { category_filter: ["warm", "cool"] } }) },
    });
    expect(w.find('[data-test="cat-chip-warm"]').classes()).toContain("cat-chip--on");
    expect(w.find('[data-test="cat-chip-cool"]').classes()).toContain("cat-chip--on");
    expect(w.find('[data-test="cat-chip-neutral"]').classes()).not.toContain("cat-chip--on");
  });

  it("clicking a highlighted chip removes it from category_filter", async () => {
    const w = mount(PoolSection, { props: { module: makeModule() } });
    await w.find('[data-test="cat-chip-neutral"]').trigger("click");
    const updates = w.emitted("update")!;
    const patch = updates[0][0] as Partial<ModuleEntry>;
    expect(patch.instance?.category_filter).toEqual(["warm", "cool"]);
  });

  it("clicking the last unhighlighted chip restores all (null)", async () => {
    const w = mount(PoolSection, {
      props: { module: makeModule({ instance: { category_filter: ["warm", "cool"] } }) },
    });
    await w.find('[data-test="cat-chip-neutral"]').trigger("click");
    const updates = w.emitted("update")!;
    const patch = updates[0][0] as Partial<ModuleEntry>;
    expect(patch.instance?.category_filter).toBeNull();
  });

  it("renders one OptionRow per payload.options entry", () => {
    const w = mount(PoolSection, { props: { module: makeModule() } });
    const rows = w.findAllComponents({ name: "OptionRow" });
    expect(rows).toHaveLength(3);
  });

  it("OptionRow toggle event emits enabled_options patch", async () => {
    const w = mount(PoolSection, { props: { module: makeModule() } });
    const firstRow = w.findComponent({ name: "OptionRow" });
    firstRow.vm.$emit("toggle", "o1");
    await w.vm.$nextTick();
    const updates = w.emitted("update")!;
    const patch = updates[updates.length - 1][0] as Partial<ModuleEntry>;
    // o1 was enabled by default → toggle disables it → enabled_options = ["o2", "o3"]
    expect(patch.instance?.enabled_options).toEqual(["o2", "o3"]);
  });

  it("OptionRow toggle re-enables a disabled option (partial → partial)", async () => {
    // Start with only o2 enabled; toggling o1 lands at ["o1", "o2"] —
    // still partial (o3 disabled), so no collapse to null.
    const w = mount(PoolSection, {
      props: { module: makeModule({ instance: { enabled_options: ["o2"] } }) },
    });
    const firstRow = w.findComponent({ name: "OptionRow" });
    firstRow.vm.$emit("toggle", "o1");
    await w.vm.$nextTick();
    const patch = w.emitted("update")![w.emitted("update")!.length - 1][0] as Partial<ModuleEntry>;
    expect(patch.instance?.enabled_options).toEqual(["o1", "o2"]);
  });

  it("toggling all options back on emits enabled_options=null", async () => {
    const w = mount(PoolSection, {
      props: { module: makeModule({ instance: { enabled_options: ["o1", "o2"] } }) },
    });
    const rows = w.findAllComponents({ name: "OptionRow" });
    rows[2].vm.$emit("toggle", "o3");
    await w.vm.$nextTick();
    const patch = w.emitted("update")![w.emitted("update")!.length - 1][0] as Partial<ModuleEntry>;
    expect(patch.instance?.enabled_options).toBeNull();
  });

  it("OptionRow weight event emits option_weights patch", async () => {
    const w = mount(PoolSection, { props: { module: makeModule() } });
    const firstRow = w.findComponent({ name: "OptionRow" });
    firstRow.vm.$emit("weight", "o1", 2.5);
    await w.vm.$nextTick();
    const patch = w.emitted("update")![w.emitted("update")!.length - 1][0] as Partial<ModuleEntry>;
    expect(patch.instance?.option_weights).toEqual({ o1: 2.5 });
  });

  it("weight = null deletes the entry from option_weights map", async () => {
    const w = mount(PoolSection, {
      props: { module: makeModule({ instance: { option_weights: { o1: 2.5 } } }) },
    });
    const firstRow = w.findComponent({ name: "OptionRow" });
    firstRow.vm.$emit("weight", "o1", null);
    await w.vm.$nextTick();
    const patch = w.emitted("update")![w.emitted("update")!.length - 1][0] as Partial<ModuleEntry>;
    expect(patch.instance?.option_weights).toEqual({});
  });

  it("summary shows enabled count", () => {
    const w = mount(PoolSection, {
      props: { module: makeModule({ instance: { enabled_options: ["o1", "o2"] } }) },
    });
    expect(w.find('[data-test="pool-summary"]').text()).toContain("2 of 3");
  });
});
