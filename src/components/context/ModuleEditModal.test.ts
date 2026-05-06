import { describe, it, expect, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import ModuleEditModal from "./ModuleEditModal.vue";
import type { ModuleEntry } from "../../widgets/_shared";
import { _resetForTests } from "../../extension/preview-resolver";

// ModalShell uses <Teleport to="body">. VTU's `find` only walks the
// component's own subtree, so disable teleport globally for these tests
// — content lands inline where wrapper.find can reach it.
const mountOpts = { global: { stubs: { teleport: true } } } as const;

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

function makeFixedValues(): ModuleEntry {
  return {
    id: "fv012345",
    type: "fixed_values",
    enabled: true,
    meta: { name: "presets" },
    entries: [
      { variable_name: "lens", value: "85mm" },
      { variable_name: "angle", value: "wide" },
    ],
    payload: {
      values: [
        { id: "v1", name: "lens", value: "85mm" },
        { id: "v2", name: "angle", value: "wide" },
      ],
    },
    payload_hash: "h_lib",
  };
}

function makeCombine(): ModuleEntry {
  return {
    id: "11111111", type: "combine", enabled: true,
    meta: { name: "Greeting" }, entries: [],
    payload: { template: "Hello $name", output_var: "greeting", input_vars: ["name"] },
    payload_hash: "h",
  };
}

function makeDerivation(): ModuleEntry {
  return {
    id: "22222222", type: "derivation", enabled: true,
    meta: { name: "Mood" }, entries: [],
    payload: { rules: [] },
    payload_hash: "h",
  };
}

function makeConstraint(): ModuleEntry {
  return {
    id: "cccccccc", type: "constraint", enabled: true,
    meta: { name: "Hair × Outfit" }, entries: [],
    payload: {
      source_wildcard_id: "aaaaaaaa",
      target_wildcard_id: "bbbbbbbb",
      matrix: {},
      exceptions: [],
    },
    payload_hash: "h",
  };
}

// ── Shell-level tests (Task 14) ──────────────────────────────────────────────
// These test the shell header/footer and kind dispatcher. Kind-specific body
// tests move to per-kind body test files in Tasks 15-19.

describe("ModuleEditModal — shell header", () => {
  beforeEach(() => _resetForTests());

  it("shows read-only name for wildcard kind", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: makeWildcard() },
    });
    await nextTick();
    expect(wrapper.find(".wp-medit__name-readonly").exists()).toBe(true);
    expect(wrapper.find(".wp-medit__name-readonly").text()).toContain("outfit");
    expect(wrapper.find(".wp-medit__name-input").exists()).toBe(false);
  });

  it("shows editable name input for fixed_values kind", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: makeFixedValues() },
    });
    await nextTick();
    expect(wrapper.find(".wp-medit__name-input").exists()).toBe(true);
    expect(wrapper.find(".wp-medit__name-readonly").exists()).toBe(false);
  });

  it("shows kind label in read-only name span (non-fixed_values)", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: makeWildcard() },
    });
    await nextTick();
    expect(wrapper.find(".wp-medit__name-kind").text()).toContain("wildcard");
  });

  it("renders nothing when module is null", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: null },
    });
    await nextTick();
    expect(wrapper.find(".wp-medit").exists()).toBe(false);
  });

  it("renders nothing when not visible", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: false, module: makeWildcard() },
    });
    await nextTick();
    expect(wrapper.find(".wp-medit").exists()).toBe(false);
  });
});

describe("ModuleEditModal — kind dispatcher (scaffold placeholders)", () => {
  beforeEach(() => _resetForTests());

  it("wildcard → shows WildcardEditorBody (options table rendered)", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: makeWildcard() },
    });
    await nextTick();
    // Scaffold placeholder is gone; the real body renders an options table.
    expect(wrapper.find("[data-test='wc-options-table']").exists()).toBe(true);
  });

  it("fixed_values → shows FixedValuesEditorBody (values table rendered)", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: makeFixedValues() },
    });
    await nextTick();
    expect(wrapper.find("[data-test='fv-values-table']").exists()).toBe(true);
  });

  it("combine → shows CombineEditorBody (template textarea rendered)", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: makeCombine() },
    });
    await nextTick();
    expect(wrapper.find("[data-test='cb-template']").exists()).toBe(true);
  });

  it("derivation → shows DerivationEditorBody placeholder", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: makeDerivation() },
    });
    await nextTick();
    expect(wrapper.text()).toContain("TODO Task 18");
  });

  it("constraint → shows ConstraintEditorBody placeholder", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: makeConstraint() },
    });
    await nextTick();
    expect(wrapper.text()).toContain("TODO Task 19");
  });
});

describe("ModuleEditModal — footer / save / cancel", () => {
  beforeEach(() => _resetForTests());

  it("Cancel emits close", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: makeWildcard() },
    });
    await nextTick();
    await wrapper.find(".wp-medit__btn:not(.wp-medit__btn--primary)").trigger("click");
    expect(wrapper.emitted("close")).toBeTruthy();
  });

  it("Save emits save with the draft module", async () => {
    const mod = makeWildcard();
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: mod },
    });
    await nextTick();
    await wrapper.find(".wp-medit__btn--primary").trigger("click");
    const saved = wrapper.emitted("save")?.[0][0] as ModuleEntry;
    expect(saved).toBeDefined();
    expect(saved.id).toBe("ab12cd34");
    expect(saved.type).toBe("wildcard");
  });

  it("Ctrl+Enter triggers save", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: makeWildcard() },
    });
    await nextTick();
    const ev = new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true });
    window.dispatchEvent(ev);
    await nextTick();
    expect(wrapper.emitted("save")).toBeTruthy();
  });

  it("save with fixed_values (inline, no payload_hash) writes payload.values", async () => {
    const inline: ModuleEntry = {
      id: "inline01",
      type: "fixed_values",
      enabled: true,
      meta: { name: "scratch" },
      entries: [{ variable_name: "tag", value: "noir" }],
      // No payload, no payload_hash → inline-created.
    };
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: inline },
    });
    await flushPromises();
    await wrapper.find(".wp-medit__btn--primary").trigger("click");
    const saved = wrapper.emitted("save")?.[0][0] as ModuleEntry;
    // Inline path: payload.values carries the entry, no override created.
    const vals = (saved.payload as { values: Array<{ name: string; value: string }> }).values;
    expect(vals[0]).toMatchObject({ name: "tag", value: "noir" });
    const ov = (saved.instance as { values_overrides?: unknown } | undefined)?.values_overrides;
    expect(ov).toBeUndefined();
  });

  it("save with library-tracked fixed_values and no edits leaves no override", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: makeFixedValues() },
    });
    await flushPromises();
    await wrapper.find(".wp-medit__btn--primary").trigger("click");
    const saved = wrapper.emitted("save")?.[0][0] as ModuleEntry;
    const ov = (saved.instance as { values_overrides?: unknown } | undefined)?.values_overrides;
    expect(ov).toBeUndefined();
  });
});

// ── Per-kind body field tests (Task 15 — WildcardEditorBody) ────────────────

describe("ModuleEditModal — wildcard option editor (body)", () => {
  beforeEach(() => _resetForTests());

  it("renders one row per option from payload.options", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: makeWildcard() },
    });
    await nextTick();
    // makeWildcard has 3 options: red, blue, green
    const rows = wrapper.findAll("[data-test='wc-options-table'] tbody tr");
    // 3 data rows (not the empty-row fallback)
    expect(rows.length).toBe(3);
  });

  it("name input renders module.meta.name and emits update with patched meta", async () => {
    const mod = makeWildcard();
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: mod },
    });
    await nextTick();
    const input = wrapper.find("[data-test='wc-name']");
    expect(input.exists()).toBe(true);
    expect((input.element as HTMLInputElement).value).toBe("outfit");
    // VTU doesn't allow target in trigger; set value directly then dispatch event.
    (input.element as HTMLInputElement).value = "newname";
    await input.trigger("input");
    await nextTick();
    await wrapper.find(".wp-medit__btn--primary").trigger("click");
    const saved = wrapper.emitted("save")?.[0][0] as ModuleEntry;
    expect(saved.meta.name).toBe("newname");
  });

  it("$varBinding strips leading $ and special chars on input", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: makeWildcard() },
    });
    await nextTick();
    const input = wrapper.find("[data-test='wc-var-binding']");
    expect(input.exists()).toBe(true);
    // VTU doesn't allow target in trigger; set value directly then dispatch event.
    (input.element as HTMLInputElement).value = "$hair-style!";
    await input.trigger("input");
    await nextTick();
    await wrapper.find(".wp-medit__btn--primary").trigger("click");
    const saved = wrapper.emitted("save")?.[0][0] as ModuleEntry;
    const binding = (saved.payload as { var_binding?: string } | undefined)?.var_binding;
    // Leading $ stripped, hyphens and ! stripped → "hairstyle"
    expect(binding).toBe("hairstyle");
  });

  it("Add option appends a new row to payload.options on save", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: makeWildcard() },
    });
    await nextTick();
    await wrapper.find("[data-test='wc-add-option']").trigger("click");
    await nextTick();
    await wrapper.find(".wp-medit__btn--primary").trigger("click");
    const saved = wrapper.emitted("save")?.[0][0] as ModuleEntry;
    const opts = (saved.payload as { options?: unknown[] } | undefined)?.options ?? [];
    // Started with 3, added 1 → 4
    expect(opts.length).toBe(4);
  });

  it("Add sub-category appends to payload.sub_categories on save", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: makeWildcard() },
    });
    await nextTick();
    const subInput = wrapper.find("[data-test='wc-sub-input']");
    await subInput.setValue("warm tones");
    await subInput.trigger("keydown", { key: "Enter" });
    await nextTick();
    await wrapper.find(".wp-medit__btn--primary").trigger("click");
    const saved = wrapper.emitted("save")?.[0][0] as ModuleEntry;
    const subs = (saved.payload as { sub_categories?: string[] } | undefined)?.sub_categories ?? [];
    expect(subs).toContain("warm tones");
  });

  it("probability bar reflects weight ratio (weight 2 out of total 4 → 50%)", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: makeWildcard() },
    });
    await nextTick();
    // options: red=1, blue=2, green=1 → total=4, blue=50%
    const pcts = wrapper.findAll(".wp-prob-pct");
    expect(pcts.length).toBe(3);
    // blue is row index 1 → 50%
    expect(pcts[1].text()).toBe("50%");
    // red and green are each 25%
    expect(pcts[0].text()).toBe("25%");
    expect(pcts[2].text()).toBe("25%");
  });

  it.todo("disables an option → emits save with enabled_options excluding that id — see Task 15");
  it.todo("dropping all overrides → enabled_options falls back to null — see Task 15");
  it.todo("changing a weight → emits save with option_weights[id] set — see Task 15");
  it.todo("setting a weight back to library value drops the override — see Task 15");
  it.todo("bulk disable-all → enabled_options is empty array — see Task 15");
  it.todo("reset clears all instance overrides — see Task 15");
  it.todo("switching to pinned mode defaults pinned_option_id to first option — see Task 15");
  it.todo("pinned mode renders radio inputs, not checkboxes — see Task 15");
  it.todo("changing pinned target → emits save with new pinned_option_id — see Task 15");
  it.todo("leaving pinned mode clears pinned_option_id — see Task 15");
  it.todo("renders @{uuid} refs as @name when preview-resolver cache has them — see Task 15");
  it.todo("subset mode renders sub-category chips when wildcard declares them — see Task 15");
  it.todo("subset mode hides sub-category chips when wildcard has none — see Task 15");
  it.todo("toggling a category chip narrows visible options + persists category_filter — see Task 15");
  it.todo("re-enabling the last category drops category_filter to null — see Task 15");
  it.todo("leaving subcategory mode clears category_filter — see Task 15");
  it.todo("SPA editor href uses /wp/<segment>/<id>/edit (HTML5 history mode) — see Task 15");
  it.todo("toggling Lock sets locked_seed to a number; untoggle drops it to null — see Task 15");
  it.todo("toggling Lock on the first time defaults to seed 0 — see Task 15");
  it.todo("toggling Lock with lastUsedSeedReader uses the reader value — see Task 15");
  it.todo("reader is called with module id (per-module seed lookup) — see Task 15");
  it.todo("lastUsedSeedReader wins over last_locked_seed — see Task 15");
  it.todo("toggling Lock off then on restores last_locked_seed — see Task 15");
  it.todo("toggling Lock off retains last_locked_seed in the saved JSON — see Task 15");
  it.todo("editing the locked-seed input persists the new value — see Task 15");
  it.todo("toggling Internal sets the flag; untoggle drops the field — see Task 15");
  it.todo("does not render name/description inputs for snapshot kinds — see Task 15");
});

describe("ModuleEditModal — fixed_values editor body", () => {
  beforeEach(() => _resetForTests());

  it("name input renders module.meta.name and emits update with patched meta", async () => {
    const mod = makeFixedValues();
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: mod },
    });
    await nextTick();
    const input = wrapper.find("[data-test='fv-name']");
    expect(input.exists()).toBe(true);
    expect((input.element as HTMLInputElement).value).toBe("presets");
    (input.element as HTMLInputElement).value = "portrait presets";
    await input.trigger("input");
    await nextTick();
    await wrapper.find(".wp-medit__btn--primary").trigger("click");
    const saved = wrapper.emitted("save")?.[0][0] as ModuleEntry;
    expect(saved.meta.name).toBe("portrait presets");
  });

  it("$variable name strips leading $ and special chars on input", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: makeFixedValues() },
    });
    await nextTick();
    // First row variable input — makeFixedValues has values[0].name = "lens"
    const varInputs = wrapper.findAll("[data-test='fv-values-table'] tbody input[aria-label='Variable name']");
    expect(varInputs.length).toBeGreaterThan(0);
    const firstInput = varInputs[0];
    (firstInput.element as HTMLInputElement).value = "$new-var!";
    await firstInput.trigger("input");
    await nextTick();
    await wrapper.find(".wp-medit__btn--primary").trigger("click");
    const saved = wrapper.emitted("save")?.[0][0] as ModuleEntry;
    const vals = (saved.payload as { values: Array<{ name: string; value: string }> }).values;
    // Leading $ stripped, hyphen and ! stripped → "newvar"
    expect(vals[0].name).toBe("newvar");
  });

  it("Add value appends a new row to payload.values on save", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: makeFixedValues() },
    });
    await nextTick();
    await wrapper.find("[data-test='fv-add-value']").trigger("click");
    await nextTick();
    await wrapper.find(".wp-medit__btn--primary").trigger("click");
    const saved = wrapper.emitted("save")?.[0][0] as ModuleEntry;
    const vals = (saved.payload as { values?: unknown[] } | undefined)?.values ?? [];
    // Started with 2, added 1 → 3
    expect(vals.length).toBe(3);
  });

  it.todo("library-tracked save with edited entries writes instance.values_overrides — see Task 16");
  it.todo("reset button clears overrides and reloads entries from library payload — see Task 16");
  it.todo("reset button absent on library-tracked fixed_values with no overrides — see Task 16");
  it.todo("reset button absent on inline-created fixed_values — see Task 16");
});

describe("ModuleEditModal — combine editor body", () => {
  beforeEach(() => _resetForTests());

  it("template textarea renders payload.template and emits patchPayload({ template })", async () => {
    const mod = makeCombine();
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: mod },
    });
    await nextTick();
    const ta = wrapper.find("[data-test='cb-template']");
    expect(ta.exists()).toBe(true);
    expect((ta.element as HTMLTextAreaElement).value).toBe("Hello $name");
    (ta.element as HTMLTextAreaElement).value = "$foo and $bar";
    await ta.trigger("input");
    await nextTick();
    await wrapper.find(".wp-medit__btn--primary").trigger("click");
    const saved = wrapper.emitted("save")?.[0][0] as ModuleEntry;
    expect((saved.payload as { template?: string }).template).toBe("$foo and $bar");
  });

  it("output variable strips leading $ and special chars on input", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: makeCombine() },
    });
    await nextTick();
    const input = wrapper.find("[data-test='cb-output-var']");
    expect(input.exists()).toBe(true);
    expect((input.element as HTMLInputElement).value).toBe("greeting");
    (input.element as HTMLInputElement).value = "$new-output!";
    await input.trigger("input");
    await nextTick();
    await wrapper.find(".wp-medit__btn--primary").trigger("click");
    const saved = wrapper.emitted("save")?.[0][0] as ModuleEntry;
    // Leading $ stripped, hyphen and ! stripped → "newoutput"
    expect((saved.payload as { output_var?: string }).output_var).toBe("newoutput");
  });

  it("detected inputs auto-extracted from template ($foo $bar → 2 chips)", async () => {
    const mod: ModuleEntry = {
      id: "33333333", type: "combine", enabled: true,
      meta: { name: "Multi" }, entries: [],
      payload: { template: "$foo and $bar", output_var: "result", input_vars: [] },
      payload_hash: "h2",
    };
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: mod },
    });
    await nextTick();
    const chips = wrapper.find("[data-test='cb-detected']");
    expect(chips.exists()).toBe(true);
    // Should have 2 var chips: foo and bar
    const spans = chips.findAll("span.wp-pill");
    expect(spans.length).toBe(2);
    const texts = spans.map((s) => s.text());
    expect(texts.some((t) => t.includes("foo"))).toBe(true);
    expect(texts.some((t) => t.includes("bar"))).toBe(true);
  });

  it("preview section shows → stored as $output_var", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: makeCombine() },
    });
    await nextTick();
    const preview = wrapper.find("[data-test='cb-preview']");
    expect(preview.exists()).toBe(true);
    expect(preview.text()).toContain("greeting");
    expect(preview.text()).toContain("→");
  });
});

describe("ModuleEditModal — derivation preview (body)", () => {
  it.todo("renders rule list with branches and else — see Task 18");
});

describe("ModuleEditModal — constraint preview (body)", () => {
  it.todo("resolves source/target via siblingModules + reports matrix dims + exceptions count — see Task 19");
});
