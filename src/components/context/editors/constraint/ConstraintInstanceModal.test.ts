// ConstraintInstanceModal — single-pane v2 shell. Mirrors derivation /
// combine / fixed_values shell pattern. Header: pi-link icon
// (matches kind picker for constraint), name + chip + subtitle +
// close. Sections in order: Identity → Matrix → Exceptions. NO
// Runtime section — constraint produces no $vars + engine doesn't
// honor `locked_seed`.

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import ConstraintInstanceModal from "./ConstraintInstanceModal.vue";
import TargetReachSection from "./sections/TargetReachSection.vue";
import type { ModuleEntry, TargetSelect } from "../../../../widgets/_shared";

function makeModule(overrides: Partial<ModuleEntry> = {}): ModuleEntry {
  return {
    id: "cn012345",
    type: "constraint",
    enabled: true,
    meta: { name: "color-fabric" },
    entries: [],
    payload: {
      source_wildcard_id: "wc_color",
      target_wildcard_id: "wc_fabric",
      matrix: { red: { cotton: { mode: "allow", factor: 1.0 } } },
      exceptions: [],
    },
    instance: {},
    payload_hash: "h",
    ...overrides,
  };
}

describe("ConstraintInstanceModal", () => {
  it("renders pi-link icon in header", () => {
    const w = mount(ConstraintInstanceModal, { props: { module: makeModule() } });
    expect(w.find(".wp-cnm__head-icon.pi.pi-link").exists()).toBe(true);
  });

  it("renders 'constraint' chip + module name", () => {
    const w = mount(ConstraintInstanceModal, { props: { module: makeModule() } });
    expect(w.find('[data-test="cnm-name"]').text()).toBe("color-fabric");
    expect(w.find('[data-test="cnm-chip"]').text().toLowerCase()).toBe("constraint");
  });

  it("renders Identity + Matrix + Exceptions sections", () => {
    const w = mount(ConstraintInstanceModal, { props: { module: makeModule() } });
    expect(w.findComponent({ name: "IdentitySection" }).exists()).toBe(true);
    expect(w.findComponent({ name: "MatrixSection" }).exists()).toBe(true);
    expect(w.findComponent({ name: "ExceptionsSection" }).exists()).toBe(true);
  });

  it("does NOT render a RuntimeSection (no Lock seed / Hide for constraint)", () => {
    const w = mount(ConstraintInstanceModal, { props: { module: makeModule() } });
    expect(w.findComponent({ name: "RuntimeSection" }).exists()).toBe(false);
  });

  it("forwards section update events upward", async () => {
    const w = mount(ConstraintInstanceModal, { props: { module: makeModule() } });
    const matrix = w.findComponent({ name: "MatrixSection" });
    matrix.vm.$emit("update", { instance: { cell_mode_overrides: { '["red","cotton"]': "exclude" } } });
    await w.vm.$nextTick();
    const updates = w.emitted("update")!;
    expect((updates[0][0] as Partial<ModuleEntry>).instance?.cell_mode_overrides).toEqual({
      '["red","cotton"]': "exclude",
    });
  });

  it("SPA link points at /wp/constraints/<id>/edit", () => {
    const w = mount(ConstraintInstanceModal, { props: { module: makeModule() } });
    const link = w.find<HTMLAnchorElement>('[data-test="cnm-spa-link"]').element;
    expect(link.getAttribute("href")).toBe("/wp/constraints/cn012345/edit");
  });

  it("Save + Cancel emit correct events", async () => {
    const w = mount(ConstraintInstanceModal, { props: { module: makeModule() } });
    await w.find('[data-test="cnm-save"]').trigger("click");
    expect(w.emitted("save")).toBeTruthy();
    await w.find('[data-test="cnm-cancel"]').trigger("click");
    expect(w.emitted("cancel")).toBeTruthy();
  });

  // PushToLibraryModal owns the explicit fork-vs-update choice now;
  // see WildcardInstanceModal.test.ts for the migration commentary.
  it("Save to library visible when payload exists, regardless of isModified", () => {
    const w = mount(ConstraintInstanceModal, {
      props: { module: makeModule(), isDrifted: false, isModified: false },
    });
    expect(w.find('[data-test="cnm-save-lib"]').exists()).toBe(true);
  });

  it("Save to library still visible when library-tracked + modified", () => {
    const w = mount(ConstraintInstanceModal, {
      props: { module: makeModule(), isDrifted: false, isModified: true },
    });
    expect(w.find('[data-test="cnm-save-lib"]').exists()).toBe(true);
  });

  it("Save to library visible for inline-created (no payload_hash)", () => {
    const w = mount(ConstraintInstanceModal, {
      props: { module: makeModule({ payload_hash: undefined }), isModified: true },
    });
    expect(w.find('[data-test="cnm-save-lib"]').exists()).toBe(true);
  });

  it("Reset overrides emits clear-all-overrides", async () => {
    const w = mount(ConstraintInstanceModal, { props: { module: makeModule() } });
    await w.find('[data-test="cnm-clear-all"]').trigger("click");
    expect(w.emitted("clear-all-overrides")).toBeTruthy();
  });

  // ── Axis fallback when sibling wildcards aren't in this Context ──
  // Library-defining matrix data is meaningful for editing even when
  // the source/target wildcards live in a different Context. Modal
  // must derive axes from existing payload matrix keys so the grid
  // renders all saved cells. Same pattern for exception autocomplete.

  it("renders matrix axes from payload keys when source wildcard not in siblings", () => {
    const m = makeModule({
      payload: {
        source_wildcard_id: "wc_color",
        target_wildcard_id: "wc_fabric",
        matrix: {
          red: { cotton: { mode: "allow", factor: 1 }, silk: { mode: "boost", factor: 2 } },
          blue: { cotton: { mode: "allow", factor: 1 } },
        },
        exceptions: [],
      },
    });
    // No sibling wildcards passed — modal must fall back to matrix keys.
    const w = mount(ConstraintInstanceModal, { props: { module: m, siblingModules: [] } });
    const matrixSection = w.findComponent({ name: "MatrixSection" });
    expect(matrixSection.props("sourceSubs")).toEqual(["red", "blue"]);
    expect(matrixSection.props("targetSubs").sort()).toEqual(["cotton", "silk"]);
  });

  it("prefers live wildcard sub_categories over matrix keys when sibling present", () => {
    const m = makeModule({
      payload: {
        source_wildcard_id: "wc_color",
        target_wildcard_id: "wc_fabric",
        matrix: {
          red: { cotton: { mode: "allow", factor: 1 } },
        },
        exceptions: [],
      },
    });
    const sourceWildcard: ModuleEntry = {
      id: "wc_color",
      type: "wildcard",
      enabled: true,
      meta: { name: "color" },
      entries: [],
      payload: { sub_categories: ["red", "blue", "silver"], options: [] },
    };
    const w = mount(ConstraintInstanceModal, {
      props: { module: m, siblingModules: [sourceWildcard] },
    });
    const matrixSection = w.findComponent({ name: "MatrixSection" });
    // Live subs include subcats not yet in matrix; modal surfaces them.
    expect(matrixSection.props("sourceSubs")).toEqual(["red", "blue", "silver"]);
  });

  it("falls back to exception values for autocomplete when wildcards absent", () => {
    const m = makeModule({
      payload: {
        source_wildcard_id: "wc_color",
        target_wildcard_id: "wc_fabric",
        matrix: {},
        exceptions: [
          { source_value: "red", target_value: "black", mode: "exclude", factor: 1 },
          { source_value: "blue", target_value: "green", mode: "boost", factor: 2 },
        ],
      },
    });
    const w = mount(ConstraintInstanceModal, { props: { module: m, siblingModules: [] } });
    const exSection = w.findComponent({ name: "ExceptionsSection" });
    expect(exSection.props("sourceValues").sort()).toEqual(["blue", "red"]);
    expect(exSection.props("targetValues").sort()).toEqual(["black", "green"]);
  });

  it("library cache fills sub_categories / option list when source wildcard is cross-Context", async () => {
    // User-reported regression: modal axis label rendered "SOURCE · source"
    // (the fallback role label) and matrix axes inherited stale keys from
    // the saved matrix when the referenced wildcard lived in another
    // WP_Context. Pulling the wildcard's name + sub_categories + option
    // list from the preview-resolver cache fills the gap.
    const { _resetForTests, _setForTests } = await import(
      "../../../../extension/preview-resolver"
    );
    _resetForTests();
    _setForTests("wc_color", {
      name: "color_library",
      varBinding: "color",
      subCategories: ["warm", "cool"],
      optionValues: ["red", "azure", "ivory"],
      optionsById: new Map([
        ["opt_0", "red"],
        ["opt_1", "azure"],
      ]),
      hasNullOption: false,
    });
    _setForTests("wc_fabric", {
      name: "fabric_library",
      varBinding: "fabric",
      subCategories: ["soft", "stiff"],
      optionValues: ["silk", "denim"],
      hasNullOption: true,
    });
    const m = makeModule({
      payload: {
        source_wildcard_id: "wc_color",
        target_wildcard_id: "wc_fabric",
        // Saved matrix carries a STALE key that's no longer in the live
        // wildcard's sub_categories — must be filtered out.
        matrix: { warm: { soft: { mode: "allow", factor: 1 } }, deleted: {} },
        exceptions: [],
      },
    });
    const w = mount(ConstraintInstanceModal, { props: { module: m, siblingModules: [] } });
    const matrix = w.findComponent({ name: "MatrixSection" });
    // Axis labels come from the cache (varBinding wins, then name).
    expect(matrix.props("sourceName")).toBe("color");
    expect(matrix.props("targetName")).toBe("fabric");
    // Live sub_categories from cache override stale saved-matrix keys.
    expect(matrix.props("sourceSubs")).toEqual(["warm", "cool"]);
    expect(matrix.props("targetSubs")).toEqual(["soft", "stiff"]);
    const exSection = w.findComponent({ name: "ExceptionsSection" });
    expect(exSection.props("sourceValues")).toEqual(["red", "azure", "ivory"]);
    expect(exSection.props("targetValues")).toEqual(["silk", "denim"]);
    expect(exSection.props("targetHasNull")).toBe(true);
    expect(exSection.props("sourceOptionsById").get("opt_0")).toBe("red");
    _resetForTests();
  });

  it("siblings still win over the library cache (live edits beat snapshots)", async () => {
    const { _resetForTests, _setForTests } = await import(
      "../../../../extension/preview-resolver"
    );
    _resetForTests();
    _setForTests("wc_color", {
      name: "stale_name",
      subCategories: ["stale_warm"],
    });
    const sibling: ModuleEntry = {
      id: "wc_color",
      type: "wildcard",
      enabled: true,
      meta: { name: "live_name" },
      entries: [],
      payload: {
        var_binding: "color",
        sub_categories: ["live_warm", "live_cool"],
        options: [{ id: "o1", value: "red", weight: 1 }],
      },
    };
    const m = makeModule({
      payload: {
        source_wildcard_id: "wc_color",
        target_wildcard_id: "wc_fabric",
        matrix: {},
        exceptions: [],
      },
    });
    const w = mount(ConstraintInstanceModal, {
      props: { module: m, siblingModules: [sibling] },
    });
    const matrix = w.findComponent({ name: "MatrixSection" });
    expect(matrix.props("sourceName")).toBe("live_name");
    expect(matrix.props("sourceSubs")).toEqual(["live_warm", "live_cool"]);
    _resetForTests();
  });

  // ── Cross-node chain resolution (SP3 P6 T16) ──
  // The target wildcard lives in a DOWNSTREAM Context node, so it is
  // absent from `siblingModules` (same-node only). The mount layer
  // threads the flattened cross-node chain as `chainModules`; the modal
  // must resolve the target's name + subcats + option values from it
  // instead of degrading to raw-uuid / matrix-key fallbacks.
  it("resolves target wildcard from chainModules when it lives in a downstream node", () => {
    const m = makeModule({
      payload: {
        source_wildcard_id: "wc_color",
        target_wildcard_id: "wc_fabric",
        // Deliberately empty matrix so any axis output MUST come from the
        // live wildcard (via chainModules), not from saved-matrix keys.
        matrix: {},
        exceptions: [],
      },
    });
    // Same-node siblings hold only the source; the target is cross-node.
    const sourceSibling: ModuleEntry = {
      id: "wc_color",
      type: "wildcard",
      enabled: true,
      meta: { name: "color" },
      entries: [],
      payload: { sub_categories: ["red", "blue"], options: [{ id: "o1", value: "red" }] },
    };
    // Cross-node chain entry for the target — shape is ChainModule
    // (`displayName` not `meta.name`, `rowKey` graph-unique).
    const targetChain = {
      id: "wc_fabric",
      rowKey: "99#wc_fabric",
      type: "wildcard",
      displayName: "fabric",
      payload: {
        var_binding: "fabric",
        sub_categories: ["cotton", "silk"],
        options: [
          { id: "f0", value: "denim" },
          { id: "f1", value: "linen" },
        ],
      },
    };
    const w = mount(ConstraintInstanceModal, {
      props: {
        module: m,
        siblingModules: [sourceSibling],
        chainModules: [targetChain],
      },
    });
    const matrix = w.findComponent({ name: "MatrixSection" });
    // Target name resolves from the chain entry (var_binding > displayName).
    expect(matrix.props("targetName")).toBe("fabric");
    // Target subcats come from the cross-node wildcard, not matrix keys.
    expect(matrix.props("targetSubs")).toEqual(["cotton", "silk"]);
    // Source still resolves from the same-node sibling.
    expect(matrix.props("sourceName")).toBe("color");
    expect(matrix.props("sourceSubs")).toEqual(["red", "blue"]);
    const exSection = w.findComponent({ name: "ExceptionsSection" });
    // Target option values flow from the chain entry into autocomplete.
    expect(exSection.props("targetValues")).toEqual(["denim", "linen"]);
  });

  it("chainModules wins over siblingModules for the same uuid (chain is the superset)", () => {
    const m = makeModule({
      payload: {
        source_wildcard_id: "wc_color",
        target_wildcard_id: "wc_fabric",
        matrix: {},
        exceptions: [],
      },
    });
    // Same uuid present in BOTH: chain entry must win so the merge is
    // safe for the current node (which appears inside the chain too).
    const sourceSibling: ModuleEntry = {
      id: "wc_color",
      type: "wildcard",
      enabled: true,
      meta: { name: "sibling_color" },
      entries: [],
      payload: { sub_categories: ["sib_red"], options: [] },
    };
    const sourceChain = {
      id: "wc_color",
      rowKey: "7#wc_color",
      type: "wildcard",
      displayName: "chain_color",
      payload: { sub_categories: ["chain_red", "chain_blue"], options: [] },
    };
    const w = mount(ConstraintInstanceModal, {
      props: {
        module: m,
        siblingModules: [sourceSibling],
        chainModules: [sourceChain],
      },
    });
    const matrix = w.findComponent({ name: "MatrixSection" });
    expect(matrix.props("sourceName")).toBe("chain_color");
    expect(matrix.props("sourceSubs")).toEqual(["chain_red", "chain_blue"]);
  });
});

describe("ConstraintInstanceModal — target reach instance override", () => {
  // The modal collapses a reach choice to `null` ("inherit library") ONLY
  // when it equals the EFFECTIVE library default — so a real per-instance
  // override (including an explicit `all` over a non-all library default)
  // is preserved and reaches the engine's `instance ?? payload ?? all`.

  function emitReach(w: ReturnType<typeof mount>, next: TargetSelect) {
    return w.findComponent(TargetReachSection).vm.$emit("update:modelValue", next);
  }

  function lastReach(w: ReturnType<typeof mount>): TargetSelect | null | undefined {
    const updates = w.emitted("update") as Array<[Partial<ModuleEntry>]> | undefined;
    if (!updates?.length) return undefined;
    return updates[updates.length - 1][0].instance?.target_select;
  }

  function moduleWithLibraryReach(reach?: TargetSelect): ModuleEntry {
    const m = makeModule();
    if (reach) (m.payload as Record<string, unknown>).target_select = reach;
    return m;
  }

  it("collapses 'all' to null when the library default is already all (inherit)", async () => {
    const w = mount(ConstraintInstanceModal, { props: { module: moduleWithLibraryReach() } });
    emitReach(w, { mode: "all" });
    await w.vm.$nextTick();
    expect(lastReach(w)).toBeNull();
  });

  it("stores an explicit 'all' override when the library default is non-all (first)", async () => {
    // Regression guard: the old `mode === "all"` collapse dropped this to
    // null, so the engine fell back to the library `first` and the user's
    // widen-to-all was silently ignored.
    const w = mount(ConstraintInstanceModal, {
      props: { module: moduleWithLibraryReach({ mode: "first" }) },
    });
    emitReach(w, { mode: "all" });
    await w.vm.$nextTick();
    expect(lastReach(w)).toEqual({ mode: "all" });
  });

  it("collapses to null when the choice equals a non-all library default (first == first)", async () => {
    const w = mount(ConstraintInstanceModal, {
      props: { module: moduleWithLibraryReach({ mode: "first" }) },
    });
    emitReach(w, { mode: "first" });
    await w.vm.$nextTick();
    expect(lastReach(w)).toBeNull();
  });

  it("stores a non-default reach (next N) as an explicit override", async () => {
    const w = mount(ConstraintInstanceModal, { props: { module: moduleWithLibraryReach() } });
    emitReach(w, { mode: "next", count: 2 });
    await w.vm.$nextTick();
    expect(lastReach(w)).toEqual({ mode: "next", count: 2 });
  });
});
