import { describe, it, expect, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import ModuleEditModal from "./ModuleEditModal.vue";
import type { ModuleEntry } from "../../widgets/_shared";
import { _resetForTests, _setForTests } from "../../extension/preview-resolver";

// ModalShell uses <Teleport to="body">. VTU's `find` only walks the
// component's own subtree, so disable teleport globally for these tests
// — content lands inline where wrapper.find can reach it.
const mountOpts = { global: { stubs: { teleport: true } } } as const;

/** Switch the modal into `subcategory` (Subset) mode — required before
 * the per-option enable/disable checkboxes render. Default mode is
 * `random` which shows a filler bullet instead. */
async function switchToSubsetMode(wrapper: ReturnType<typeof mount>): Promise<void> {
  const tabs = wrapper.findAll(".wp-medit__mode-tab");
  // Tabs are ordered: Random | Subset | Pinned.
  await tabs[1].trigger("click");
  await nextTick();
}

function makeWildcard(): ModuleEntry {
  return {
    id: "ab12cd34",
    type: "wildcard",
    enabled: true,
    meta: { name: "outfit" },
    entries: [],
    payload: {
      options: [
        { id: "o1", value: "red", weight: 1 },
        { id: "o2", value: "blue", weight: 2 },
        { id: "o3", value: "green", weight: 1 },
      ],
    },
    payload_hash: "deadbeefcafef00d",
  };
}

function makeWildcardWithSubCategories(): ModuleEntry {
  return {
    id: "ab12cd34",
    type: "wildcard",
    enabled: true,
    meta: { name: "color" },
    entries: [],
    payload: {
      sub_categories: ["warm", "cool"],
      options: [
        { id: "o1", value: "red",   weight: 1, sub_category: "warm" },
        { id: "o2", value: "blue",  weight: 1, sub_category: "cool" },
        { id: "o3", value: "amber", weight: 1, sub_category: "warm" },
        { id: "o4", value: "teal",  weight: 1, sub_category: "cool" },
      ],
    },
    payload_hash: "deadbeefcafef00d",
  };
}

describe("ModuleEditModal — wildcard option editor", () => {
  beforeEach(() => _resetForTests());

  it("renders one row per option with library values + weights", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: makeWildcard() },
    });
    await nextTick();
    const rows = wrapper.findAll(".wp-medit__opt");
    expect(rows).toHaveLength(3);
    expect(rows[0].find(".wp-medit__opt-value").text()).toBe("red");
    expect(rows[1].find(".wp-medit__opt-value").text()).toBe("blue");
    expect((rows[1].find<HTMLInputElement>(".wp-medit__opt-weight").element).value).toBe("2");
  });

  it("disables an option → emits save with enabled_options excluding that id", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: makeWildcard() },
    });
    await nextTick();
    await switchToSubsetMode(wrapper);
    const checkboxes = wrapper.findAll<HTMLInputElement>(".wp-medit__opt-toggle");
    // Untoggle the second option (id=o2). Use direct DOM manipulation to
    // ensure :checked binding flips before the change event fires.
    checkboxes[1].element.checked = false;
    await checkboxes[1].trigger("change");
    await wrapper.find(".wp-medit__btn--primary").trigger("click");
    const saved = wrapper.emitted("save")?.[0][0] as ModuleEntry;
    expect(saved.instance?.enabled_options).toEqual(["o1", "o3"]);
  });

  it("dropping all overrides → enabled_options falls back to null (engine default)", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: makeWildcard() },
    });
    await nextTick();
    await switchToSubsetMode(wrapper);
    const cbs = wrapper.findAll<HTMLInputElement>(".wp-medit__opt-toggle");
    // Disable then re-enable the second option — net change zero.
    cbs[1].element.checked = false;
    await cbs[1].trigger("change");
    cbs[1].element.checked = true;
    await cbs[1].trigger("change");
    await wrapper.find(".wp-medit__btn--primary").trigger("click");
    const saved = wrapper.emitted("save")?.[0][0] as ModuleEntry;
    // After Subset → Random switch isn't done here, so `mode` stays
    // `subcategory` and enabled_options drops to null when all enabled.
    expect(saved.instance?.enabled_options).toBeNull();
  });

  it("changing a weight → emits save with option_weights[id] set", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: makeWildcard() },
    });
    await nextTick();
    const weights = wrapper.findAll<HTMLInputElement>(".wp-medit__opt-weight");
    weights[0].element.value = "5";
    await weights[0].trigger("change");
    await wrapper.find(".wp-medit__btn--primary").trigger("click");
    const saved = wrapper.emitted("save")?.[0][0] as ModuleEntry;
    expect(saved.instance?.option_weights).toEqual({ o1: 5 });
  });

  it("setting a weight back to the library value drops the override", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: {
        visible: true,
        module: { ...makeWildcard(), instance: { option_weights: { o1: 5 } } },
      },
    });
    await nextTick();
    const weights = wrapper.findAll<HTMLInputElement>(".wp-medit__opt-weight");
    weights[0].element.value = "1"; // back to library default
    await weights[0].trigger("change");
    await wrapper.find(".wp-medit__btn--primary").trigger("click");
    const saved = wrapper.emitted("save")?.[0][0] as ModuleEntry;
    expect(saved.instance?.option_weights).toBeNull();
  });

  it("bulk disable-all → enabled_options is empty array", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: makeWildcard() },
    });
    await nextTick();
    await switchToSubsetMode(wrapper);
    // First bulk button is enable/disable toggle — initial state all enabled,
    // so click flips it to disable-all.
    const bulkBtns = wrapper.findAll(".wp-medit__bulk-btn");
    await bulkBtns[0].trigger("click");
    await wrapper.find(".wp-medit__btn--primary").trigger("click");
    const saved = wrapper.emitted("save")?.[0][0] as ModuleEntry;
    expect(saved.instance?.enabled_options).toEqual([]);
  });

  it("reset clears all instance overrides", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: {
        visible: true,
        module: {
          ...makeWildcard(),
          instance: {
            mode: "subcategory",
            enabled_options: ["o1"],
            option_weights: { o2: 99 },
          },
        },
      },
    });
    await nextTick();
    // Subset mode renders both bulk buttons (enable-all + reset);
    // reset is the second one.
    const bulkBtns = wrapper.findAll(".wp-medit__bulk-btn");
    await bulkBtns[bulkBtns.length - 1].trigger("click"); // reset
    await wrapper.find(".wp-medit__btn--primary").trigger("click");
    const saved = wrapper.emitted("save")?.[0][0] as ModuleEntry;
    expect(saved.instance).toEqual({});
  });

  it("switching to pinned mode defaults pinned_option_id to first option", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: makeWildcard() },
    });
    await nextTick();
    const tabs = wrapper.findAll(".wp-medit__mode-tab");
    await tabs[2].trigger("click"); // Pinned
    await nextTick();
    await wrapper.find(".wp-medit__btn--primary").trigger("click");
    const saved = wrapper.emitted("save")?.[0][0] as ModuleEntry;
    expect(saved.instance?.mode).toBe("pinned");
    expect(saved.instance?.pinned_option_id).toBe("o1");
  });

  it("pinned mode renders radio inputs, not checkboxes", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: makeWildcard() },
    });
    await nextTick();
    const tabs = wrapper.findAll(".wp-medit__mode-tab");
    await tabs[2].trigger("click");
    await nextTick();
    expect(wrapper.findAll(".wp-medit__opt-radio")).toHaveLength(3);
    expect(wrapper.findAll(".wp-medit__opt-toggle")).toHaveLength(0);
    // Weight cells hidden in pinned mode.
    expect(wrapper.findAll(".wp-medit__opt-weight")).toHaveLength(0);
  });

  it("changing pinned target → emits save with new pinned_option_id", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: makeWildcard() },
    });
    await nextTick();
    const tabs = wrapper.findAll(".wp-medit__mode-tab");
    await tabs[2].trigger("click"); // Pinned (defaults to o1)
    await nextTick();
    const radios = wrapper.findAll<HTMLInputElement>(".wp-medit__opt-radio");
    radios[2].element.checked = true;
    await radios[2].trigger("change");
    await wrapper.find(".wp-medit__btn--primary").trigger("click");
    const saved = wrapper.emitted("save")?.[0][0] as ModuleEntry;
    expect(saved.instance?.pinned_option_id).toBe("o3");
  });

  it("leaving pinned mode clears pinned_option_id", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: {
        visible: true,
        module: {
          ...makeWildcard(),
          instance: { mode: "pinned", pinned_option_id: "o2" },
        },
      },
    });
    await nextTick();
    const tabs = wrapper.findAll(".wp-medit__mode-tab");
    await tabs[0].trigger("click"); // Random
    await nextTick();
    await wrapper.find(".wp-medit__btn--primary").trigger("click");
    const saved = wrapper.emitted("save")?.[0][0] as ModuleEntry;
    expect(saved.instance?.mode).toBeNull(); // random persists as null
    expect(saved.instance?.pinned_option_id).toBeNull();
  });

  it("renders @{uuid} refs as @name when preview-resolver cache has them", async () => {
    _setForTests("a361dbdc", { name: "outfit_color" });
    const mod = makeWildcard();
    mod.payload = {
      options: [
        { id: "o1", value: "@{a361dbdc} jeans", weight: 1 },
        { id: "o2", value: "@{deadbeef} shirt", weight: 1 }, // not cached
      ],
    };
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: mod },
    });
    await nextTick();
    const values = wrapper.findAll(".wp-medit__opt-value");
    expect(values[0].text()).toBe("@outfit_color jeans");
    // Uncached uuid stays as raw placeholder.
    expect(values[1].text()).toBe("@{deadbeef} shirt");
    // The original raw value still appears in the tooltip so the user
    // can copy the underlying syntax if they need it.
    expect(values[0].attributes("title")).toBe("@{a361dbdc} jeans");
  });

  it("subset mode renders sub-category chips when wildcard declares them", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: makeWildcardWithSubCategories() },
    });
    await nextTick();
    await switchToSubsetMode(wrapper);
    const chips = wrapper.findAll(".wp-medit__cat-chip");
    expect(chips.map((c) => c.text())).toEqual(["cool", "warm"]); // sorted
    // All chips active by default (no filter set).
    expect(chips.every((c) => c.classes().includes("wp-medit__cat-chip--active"))).toBe(true);
  });

  it("subset mode hides sub-category chips when wildcard has none", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: makeWildcard() },
    });
    await nextTick();
    await switchToSubsetMode(wrapper);
    expect(wrapper.findAll(".wp-medit__cat-chip")).toHaveLength(0);
  });

  it("toggling a category chip narrows visible options + persists category_filter", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: makeWildcardWithSubCategories() },
    });
    await nextTick();
    await switchToSubsetMode(wrapper);
    const chips = wrapper.findAll(".wp-medit__cat-chip");
    // Click "cool" to toggle it OFF (only "warm" remains).
    await chips[0].trigger("click"); // sorted order → "cool" first
    await nextTick();
    // Visible options should now be only the warm ones (red, amber).
    const values = wrapper.findAll(".wp-medit__opt-value");
    expect(values.map((v) => v.text())).toEqual(["red", "amber"]);
    // Save → category_filter persists with the remaining category.
    await wrapper.find(".wp-medit__btn--primary").trigger("click");
    const saved = wrapper.emitted("save")?.[0][0] as ModuleEntry;
    expect(saved.instance?.category_filter).toEqual(["warm"]);
  });

  it("re-enabling the last category drops category_filter to null (matches default)", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: {
        visible: true,
        module: {
          ...makeWildcardWithSubCategories(),
          instance: { mode: "subcategory", category_filter: ["warm"] },
        },
      },
    });
    await nextTick();
    const chips = wrapper.findAll(".wp-medit__cat-chip");
    // "cool" currently inactive — click to re-enable so all categories on.
    await chips[0].trigger("click"); // "cool" first (sorted)
    await wrapper.find(".wp-medit__btn--primary").trigger("click");
    const saved = wrapper.emitted("save")?.[0][0] as ModuleEntry;
    expect(saved.instance?.category_filter).toBeNull();
  });

  it("leaving subcategory mode clears category_filter", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: {
        visible: true,
        module: {
          ...makeWildcardWithSubCategories(),
          instance: { mode: "subcategory", category_filter: ["warm"] },
        },
      },
    });
    await nextTick();
    const tabs = wrapper.findAll(".wp-medit__mode-tab");
    await tabs[0].trigger("click"); // Random
    await wrapper.find(".wp-medit__btn--primary").trigger("click");
    const saved = wrapper.emitted("save")?.[0][0] as ModuleEntry;
    expect(saved.instance?.category_filter).toBeNull();
  });

  it("SPA editor href uses /wp/<segment>/<id>/edit (HTML5 history mode)", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: makeWildcard() },
    });
    await nextTick();
    const link = wrapper.find(".wp-medit__spa-link");
    const href = link.attributes("href") ?? "";
    // No `#`, no `manager/` segment.
    expect(href).not.toContain("#");
    expect(href).not.toContain("manager/");
    expect(href).toMatch(/\/wp\/wildcards\/ab12cd34\/edit$/);
  });

  it("toggling Lock sets locked_seed to a number; untoggle drops it to null", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: makeWildcard() },
    });
    await nextTick();
    const toggles = wrapper.findAll(".wp-medit__exec-toggle");
    // Lock is the first exec toggle, Internal is the second.
    await toggles[0].trigger("click"); // lock on
    await wrapper.find(".wp-medit__btn--primary").trigger("click");
    let saved = wrapper.emitted("save")?.[0][0] as ModuleEntry;
    expect(typeof saved.instance?.locked_seed).toBe("number");

    // Re-mount with locked instance and toggle off.
    const wrapper2 = mount(ModuleEditModal, {
      ...mountOpts,
      props: {
        visible: true,
        module: { ...makeWildcard(), instance: { locked_seed: 12345 } },
      },
    });
    await nextTick();
    const toggles2 = wrapper2.findAll(".wp-medit__exec-toggle");
    await toggles2[0].trigger("click"); // lock off
    await wrapper2.find(".wp-medit__btn--primary").trigger("click");
    saved = wrapper2.emitted("save")?.[0][0] as ModuleEntry;
    expect(saved.instance?.locked_seed).toBeNull();
  });

  it("toggling Lock on the first time defaults to seed 0 (predictable, not random)", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: makeWildcard() },
    });
    await nextTick();
    const toggles = wrapper.findAll(".wp-medit__exec-toggle");
    await toggles[0].trigger("click"); // lock on
    await wrapper.find(".wp-medit__btn--primary").trigger("click");
    const saved = wrapper.emitted("save")?.[0][0] as ModuleEntry;
    expect(saved.instance?.locked_seed).toBe(0);
    expect(saved.instance?.last_locked_seed).toBe(0);
  });

  it("toggling Lock with lastUsedSeedReader uses the reader value (no last_locked_seed yet)", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: {
        visible: true,
        module: makeWildcard(),
        lastUsedSeedReader: () => 7777,
      },
    });
    await nextTick();
    const toggles = wrapper.findAll(".wp-medit__exec-toggle");
    await toggles[0].trigger("click");
    await wrapper.find(".wp-medit__btn--primary").trigger("click");
    const saved = wrapper.emitted("save")?.[0][0] as ModuleEntry;
    expect(saved.instance?.locked_seed).toBe(7777);
    expect(saved.instance?.last_locked_seed).toBe(7777);
  });

  it("reader is called with module id (per-module seed lookup)", async () => {
    const calls: (string | undefined)[] = [];
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: {
        visible: true,
        module: makeWildcard(),
        lastUsedSeedReader: (id?: string) => {
          calls.push(id);
          return id === "ab12cd34" ? 5555 : null;
        },
      },
    });
    await nextTick();
    const toggles = wrapper.findAll(".wp-medit__exec-toggle");
    await toggles[0].trigger("click");
    await wrapper.find(".wp-medit__btn--primary").trigger("click");
    expect(calls).toContain("ab12cd34"); // module id was passed
    const saved = wrapper.emitted("save")?.[0][0] as ModuleEntry;
    expect(saved.instance?.locked_seed).toBe(5555);
  });

  it("lastUsedSeedReader wins over last_locked_seed (capture latest run on relock)", async () => {
    // Reader-priority: re-locking after a fresh queue should pick up
    // the NEW run's seed rather than sticking to the seed from a
    // previous lock cycle. last_locked_seed is the cold-start
    // fallback only.
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: {
        visible: true,
        module: { ...makeWildcard(), instance: { last_locked_seed: 4242 } },
        lastUsedSeedReader: () => 9999, // priority — most recent run
      },
    });
    await nextTick();
    const toggles = wrapper.findAll(".wp-medit__exec-toggle");
    await toggles[0].trigger("click");
    await wrapper.find(".wp-medit__btn--primary").trigger("click");
    const saved = wrapper.emitted("save")?.[0][0] as ModuleEntry;
    expect(saved.instance?.locked_seed).toBe(9999);
  });

  it("toggling Lock off then on restores last_locked_seed (no fresh randomisation)", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: {
        visible: true,
        module: { ...makeWildcard(), instance: { last_locked_seed: 4242 } },
      },
    });
    await nextTick();
    const toggles = wrapper.findAll(".wp-medit__exec-toggle");
    await toggles[0].trigger("click"); // lock on
    await wrapper.find(".wp-medit__btn--primary").trigger("click");
    const saved = wrapper.emitted("save")?.[0][0] as ModuleEntry;
    expect(saved.instance?.locked_seed).toBe(4242);
  });

  it("toggling Lock off retains last_locked_seed in the saved JSON", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: {
        visible: true,
        module: { ...makeWildcard(), instance: { locked_seed: 1234, last_locked_seed: 1234 } },
      },
    });
    await nextTick();
    const toggles = wrapper.findAll(".wp-medit__exec-toggle");
    await toggles[0].trigger("click"); // lock off
    await wrapper.find(".wp-medit__btn--primary").trigger("click");
    const saved = wrapper.emitted("save")?.[0][0] as ModuleEntry;
    expect(saved.instance?.locked_seed).toBeNull();
    expect(saved.instance?.last_locked_seed).toBe(1234); // preserved
  });

  it("editing the locked-seed input persists the new value", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: {
        visible: true,
        module: { ...makeWildcard(), instance: { locked_seed: 1 } },
      },
    });
    await nextTick();
    const seedInput = wrapper.find<HTMLInputElement>(".wp-medit__exec-seed");
    seedInput.element.value = "9999";
    await seedInput.trigger("change");
    await wrapper.find(".wp-medit__btn--primary").trigger("click");
    const saved = wrapper.emitted("save")?.[0][0] as ModuleEntry;
    expect(saved.instance?.locked_seed).toBe(9999);
  });

  it("toggling Internal sets the flag; untoggle drops the field", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: makeWildcard() },
    });
    await nextTick();
    const toggles = wrapper.findAll(".wp-medit__exec-toggle");
    await toggles[1].trigger("click"); // internal on
    await wrapper.find(".wp-medit__btn--primary").trigger("click");
    const saved = wrapper.emitted("save")?.[0][0] as ModuleEntry;
    expect(saved.instance?.internal).toBe(true);

    // Toggle off → field absent (not just false), keeps JSON minimal.
    const wrapper2 = mount(ModuleEditModal, {
      ...mountOpts,
      props: {
        visible: true,
        module: { ...makeWildcard(), instance: { internal: true } },
      },
    });
    await nextTick();
    const toggles2 = wrapper2.findAll(".wp-medit__exec-toggle");
    await toggles2[1].trigger("click"); // internal off
    await wrapper2.find(".wp-medit__btn--primary").trigger("click");
    const saved2 = wrapper2.emitted("save")?.[0][0] as ModuleEntry;
    expect(saved2.instance?.internal).toBeUndefined();
  });

  it("does not render name/description inputs for snapshot kinds", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: makeWildcard() },
    });
    await nextTick();
    expect(wrapper.find(".wp-medit__name-input").exists()).toBe(false);
    expect(wrapper.find(".wp-medit__meta-input").exists()).toBe(false);
    // Read-only name span IS rendered.
    expect(wrapper.find(".wp-medit__name-readonly").exists()).toBe(true);
  });
});
