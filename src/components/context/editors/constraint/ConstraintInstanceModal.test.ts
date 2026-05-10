// ConstraintInstanceModal — single-pane v2 shell. Mirrors derivation /
// combine / fixed_values shell pattern. Header: pi-link icon
// (matches kind picker for constraint), name + chip + subtitle +
// close. Sections in order: Identity → Matrix → Exceptions. NO
// Runtime section — constraint produces no $vars + engine doesn't
// honor `locked_seed`.

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import ConstraintInstanceModal from "./ConstraintInstanceModal.vue";
import type { ModuleEntry } from "../../../../widgets/_shared";

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
    expect(w.find(".cnm__head-icon.pi.pi-link").exists()).toBe(true);
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

  it("kebab hidden when not drifted, visible when drifted", () => {
    const off = mount(ConstraintInstanceModal, {
      props: { module: makeModule(), isDrifted: false },
    });
    expect(off.find('[data-test="cnm-kebab"]').exists()).toBe(false);
    const on = mount(ConstraintInstanceModal, {
      props: { module: makeModule(), isDrifted: true },
    });
    expect(on.find('[data-test="cnm-kebab"]').exists()).toBe(true);
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
});
