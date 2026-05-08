import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import ModuleEditModal from "./ModuleEditModal.vue";
import type { ModuleEntry } from "../../widgets/_shared";
import { _resetForTests } from "../../extension/preview-resolver";
import { INSTANCE_TAB_VISIBLE } from "./editors/_shell";

// Reference-only — keeps imports stable for the new tab-strip section.
void INSTANCE_TAB_VISIBLE;

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

  it("shows read-only name for non-fixed_values v1 kind", async () => {
    // Wildcard now goes through WildcardInstanceModal (v2), so we use a
    // kind that still renders the v1 .wp-medit shell.
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: makeCombine() },
    });
    await nextTick();
    expect(wrapper.find(".wp-medit__name-readonly").exists()).toBe(true);
    expect(wrapper.find(".wp-medit__name-readonly").text()).toContain("Greeting");
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

  it("shows kind label as a kind-chip in the header (non-fixed_values)", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: makeCombine() },
    });
    await nextTick();
    // V3 replaced the `· combine` plain text with `.wp-kind-chip`.
    const chip = wrapper.find(".wp-medit__head .wp-kind-chip");
    expect(chip.exists()).toBe(true);
    expect(chip.text()).toContain("combine");
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
      props: { visible: false, module: makeCombine() },
    });
    await nextTick();
    expect(wrapper.find(".wp-medit").exists()).toBe(false);
  });
});

describe("ModuleEditModal — kind dispatcher (scaffold placeholders)", () => {
  beforeEach(() => _resetForTests());

  // wildcard → WildcardInstanceModal (v2 single-pane) — see
  // src/components/context/editors/wildcard/WildcardInstanceModal.test.ts.
  // Removed from the v1 dispatcher set.

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

  it("derivation → shows DerivationEditorBody (add-rule button rendered)", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: makeDerivation() },
    });
    await nextTick();
    expect(wrapper.find("[data-test='dv-add-rule']").exists()).toBe(true);
  });

  it("constraint → shows ConstraintEditorBody (add-exception button rendered)", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: makeConstraint() },
    });
    await nextTick();
    expect(wrapper.find("[data-test='cn-add-exception']").exists()).toBe(true);
  });
});

describe("ModuleEditModal — footer / save / cancel", () => {
  beforeEach(() => _resetForTests());

  it("Cancel emits close (v1 kind)", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: makeCombine() },
    });
    await nextTick();
    await wrapper.find(".wp-medit__btn:not(.wp-medit__btn--primary)").trigger("click");
    expect(wrapper.emitted("close")).toBeTruthy();
  });

  it("Save emits save with the draft module (v1 kind)", async () => {
    const mod = makeCombine();
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: mod },
    });
    await nextTick();
    await wrapper.find(".wp-medit__btn--primary").trigger("click");
    const saved = wrapper.emitted("save")?.[0][0] as ModuleEntry;
    expect(saved).toBeDefined();
    expect(saved.id).toBe("11111111");
    expect(saved.type).toBe("combine");
  });

  it("Ctrl+Enter triggers save (v1 kind)", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: makeCombine() },
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

describe("ModuleEditModal — derivation editor body", () => {
  beforeEach(() => _resetForTests());

  it("Add rule appends to payload.rules on save", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: makeDerivation() },
    });
    await nextTick();
    // starts with 0 rules; click Add rule
    await wrapper.find("[data-test='dv-add-rule']").trigger("click");
    await nextTick();
    await wrapper.find(".wp-medit__btn--primary").trigger("click");
    const saved = wrapper.emitted("save")?.[0][0] as ModuleEntry;
    const rules = (saved.payload as { rules?: unknown[] } | undefined)?.rules ?? [];
    expect(rules.length).toBe(1);
  });

  it("IF branch When-var input emits patchPayload with updated branches[0].condition.var", async () => {
    const mod: ModuleEntry = {
      id: "22222222", type: "derivation", enabled: true,
      meta: { name: "Mood" }, entries: [],
      payload: {
        rules: [
          {
            id: "r1",
            branches: [{ condition: { var: "", op: "equals", value: "" }, action: { target_var: "", mode: "replace", value: "" } }],
          },
        ],
      },
      payload_hash: "h",
    };
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: mod },
    });
    await nextTick();
    // The condition.var input is aria-label "Condition variable for rule 1 branch 1"
    const varInput = wrapper.find("[aria-label='Condition variable for rule 1 branch 1']");
    expect(varInput.exists()).toBe(true);
    (varInput.element as HTMLInputElement).value = "$mood";
    await varInput.trigger("input");
    await nextTick();
    await wrapper.find(".wp-medit__btn--primary").trigger("click");
    const saved = wrapper.emitted("save")?.[0][0] as ModuleEntry;
    const rules = (saved.payload as { rules: Array<{ branches: Array<{ condition: { var: string } }> }> }).rules;
    expect(rules[0].branches[0].condition.var).toBe("$mood");
  });

  it("Add ELIF appends a second branch with default fields", async () => {
    const mod: ModuleEntry = {
      id: "22222222", type: "derivation", enabled: true,
      meta: { name: "Mood" }, entries: [],
      payload: {
        rules: [
          {
            id: "r1",
            branches: [{ condition: { var: "", op: "equals", value: "" }, action: { target_var: "", mode: "replace", value: "" } }],
          },
        ],
      },
      payload_hash: "h",
    };
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: mod },
    });
    await nextTick();
    await wrapper.find("[data-test='dv-add-elif-0']").trigger("click");
    await nextTick();
    await wrapper.find(".wp-medit__btn--primary").trigger("click");
    const saved = wrapper.emitted("save")?.[0][0] as ModuleEntry;
    const rules = (saved.payload as { rules: Array<{ branches: unknown[] }> }).rules;
    // Rule 0 now has 2 branches: IF + ELIF
    expect(rules[0].branches.length).toBe(2);
  });

  it("Add ELSE toggles rule.else; Remove ELSE drops it", async () => {
    const mod: ModuleEntry = {
      id: "22222222", type: "derivation", enabled: true,
      meta: { name: "Mood" }, entries: [],
      payload: {
        rules: [
          {
            id: "r1",
            branches: [{ condition: { var: "", op: "equals", value: "" }, action: { target_var: "", mode: "replace", value: "" } }],
          },
        ],
      },
      payload_hash: "h",
    };
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: mod },
    });
    await nextTick();
    // Add ELSE
    await wrapper.find("[data-test='dv-add-else-0']").trigger("click");
    await nextTick();
    await wrapper.find(".wp-medit__btn--primary").trigger("click");
    const saved1 = wrapper.emitted("save")?.[0][0] as ModuleEntry;
    const rules1 = (saved1.payload as { rules: Array<{ else?: unknown }> }).rules;
    expect(rules1[0].else).toBeDefined();

    // Remove ELSE
    await wrapper.find("[data-test='dv-remove-else-0']").trigger("click");
    await nextTick();
    await wrapper.find(".wp-medit__btn--primary").trigger("click");
    const saved2 = wrapper.emitted("save")?.[1][0] as ModuleEntry;
    const rules2 = (saved2.payload as { rules: Array<{ else?: unknown }> }).rules;
    expect(rules2[0].else).toBeUndefined();
  });

  it.todo("removing a rule reduces payload.rules.length by 1 — see Task 18");
  it.todo("collapsing a rule hides its branches — see Task 18");
});

describe("ModuleEditModal — constraint editor body", () => {
  beforeEach(() => _resetForTests());

  it("source wildcard field is FIRST in the wildcards pair (source-first ordering)", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: makeConstraint() },
    });
    await nextTick();
    // After the X-cross alignment fix, labels are direct grid children
    // with `grid-area: src-label / tgt-label` instead of being wrapped in
    // `<label class="wp-field">`. The source-first invariant is the same:
    // first label-text is "Source wildcard", second is "Target wildcard".
    const labels = wrapper.findAll(".wp-cn-pair .wp-field-label");
    expect(labels.length).toBeGreaterThanOrEqual(2);
    expect(labels[0].text()).toContain("Source wildcard");
    expect(labels[1].text()).toContain("Target wildcard");
  });

  it("source uuid input emits patchPayload({ source_wildcard_id, matrix: {} })", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: makeConstraint() },
    });
    await nextTick();
    const input = wrapper.find("[data-test='cn-source']");
    expect(input.exists()).toBe(true);
    (input.element as HTMLInputElement).value = "eeeeeeee";
    await input.trigger("input");
    await nextTick();
    await wrapper.find(".wp-medit__btn--primary").trigger("click");
    const saved = wrapper.emitted("save")?.[0][0] as ModuleEntry;
    expect(
      (saved.payload as { source_wildcard_id?: string }).source_wildcard_id,
    ).toBe("eeeeeeee");
    expect((saved.payload as { matrix?: unknown }).matrix).toEqual({});
  });

  it("target uuid input emits patchPayload({ target_wildcard_id, matrix: {} })", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: makeConstraint() },
    });
    await nextTick();
    const input = wrapper.find("[data-test='cn-target']");
    expect(input.exists()).toBe(true);
    (input.element as HTMLInputElement).value = "ffffffff";
    await input.trigger("input");
    await nextTick();
    await wrapper.find(".wp-medit__btn--primary").trigger("click");
    const saved = wrapper.emitted("save")?.[0][0] as ModuleEntry;
    expect(
      (saved.payload as { target_wildcard_id?: string }).target_wildcard_id,
    ).toBe("ffffffff");
    expect((saved.payload as { matrix?: unknown }).matrix).toEqual({});
  });

  it("Add exception appends to payload.exceptions on save", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: makeConstraint() },
    });
    await nextTick();
    // starts with 0 exceptions
    await wrapper.find("[data-test='cn-add-exception']").trigger("click");
    await nextTick();
    await wrapper.find(".wp-medit__btn--primary").trigger("click");
    const saved = wrapper.emitted("save")?.[0][0] as ModuleEntry;
    const excs = (saved.payload as { exceptions?: unknown[] } | undefined)?.exceptions ?? [];
    expect(excs.length).toBe(1);
  });

  it("empty source/target shows matrix-empty hint, not the table", async () => {
    const mod: ModuleEntry = {
      ...makeConstraint(),
      payload: { source_wildcard_id: null, target_wildcard_id: null, matrix: {}, exceptions: [] },
    };
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: mod },
    });
    await nextTick();
    expect(wrapper.find("[data-test='cn-matrix-empty']").exists()).toBe(true);
    expect(wrapper.find("[data-test='cn-matrix']").exists()).toBe(false);
  });

  it.todo("resolves source/target via siblingModules + reports matrix dims + exceptions count — see Task 19");

  it("matrix cell renders cog icon for factor tuning (per spec)", async () => {
    const mod: ModuleEntry = {
      ...makeConstraint(),
      payload: {
        source_wildcard_id: "src-uuid",
        target_wildcard_id: "tgt-uuid",
        matrix: {},
        exceptions: [],
      },
    };
    const siblings: ModuleEntry[] = [
      {
        id: "src-uuid",
        type: "wildcard",
        enabled: true,
        meta: { name: "src" },
        entries: [],
        payload: { sub_categories: ["a"] },
        payload_hash: "h",
      },
      {
        id: "tgt-uuid",
        type: "wildcard",
        enabled: true,
        meta: { name: "tgt" },
        entries: [],
        payload: { sub_categories: ["b"] },
        payload_hash: "h",
      },
    ];
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: mod, siblingModules: siblings },
    });
    await nextTick();
    expect(wrapper.find("[data-test='cn-matrix']").exists()).toBe(true);
    const cog = wrapper.find("[data-test='cn-cell-cog-a-b']");
    expect(cog.exists()).toBe(true);
    expect(cog.find("i.pi-cog").exists()).toBe(true);
  });

  it("cog click triggers factor prompt + setCell on valid number", async () => {
    const mod: ModuleEntry = {
      ...makeConstraint(),
      payload: {
        source_wildcard_id: "src-uuid",
        target_wildcard_id: "tgt-uuid",
        matrix: { a: { b: { mode: "boost", factor: 1 } } },
        exceptions: [],
      },
    };
    const siblings: ModuleEntry[] = [
      {
        id: "src-uuid",
        type: "wildcard",
        enabled: true,
        meta: { name: "src" },
        entries: [],
        payload: { sub_categories: ["a"] },
        payload_hash: "h",
      },
      {
        id: "tgt-uuid",
        type: "wildcard",
        enabled: true,
        meta: { name: "tgt" },
        entries: [],
        payload: { sub_categories: ["b"] },
        payload_hash: "h",
      },
    ];
    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue("2.5");
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: mod, siblingModules: siblings },
    });
    await nextTick();
    await wrapper.find("[data-test='cn-cell-cog-a-b']").trigger("click");
    await nextTick();
    await wrapper.find(".wp-medit__btn--primary").trigger("click");
    const saved = wrapper.emitted("save")?.[0][0] as ModuleEntry;
    const matrix = (saved.payload as { matrix?: Record<string, Record<string, { factor?: number }>> })
      .matrix;
    expect(matrix?.a?.b?.factor).toBe(2.5);
    promptSpy.mockRestore();
  });

  it("cog cancel (prompt returns null) leaves factor unchanged", async () => {
    const mod: ModuleEntry = {
      ...makeConstraint(),
      payload: {
        source_wildcard_id: "src-uuid",
        target_wildcard_id: "tgt-uuid",
        matrix: { a: { b: { mode: "boost", factor: 3 } } },
        exceptions: [],
      },
    };
    const siblings: ModuleEntry[] = [
      {
        id: "src-uuid",
        type: "wildcard",
        enabled: true,
        meta: { name: "src" },
        entries: [],
        payload: { sub_categories: ["a"] },
        payload_hash: "h",
      },
      {
        id: "tgt-uuid",
        type: "wildcard",
        enabled: true,
        meta: { name: "tgt" },
        entries: [],
        payload: { sub_categories: ["b"] },
        payload_hash: "h",
      },
    ];
    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue(null);
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: mod, siblingModules: siblings },
    });
    await nextTick();
    await wrapper.find("[data-test='cn-cell-cog-a-b']").trigger("click");
    await nextTick();
    await wrapper.find(".wp-medit__btn--primary").trigger("click");
    const saved = wrapper.emitted("save")?.[0][0] as ModuleEntry;
    const matrix = (saved.payload as { matrix?: Record<string, Record<string, { factor?: number }>> })
      .matrix;
    expect(matrix?.a?.b?.factor).toBe(3);
    promptSpy.mockRestore();
  });
});

// ── V2 + V3: two-line modal header (mockup v5 lines 1039-1040, 1180, 1260, 1317, 1436) ─

describe("ModuleEditModal — V2 two-line header", () => {
  beforeEach(() => _resetForTests());

  it("renders the .wp-medit__sub subtitle line for v1 kind", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: makeCombine() },
    });
    await nextTick();
    const sub = wrapper.find(".wp-medit__sub");
    expect(sub.exists()).toBe(true);
    expect(sub.text().length).toBeGreaterThan(0);
  });

  it("subtitle text varies per kind (combine ≠ derivation)", async () => {
    const cb = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: makeCombine() },
    });
    await nextTick();
    const cbSub = cb.find(".wp-medit__sub").text();

    const dv = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: makeDerivation() },
    });
    await nextTick();
    const dvSub = dv.find(".wp-medit__sub").text();

    expect(cbSub).not.toBe("");
    expect(dvSub).not.toBe("");
    expect(cbSub).not.toBe(dvSub);
  });
});

describe("ModuleEditModal — V3 kind chip in header", () => {
  beforeEach(() => _resetForTests());

  it("renders .wp-kind-chip in header for v1 kind", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: makeDerivation() },
    });
    await nextTick();
    const chip = wrapper.find(".wp-medit__head .wp-kind-chip");
    expect(chip.exists()).toBe(true);
    expect(chip.text()).toBe("derivation");
  });

  it("kind chip carries its kind-color modifier class", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: makeCombine() },
    });
    await nextTick();
    const chip = wrapper.find(".wp-medit__head .wp-kind-chip");
    expect(chip.classes()).toContain("wp-kind-chip--combine");
  });

  it("renders chip even for fixed_values (editable name) kind", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: makeFixedValues() },
    });
    await nextTick();
    const chip = wrapper.find(".wp-medit__head .wp-kind-chip");
    expect(chip.exists()).toBe(true);
    expect(chip.text()).toBe("fixed");
  });
});

// ── Task 25: tab strip + dispatcher ────────────────────────────────────────

describe("ModuleEditModal — tab strip + dispatcher (v1 kinds)", () => {
  beforeEach(() => _resetForTests());

  it("renders tab strip with both tabs for v1 kinds where INSTANCE_TAB_VISIBLE is true", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: makeCombine() },
    });
    await nextTick();
    expect(wrapper.find('[data-test="tab-library"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="tab-instance"]').exists()).toBe(true);
  });

  it("hides Instance tab for pipeline kind", async () => {
    const m: ModuleEntry = {
      id: "ppppppp1", type: "pipeline", enabled: true,
      meta: { name: "p" }, entries: [],
      payload: {},
    };
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts, props: { visible: true, module: m },
    });
    await nextTick();
    expect(wrapper.find('[data-test="tab-instance"]').exists()).toBe(false);
  });

  it("smart default: opens Library tab when instance has no overrides", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: { ...makeCombine(), instance: {} } },
    });
    await nextTick();
    expect(wrapper.find('[data-test="tab-library"]').attributes("aria-selected")).toBe("true");
  });

  it("smart default: opens Instance tab when any registry field is non-null", async () => {
    const m = { ...makeCombine(), instance: { internal: true } };
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts, props: { visible: true, module: m },
    });
    await nextTick();
    expect(wrapper.find('[data-test="tab-instance"]').attributes("aria-selected")).toBe("true");
  });

  it("orange dot appears on Instance tab when modified-state is true", async () => {
    const m = { ...makeCombine(), instance: { internal: true } };
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts, props: { visible: true, module: m },
    });
    await nextTick();
    expect(wrapper.find('[data-test="tab-instance-dot"]').exists()).toBe(true);
  });

  it("modified-state ignores _ui namespace", async () => {
    const m = { ...makeCombine(), instance: { _ui: { last_locked_seed: 42 } } };
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts, props: { visible: true, module: m },
    });
    await nextTick();
    expect(wrapper.find('[data-test="tab-instance-dot"]').exists()).toBe(false);
  });

  it("Clear all overrides footer button exists on Instance tab", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: { ...makeCombine(), instance: { internal: true } } },
    });
    await nextTick();
    // Instance tab is the smart default for this module
    expect(wrapper.find('[data-test="clear-all-overrides"]').exists()).toBe(true);
  });

  it("Clear all sets all registry fields to null on confirm", async () => {
    const m = {
      ...makeCombine(),
      instance: { internal: true },
    };
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts, props: { visible: true, module: m },
    });
    await nextTick();
    // Click the Clear-all button → ConfirmDialog opens (themed,
    // replaces window.confirm). Click the dialog's Confirm button to
    // approve, then save the modal and assert the cleared field.
    // Teleport stub keeps the dialog inside the wrapper DOM in tests.
    await wrapper.find('[data-test="clear-all-overrides"]').trigger("click");
    await nextTick();
    const confirmBtn = wrapper.find('[data-test="confirm-confirm"]');
    expect(confirmBtn.exists()).toBe(true);
    await confirmBtn.trigger("click");
    await nextTick();
    await wrapper.find(".wp-medit__btn--primary").trigger("click");
    const saved = wrapper.emitted("save")?.[0][0] as ModuleEntry;
    expect(saved.instance?.internal).toBeNull();
  });

  it("Clear all does NOT clear when user cancels the confirm dialog", async () => {
    const m = {
      ...makeCombine(),
      instance: { internal: true },
    };
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts, props: { visible: true, module: m },
    });
    await nextTick();
    await wrapper.find('[data-test="clear-all-overrides"]').trigger("click");
    await nextTick();
    await wrapper.find('[data-test="confirm-cancel"]').trigger("click");
    await nextTick();
    await wrapper.find(".wp-medit__btn--primary").trigger("click");
    const saved = wrapper.emitted("save")?.[0][0] as ModuleEntry;
    // Cancelled → original override survives
    expect(saved.instance?.internal).toBe(true);
  });
});

// ── Wildcard v2 dispatcher branch ─────────────────────────────────────────

describe("ModuleEditModal — wildcard v2 dispatcher", () => {
  beforeEach(() => _resetForTests());

  it("renders WildcardInstanceModal (no tab strip) for wildcard kind", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: makeWildcard() },
    });
    await nextTick();
    expect(wrapper.findComponent({ name: "WildcardInstanceModal" }).exists()).toBe(true);
    expect(wrapper.find('[data-test="tab-library"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="tab-instance"]').exists()).toBe(false);
  });

  it("renders v1 tab strip for non-wildcard kinds", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: makeFixedValues() },
    });
    await nextTick();
    expect(wrapper.findComponent({ name: "WildcardInstanceModal" }).exists()).toBe(false);
    expect(wrapper.find('[data-test="tab-library"]').exists()).toBe(true);
  });

  it("forwards WildcardInstanceModal update event into draft mutation", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: makeWildcard() },
    });
    await nextTick();
    const wcm = wrapper.findComponent({ name: "WildcardInstanceModal" });
    wcm.vm.$emit("update", { instance: { variable_binding: "renamed" } });
    await nextTick();
    // Save and check the emitted draft has the binding override applied.
    await wrapper.find('[data-test="wcm-save"]').trigger("click");
    const saved = wrapper.emitted("save")?.[0][0] as ModuleEntry;
    expect(saved.instance?.variable_binding).toBe("renamed");
  });
});
