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

  // v1 .wp-medit shell tests removed in 2026-05-10 cycle — every kind
  // (wildcard / fixed_values / combine / derivation / constraint) now
  // routes to its own v2 single-pane modal. Per-modal header coverage
  // lives in each kind's *.InstanceModal.test.ts.

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


  // ─ "constraint → ConstraintEditorBody" test removed.
  // Constraint migrated to v2 single-pane modal in 2026-05-10 cycle.
  // See: src/components/context/editors/constraint/ConstraintInstanceModal.test.ts
  // for header / sections / footer / drift kebab coverage.

  it("constraint → routes to v2 ConstraintInstanceModal (no v1 .wp-medit shell)", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: makeConstraint() },
    });
    await nextTick();
    expect(wrapper.find(".cnm").exists()).toBe(true);
    expect(wrapper.find(".wp-medit").exists()).toBe(false);
  });
});

describe("ModuleEditModal — footer / save / cancel", () => {
  beforeEach(() => _resetForTests());

  // v1 .wp-medit shell footer tests removed in 2026-05-10 cycle.
  // Per-kind modal Save/Cancel coverage lives in each kind's
  // *.InstanceModal.test.ts (data-test="<prefix>-save" / "cancel").
  // Ctrl+Enter shortcut still wired in the shell-level keydown
  // handler — covered indirectly by per-kind save event tests.

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

// ─ "ModuleEditModal — constraint editor body" describe block removed.
// Constraint migrated to v2 single-pane modal in 2026-05-10 cycle. New
// per-section coverage lives in:
//   src/components/context/editors/constraint/sections/IdentitySection.test.ts
//   src/components/context/editors/constraint/sections/MatrixSection.test.ts
//   src/components/context/editors/constraint/sections/ExceptionsSection.test.ts
//   src/components/context/editors/constraint/CellRulePopover.test.ts
//   src/components/context/editors/constraint/MatrixLegend.test.ts
//   src/components/context/editors/constraint/ConstraintInstanceModal.test.ts
// Library-level matrix authoring (source/target picker, cell mode/factor
// authoring, exceptions add/remove) stays in SPA — modal exposes only
// per-cell + per-exception runtime overrides + extras.

// ── V2 + V3: two-line modal header (mockup v5 lines 1039-1040, 1180, 1260, 1317, 1436) ─

// V2 two-line header + V3 kind chip v1-shell tests removed in
// 2026-05-10 cycle — every kind now has its own v2 modal with header
// / sub / chip wired internally. Per-modal coverage lives in each
// kind's *.InstanceModal.test.ts.

describe("ModuleEditModal — V3 kind chip in header", () => {
  beforeEach(() => _resetForTests());

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

// Tab strip + dispatcher (v1 kinds) tests removed in 2026-05-10
// cycle — every kind now routes to its v2 single-pane modal which
// has no tab strip. Modified-state + clear-all-overrides behaviors
// covered per-kind in *.InstanceModal.test.ts; cross-kind Reset
// behavior covered by the "Reset preserves Identity + Runtime"
// describe block below.


describe("ModuleEditModal — Reset preserves Identity + Runtime across all v2 kinds", () => {
  beforeEach(() => _resetForTests());

  async function clearOverridesViaModal(wrapper: ReturnType<typeof mount>): Promise<void> {
    await wrapper.find('[data-test="clear-all-overrides"], [data-test="wcm-clear-all"], [data-test="cbm-clear-all"], [data-test="fvm-clear-all"], [data-test="dvm-clear-all"]').trigger("click");
    await nextTick();
    const confirmBtn = wrapper.find('[data-test="confirm-confirm"]');
    if (confirmBtn.exists()) await confirmBtn.trigger("click");
    await nextTick();
  }

  it("combine Reset clears template_override but preserves locked_seed + internal", async () => {
    const m: ModuleEntry = {
      ...makeCombine(),
      instance: {
        template_override: "$x",
        locked_seed: 4242,
        internal: true,
      },
    };
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: m, siblingModules: [] },
    });
    await nextTick();
    await clearOverridesViaModal(wrapper);
    await wrapper.find('[data-test="cbm-save"]').trigger("click");
    const saved = wrapper.emitted("save")?.[0][0] as ModuleEntry;
    expect(saved.instance?.template_override).toBeNull();
    // Runtime preserved
    expect(saved.instance?.locked_seed).toBe(4242);
    expect(saved.instance?.internal).toBe(true);
  });

  it("fixed_values Reset clears values_overrides but preserves locked_seed + internal", async () => {
    const m: ModuleEntry = {
      ...makeFixedValues(),
      instance: {
        values_overrides: [{ id: "v1", name: "lens", value: "50mm" }],
        locked_seed: 99,
        internal: true,
      },
    };
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: m, siblingModules: [] },
    });
    await nextTick();
    await clearOverridesViaModal(wrapper);
    await wrapper.find('[data-test="fvm-save"]').trigger("click");
    const saved = wrapper.emitted("save")?.[0][0] as ModuleEntry;
    // fixed_values save reconciliation deletes the override key entirely
    // when it matches library — null OR undefined both mean "no override".
    expect(saved.instance?.values_overrides ?? null).toBeNull();
    expect(saved.instance?.locked_seed).toBe(99);
    expect(saved.instance?.internal).toBe(true);
  });

  it("derivation Reset clears rule-group fields but preserves locked_seed + internal", async () => {
    const m: ModuleEntry = {
      ...makeDerivation(),
      instance: {
        disabled_rule_ids: ["r1"],
        disabled_branch_keys: ["r1:1"],
        action_value_overrides: { r1: { "0": "fiery" } },
        condition_value_overrides: { r1: { "0": "purple" } },
        rule_order_override: ["r2", "r1"],
        locked_seed: 4242,
        internal: true,
      },
    };
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: m, siblingModules: [] },
    });
    await nextTick();
    await clearOverridesViaModal(wrapper);
    await wrapper.find('[data-test="dvm-save"]').trigger("click");
    const saved = wrapper.emitted("save")?.[0][0] as ModuleEntry;
    // Rule-group cleared
    expect(saved.instance?.disabled_rule_ids).toBeNull();
    expect(saved.instance?.disabled_branch_keys).toBeNull();
    expect(saved.instance?.action_value_overrides).toBeNull();
    expect(saved.instance?.condition_value_overrides).toBeNull();
    expect(saved.instance?.rule_order_override).toBeNull();
    // Runtime preserved
    expect(saved.instance?.locked_seed).toBe(4242);
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

  // ─ "renders v1 tab strip for kinds still on v1 (constraint)" test removed.
  // Constraint migrated to v2 single-pane modal in 2026-05-10 cycle.
  // Cross-kind v2 routing now covered by per-kind dispatcher describe
  // blocks below.

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

// ── Constraint v2 dispatcher branch ────────────────────────────────────

describe("ModuleEditModal — constraint v2 dispatcher", () => {
  beforeEach(() => _resetForTests());

  it("renders ConstraintInstanceModal (no tab strip) for constraint kind", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: makeConstraint() },
    });
    await nextTick();
    expect(wrapper.findComponent({ name: "ConstraintInstanceModal" }).exists()).toBe(true);
    expect(wrapper.find('[data-test="tab-library"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="tab-instance"]').exists()).toBe(false);
  });

  it("forwards ConstraintInstanceModal update event into draft mutation", async () => {
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: makeConstraint() },
    });
    await nextTick();
    const cnm = wrapper.findComponent({ name: "ConstraintInstanceModal" });
    cnm.vm.$emit("update", {
      instance: { cell_mode_overrides: { '["a","b"]': "exclude" } },
    });
    await nextTick();
    await wrapper.find('[data-test="cnm-save"]').trigger("click");
    const saved = wrapper.emitted("save")?.[0][0] as ModuleEntry;
    expect(saved.instance?.cell_mode_overrides).toEqual({ '["a","b"]': "exclude" });
  });

  it("Reset overrides clears all override fields, preserves Identity", async () => {
    const m = {
      ...makeConstraint(),
      meta: { ...makeConstraint().meta, name: "color-rules" },
      instance: {
        disabled_matrix_cells: ['["a","b"]'],
        cell_mode_overrides: { '["a","b"]': "exclude" as const },
        cell_factor_overrides: { '["a","b"]': 5 },
        exception_mode_overrides: { '["x","y"]': "boost" as const },
        extra_exceptions: [{ source_value: "p", target_value: "q", mode: "allow" as const, factor: 1 }],
      },
    };
    const wrapper = mount(ModuleEditModal, {
      ...mountOpts,
      props: { visible: true, module: m, siblingModules: [] },
    });
    await nextTick();
    await wrapper.find('[data-test="cnm-clear-all"]').trigger("click");
    await nextTick();
    const confirmBtn = wrapper.find('[data-test="confirm-confirm"]');
    if (confirmBtn.exists()) await confirmBtn.trigger("click");
    await nextTick();
    await wrapper.find('[data-test="cnm-save"]').trigger("click");
    const saved = wrapper.emitted("save")?.[0][0] as ModuleEntry;
    // All override fields cleared
    expect(saved.instance?.disabled_matrix_cells).toBeNull();
    expect(saved.instance?.cell_mode_overrides).toBeNull();
    expect(saved.instance?.cell_factor_overrides).toBeNull();
    expect(saved.instance?.exception_mode_overrides).toBeNull();
    expect(saved.instance?.extra_exceptions).toBeNull();
    // Identity preserved
    expect(saved.meta?.name).toBe("color-rules");
  });
});

