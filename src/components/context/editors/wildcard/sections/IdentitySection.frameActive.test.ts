// R3: IdentitySection frame-active gating — wildcard variant.
// variable_binding is a structural field that is meaningless to change
// on a per-frame basis, so the binding input must be disabled when
// frameActive=true.

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import IdentitySection from "./IdentitySection.vue";
import type { ModuleEntry } from "../../../../../widgets/_shared";

function makeModule(overrides: Partial<ModuleEntry> = {}): ModuleEntry {
  return {
    id: "ab12cd34",
    type: "wildcard",
    enabled: true,
    meta: { name: "outfit" },
    entries: [],
    payload: { var_binding: "outfit", options: [] },
    instance: {},
    ...overrides,
  };
}

describe("wildcard IdentitySection — frameActive gating on variable binding", () => {
  it("binding input is NOT disabled in base mode (frameActive absent)", () => {
    const w = mount(IdentitySection, { props: { module: makeModule() } });
    const input = w.find('[data-test="id-binding"]');
    expect(input.attributes("disabled")).toBeUndefined();
  });

  it("binding input is NOT disabled when frameActive=false", () => {
    const w = mount(IdentitySection, { props: { module: makeModule(), frameActive: false } });
    const input = w.find('[data-test="id-binding"]');
    expect(input.attributes("disabled")).toBeUndefined();
  });

  it("binding input IS disabled when frameActive=true", () => {
    const w = mount(IdentitySection, { props: { module: makeModule(), frameActive: true } });
    const input = w.find('[data-test="id-binding"]');
    expect(input.attributes("disabled")).toBeDefined();
  });

  it("shows binding frame-active hint when frameActive=true", () => {
    const w = mount(IdentitySection, { props: { module: makeModule(), frameActive: true } });
    expect(w.find('[data-test="id-binding-frame-hint"]').exists()).toBe(true);
  });

  it("does NOT show binding frame-active hint when frameActive=false", () => {
    const w = mount(IdentitySection, { props: { module: makeModule(), frameActive: false } });
    expect(w.find('[data-test="id-binding-frame-hint"]').exists()).toBe(false);
  });
});
