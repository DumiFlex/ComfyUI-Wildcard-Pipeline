// R3: IdentitySection frame-active gating — combine variant.

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import IdentitySection from "./IdentitySection.vue";
import type { ModuleEntry } from "../../../../../widgets/_shared";

function makeModule(overrides: Partial<ModuleEntry> = {}): ModuleEntry {
  return {
    id: "cb12cd34",
    type: "combine",
    enabled: true,
    meta: { name: "final_prompt" },
    entries: [],
    payload: { output_var: "final_prompt", template: "$style portrait" },
    instance: {},
    ...overrides,
  };
}

describe("combine IdentitySection — frameActive gating on variable binding", () => {
  it("binding input is NOT disabled in base mode (frameActive absent)", () => {
    const w = mount(IdentitySection, { props: { module: makeModule() } });
    expect(w.find('[data-test="id-binding"]').attributes("disabled")).toBeUndefined();
  });

  it("binding input is NOT disabled when frameActive=false", () => {
    const w = mount(IdentitySection, { props: { module: makeModule(), frameActive: false } });
    expect(w.find('[data-test="id-binding"]').attributes("disabled")).toBeUndefined();
  });

  it("binding input IS disabled when frameActive=true", () => {
    const w = mount(IdentitySection, { props: { module: makeModule(), frameActive: true } });
    expect(w.find('[data-test="id-binding"]').attributes("disabled")).toBeDefined();
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
