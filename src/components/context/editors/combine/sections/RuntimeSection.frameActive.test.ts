// R3: RuntimeSection frame-active gating — combine variant.

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import RuntimeSection from "./RuntimeSection.vue";
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

describe("combine RuntimeSection — frameActive gating", () => {
  it("hide toggle is NOT disabled in base mode (frameActive absent)", () => {
    const w = mount(RuntimeSection, { props: { module: makeModule() } });
    expect(w.find('[data-test="runtime-hide"]').attributes("disabled")).toBeUndefined();
  });

  it("hold toggle is NOT disabled in base mode (frameActive absent)", () => {
    const w = mount(RuntimeSection, { props: { module: makeModule() } });
    expect(w.find('[data-test="runtime-hold"]').attributes("disabled")).toBeUndefined();
  });

  it("hide toggle IS disabled when frameActive=true", () => {
    const w = mount(RuntimeSection, { props: { module: makeModule(), frameActive: true } });
    expect(w.find('[data-test="runtime-hide"]').attributes("disabled")).toBeDefined();
  });

  it("hold toggle IS disabled when frameActive=true", () => {
    const w = mount(RuntimeSection, { props: { module: makeModule(), frameActive: true } });
    expect(w.find('[data-test="runtime-hold"]').attributes("disabled")).toBeDefined();
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
