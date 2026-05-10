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
});
