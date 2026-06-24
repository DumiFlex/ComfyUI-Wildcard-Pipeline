// R3: RuntimeSection frame-active gating — derivation variant.
// Derivation RuntimeSection only has runtime-hide (no runtime-hold),
// so only the Hide from prompt toggle needs disabling.

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import RuntimeSection from "./RuntimeSection.vue";
import type { ModuleEntry } from "../../../../../widgets/_shared";

function makeModule(overrides: Partial<ModuleEntry> = {}): ModuleEntry {
  return {
    id: "dv012345",
    type: "derivation",
    enabled: true,
    meta: { name: "mood-rules" },
    entries: [],
    payload: { rules: [] },
    instance: {},
    ...overrides,
  };
}

describe("derivation RuntimeSection — frameActive gating", () => {
  it("hide toggle is NOT disabled in base mode (frameActive absent)", () => {
    const w = mount(RuntimeSection, { props: { module: makeModule() } });
    expect(w.find('[data-test="runtime-hide"]').attributes("disabled")).toBeUndefined();
  });

  it("hide toggle is NOT disabled when frameActive=false", () => {
    const w = mount(RuntimeSection, { props: { module: makeModule(), frameActive: false } });
    expect(w.find('[data-test="runtime-hide"]').attributes("disabled")).toBeUndefined();
  });

  it("hide toggle IS disabled when frameActive=true", () => {
    const w = mount(RuntimeSection, { props: { module: makeModule(), frameActive: true } });
    expect(w.find('[data-test="runtime-hide"]').attributes("disabled")).toBeDefined();
  });

  it("shows frame-active hint when frameActive=true", () => {
    const w = mount(RuntimeSection, { props: { module: makeModule(), frameActive: true } });
    expect(w.find('[data-test="runtime-frame-hint"]').exists()).toBe(true);
  });

  it("does NOT show frame-active hint when frameActive=false", () => {
    const w = mount(RuntimeSection, { props: { module: makeModule(), frameActive: false } });
    expect(w.find('[data-test="runtime-frame-hint"]').exists()).toBe(false);
  });
});
