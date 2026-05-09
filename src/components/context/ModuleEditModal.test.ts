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
    // Wildcard + fixed_values + combine + derivation all go through v2
    // single-pane modals. Constraint is the last v1 .wp-medit shell.
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: makeConstraint() },
    });
    await nextTick();
    expect(wrapper.find(".wp-medit__name-readonly").exists()).toBe(true);
    expect(wrapper.find(".wp-medit__name-readonly").text()).toContain("Hair");
    expect(wrapper.find(".wp-medit__name-input").exists()).toBe(false);
  });

  it("fixed_values kind goes through v2 modal (no v1 .wp-medit shell)", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: makeFixedValues() },
    });
    await nextTick();
    // v2 dispatch — name editing happens in IdentitySection now.
    expect(wrapper.findComponent({ name: "FixedValuesInstanceModal" }).exists()).toBe(true);
    expect(wrapper.find('[data-test="id-name"]').exists()).toBe(true);
  });

  it("shows kind label as a kind-chip in the header (non-fixed_values)", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: makeConstraint() },
    });
    await nextTick();
    // V3 replaced the `· constraint` plain text with `.wp-kind-chip`.
    const chip = wrapper.find(".wp-medit__head .wp-kind-chip");
    expect(chip.exists()).toBe(true);
    expect(chip.text()).toContain("constraint");
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
      props: { visible: false, module: makeConstraint() },
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

  // fixed_values → FixedValuesInstanceModal (v2 single-pane) — see
  // src/components/context/editors/fixed-values/FixedValuesInstanceModal.test.ts.
  // Removed from the v1 dispatcher set.

  // combine → CombineInstanceModal (v2 single-pane) — see
  // src/components/context/editors/combine/CombineInstanceModal.test.ts.
  // Removed from the v1 dispatcher set.

  it("combine → routes to v2 CombineInstanceModal (no v1 .wp-medit shell)", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: makeCombine() },
    });
    await nextTick();
    // v2 modal renders its own .cbm root (CombineInstanceModal.vue);
    // v1 fallback renders .wp-medit shell. Both anchors verify dispatch.
    expect(wrapper.find(".cbm").exists()).toBe(true);
    expect(wrapper.find(".wp-medit").exists()).toBe(false);
  });

  // derivation → DerivationInstanceModal (v2 single-pane) — see
  // src/components/context/editors/derivation/DerivationInstanceModal.test.ts.
  // Removed from the v1 dispatcher set.

  it("derivation → routes to v2 DerivationInstanceModal (no v1 .wp-medit shell)", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: makeDerivation() },
    });
    await nextTick();
    expect(wrapper.find(".dvm").exists()).toBe(true);
    expect(wrapper.find(".wp-medit").exists()).toBe(false);
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
      props: { visible: true, module: makeConstraint() },
    });
    await nextTick();
    await wrapper.find(".wp-medit__btn:not(.wp-medit__btn--primary)").trigger("click");
    expect(wrapper.emitted("close")).toBeTruthy();
  });

  it("Save emits save with the draft module (v1 kind)", async () => {
    const mod = makeConstraint();
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: mod },
    });
    await nextTick();
    await wrapper.find(".wp-medit__btn--primary").trigger("click");
    const saved = wrapper.emitted("save")?.[0][0] as ModuleEntry;
    expect(saved).toBeDefined();
    expect(saved.id).toBe("cccccccc");
    expect(saved.type).toBe("constraint");
  });

  it("Ctrl+Enter triggers save (v1 kind)", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: makeConstraint() },
    });
    await nextTick();
    const ev = new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true });
    window.dispatchEvent(ev);
    await nextTick();
    expect(wrapper.emitted("save")).toBeTruthy();
  });

  it("save with fixed_values (inline, no payload_hash) writes payload.values via v2 reconciliation", async () => {
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
    // v2 modal Save button.
    await wrapper.find('[data-test="fvm-save"]').trigger("click");
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
    await wrapper.find('[data-test="fvm-save"]').trigger("click");
    const saved = wrapper.emitted("save")?.[0][0] as ModuleEntry;
    const ov = (saved.instance as { values_overrides?: unknown } | undefined)?.values_overrides;
    expect(ov).toBeUndefined();
  });
});


// ─ "ModuleEditModal — combine editor body" describe block removed.
// Combine migrated to v2 single-pane modal in 2026-05-08 cycle. New
// per-section coverage lives in:
//   src/components/context/editors/combine/sections/IdentitySection.test.ts
//   src/components/context/editors/combine/sections/TemplateSection.test.ts
//   src/components/context/editors/combine/sections/RuntimeSection.test.ts
//   src/components/context/editors/combine/CombineInstanceModal.test.ts

// ─ "ModuleEditModal — derivation editor body" describe block removed.
// Derivation migrated to v2 single-pane modal in 2026-05-09 cycle. New
// per-section coverage lives in:
//   src/components/context/editors/derivation/sections/IdentitySection.test.ts
//   src/components/context/editors/derivation/sections/RulesSection.test.ts
//   src/components/context/editors/derivation/DerivationInstanceModal.test.ts
// Library-level rule editing (add/remove rule, IF branches, ELIF, ELSE)
// stays in SPA — modal exposes only per-rule disable toggle now.

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
    // Constraint is the only remaining v1 kind after the 2026-05-09
    // derivation migration. Pipeline has no instance fields and skips
    // the modal shell entirely.
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: makeConstraint() },
    });
    await nextTick();
    const sub = wrapper.find(".wp-medit__sub");
    expect(sub.exists()).toBe(true);
    expect(sub.text().length).toBeGreaterThan(0);
  });
});

describe("ModuleEditModal — V3 kind chip in header", () => {
  beforeEach(() => _resetForTests());

  it("renders .wp-kind-chip in header for v1 kind", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: makeConstraint() },
    });
    await nextTick();
    const chip = wrapper.find(".wp-medit__head .wp-kind-chip");
    expect(chip.exists()).toBe(true);
    expect(chip.text()).toBe("constraint");
  });

  it("kind chip carries its kind-color modifier class", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: makeConstraint() },
    });
    await nextTick();
    const chip = wrapper.find(".wp-medit__head .wp-kind-chip");
    expect(chip.classes()).toContain("wp-kind-chip--constraint");
  });

  it("v2 fixed_values modal renders its own kind chip via FixedValuesInstanceModal", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: makeFixedValues() },
    });
    await nextTick();
    // v2 modal owns the chip now (data-test="fvm-chip"), not the v1
    // .wp-medit__head shell.
    const chip = wrapper.find('[data-test="fvm-chip"]');
    expect(chip.exists()).toBe(true);
    expect(chip.text().toLowerCase()).toBe("fixed");
  });
});

// ── Task 25: tab strip + dispatcher ────────────────────────────────────────

describe("ModuleEditModal — tab strip + dispatcher (v1 kinds)", () => {
  beforeEach(() => _resetForTests());

  it("renders tab strip with both tabs for v1 kinds where INSTANCE_TAB_VISIBLE is true", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: makeConstraint() },
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
      ...mountOpts, props: { visible: true, module: m, siblingModules: [] },
    });
    await nextTick();
    expect(wrapper.find('[data-test="tab-instance"]').exists()).toBe(false);
  });

  it("smart default: opens Library tab when instance has no overrides", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: { ...makeConstraint(), instance: {} }, siblingModules: [] },
    });
    await nextTick();
    expect(wrapper.find('[data-test="tab-library"]').attributes("aria-selected")).toBe("true");
  });

  it("smart default: opens Instance tab when any registry field is non-null", async () => {
    const m = { ...makeConstraint(), instance: { disabled_exception_keys: ["e1"] } };
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts, props: { visible: true, module: m, siblingModules: [] },
    });
    await nextTick();
    expect(wrapper.find('[data-test="tab-instance"]').attributes("aria-selected")).toBe("true");
  });

  it("orange dot appears on Instance tab when modified-state is true", async () => {
    const m = { ...makeConstraint(), instance: { disabled_exception_keys: ["e1"] } };
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts, props: { visible: true, module: m, siblingModules: [] },
    });
    await nextTick();
    expect(wrapper.find('[data-test="tab-instance-dot"]').exists()).toBe(true);
  });

  it("modified-state ignores _ui namespace", async () => {
    const m = { ...makeConstraint(), instance: { _ui: { last_locked_seed: 42 } } };
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts, props: { visible: true, module: m, siblingModules: [] },
    });
    await nextTick();
    expect(wrapper.find('[data-test="tab-instance-dot"]').exists()).toBe(false);
  });

  it("Clear all overrides footer button exists on Instance tab", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: { ...makeConstraint(), instance: { disabled_exception_keys: ["e1"] } }, siblingModules: [] },
    });
    await nextTick();
    // Instance tab is the smart default for this module
    expect(wrapper.find('[data-test="clear-all-overrides"]').exists()).toBe(true);
  });

  it("Clear all sets all registry fields to null on confirm", async () => {
    const m = {
      ...makeConstraint(),
      instance: { disabled_exception_keys: ["e1"] },
    };
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts, props: { visible: true, module: m, siblingModules: [] },
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
    expect(saved.instance?.disabled_exception_keys).toBeNull();
  });

  it("Clear all does NOT clear when user cancels the confirm dialog", async () => {
    const m = {
      ...makeConstraint(),
      instance: { disabled_exception_keys: ["e1"] },
    };
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts, props: { visible: true, module: m, siblingModules: [] },
    });
    await nextTick();
    await wrapper.find('[data-test="clear-all-overrides"]').trigger("click");
    await nextTick();
    await wrapper.find('[data-test="confirm-cancel"]').trigger("click");
    await nextTick();
    await wrapper.find(".wp-medit__btn--primary").trigger("click");
    const saved = wrapper.emitted("save")?.[0][0] as ModuleEntry;
    // Cancelled → original override survives
    expect(saved.instance?.disabled_exception_keys).toEqual(["e1"]);
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

  it("renders v1 tab strip for kinds still on v1 (constraint)", async () => {
    // Derivation moved to v2 single-pane in 2026-05-09 cycle.
    // Constraint is the last v1 kind.
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: makeConstraint() },
    });
    await nextTick();
    expect(wrapper.findComponent({ name: "WildcardInstanceModal" }).exists()).toBe(false);
    expect(wrapper.findComponent({ name: "FixedValuesInstanceModal" }).exists()).toBe(false);
    expect(wrapper.findComponent({ name: "CombineInstanceModal" }).exists()).toBe(false);
    expect(wrapper.findComponent({ name: "DerivationInstanceModal" }).exists()).toBe(false);
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

// ── Fixed-values v2 dispatcher branch ───────────────────────────────────

describe("ModuleEditModal — fixed_values v2 dispatcher", () => {
  beforeEach(() => _resetForTests());

  it("renders FixedValuesInstanceModal (no tab strip) for fixed_values kind", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: makeFixedValues() },
    });
    await nextTick();
    expect(wrapper.findComponent({ name: "FixedValuesInstanceModal" }).exists()).toBe(true);
    expect(wrapper.find('[data-test="tab-library"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="tab-instance"]').exists()).toBe(false);
  });

  it("forwards FixedValuesInstanceModal update events into draft mutation", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: makeFixedValues() },
    });
    await nextTick();
    const fvm = wrapper.findComponent({ name: "FixedValuesInstanceModal" });
    // v2 ValuesSection always emits `entries` in sync with the
    // values_overrides shape, so save()'s reconciliation re-derives
    // the same patch. Mirror that here.
    fvm.vm.$emit("update", {
      instance: {
        values_overrides: [
          { id: "v1", name: "lens", value: "50mm" },
          { id: "v2", name: "angle", value: "wide" },
        ],
      },
      entries: [
        { variable_name: "lens", value: "50mm" },
        { variable_name: "angle", value: "wide" },
      ],
    });
    await nextTick();
    await wrapper.find('[data-test="fvm-save"]').trigger("click");
    const saved = wrapper.emitted("save")?.[0][0] as ModuleEntry;
    expect(saved.instance?.values_overrides?.[0].value).toBe("50mm");
  });

  it("v2 ValuesSection emit + save() round-trip writes payload.values for inline modules", async () => {
    const inline: ModuleEntry = {
      id: "inline01",
      type: "fixed_values",
      enabled: true,
      meta: { name: "scratch" },
      entries: [{ variable_name: "tag", value: "noir" }],
      payload: { values: [{ id: "x1", name: "tag", value: "noir" }] },
    };
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: inline },
    });
    await nextTick();
    const fvm = wrapper.findComponent({ name: "FixedValuesInstanceModal" });
    // Mirror ValuesSection's emit shape — entries kept in sync.
    fvm.vm.$emit("update", {
      instance: { values_overrides: null, enabled_options: null },
      entries: [{ variable_name: "tag", value: "vivid" }],
    });
    await nextTick();
    await wrapper.find('[data-test="fvm-save"]').trigger("click");
    const saved = wrapper.emitted("save")?.[0][0] as ModuleEntry;
    const vals = (saved.payload as { values: Array<{ name: string; value: string }> }).values;
    expect(vals[0].value).toBe("vivid");
  });
});

// ── Combine v2 dispatcher branch ────────────────────────────────────────

describe("ModuleEditModal — combine v2 dispatcher", () => {
  beforeEach(() => _resetForTests());

  it("renders CombineInstanceModal (no tab strip) for combine kind", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: makeCombine() },
    });
    await nextTick();
    expect(wrapper.findComponent({ name: "CombineInstanceModal" }).exists()).toBe(true);
    expect(wrapper.find('[data-test="tab-library"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="tab-instance"]').exists()).toBe(false);
  });

  it("forwards CombineInstanceModal update event into draft mutation", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: makeCombine() },
    });
    await nextTick();
    const cbm = wrapper.findComponent({ name: "CombineInstanceModal" });
    cbm.vm.$emit("update", { instance: { template_override: "Hello $world" } });
    await nextTick();
    await wrapper.find('[data-test="cbm-save"]').trigger("click");
    const saved = wrapper.emitted("save")?.[0][0] as ModuleEntry;
    expect(saved.instance?.template_override).toBe("Hello $world");
  });
});

// ── Derivation v2 dispatcher branch ────────────────────────────────────

describe("ModuleEditModal — derivation v2 dispatcher", () => {
  beforeEach(() => _resetForTests());

  it("renders DerivationInstanceModal (no tab strip) for derivation kind", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: makeDerivation() },
    });
    await nextTick();
    expect(wrapper.findComponent({ name: "DerivationInstanceModal" }).exists()).toBe(true);
    expect(wrapper.find('[data-test="tab-library"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="tab-instance"]').exists()).toBe(false);
  });

  it("forwards DerivationInstanceModal update event into draft mutation", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: makeDerivation() },
    });
    await nextTick();
    const dvm = wrapper.findComponent({ name: "DerivationInstanceModal" });
    dvm.vm.$emit("update", { instance: { disabled_rule_ids: ["r1"] } });
    await nextTick();
    await wrapper.find('[data-test="dvm-save"]').trigger("click");
    const saved = wrapper.emitted("save")?.[0][0] as ModuleEntry;
    expect(saved.instance?.disabled_rule_ids).toEqual(["r1"]);
  });
});

