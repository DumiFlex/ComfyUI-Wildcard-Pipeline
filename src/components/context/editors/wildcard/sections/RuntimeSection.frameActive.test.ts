// R3: RuntimeSection frame-active gating — wildcard variant.
// Hide from prompt + Hold across run are run-level controls that apply
// to every frame, so they must be disabled (not interactive) when the
// user is editing a per-frame override context. Tests assert:
//   - controls get `disabled` attribute when frameActive=true
//   - controls are NOT disabled when frameActive is absent/false
//   - a hint message is shown in frame-active mode

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import RuntimeSection from "./RuntimeSection.vue";
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

describe("wildcard RuntimeSection — frameActive gating", () => {
  it("hide toggle is NOT disabled in base mode (frameActive absent)", () => {
    const w = mount(RuntimeSection, { props: { module: makeModule() } });
    const btn = w.find('[data-test="runtime-hide"]');
    expect(btn.attributes("disabled")).toBeUndefined();
  });

  it("hold toggle is NOT disabled in base mode (frameActive absent)", () => {
    const w = mount(RuntimeSection, { props: { module: makeModule() } });
    const btn = w.find('[data-test="runtime-hold"]');
    expect(btn.attributes("disabled")).toBeUndefined();
  });

  it("hide toggle is NOT disabled when frameActive=false", () => {
    const w = mount(RuntimeSection, { props: { module: makeModule(), frameActive: false } });
    const btn = w.find('[data-test="runtime-hide"]');
    expect(btn.attributes("disabled")).toBeUndefined();
  });

  it("hold toggle is NOT disabled when frameActive=false", () => {
    const w = mount(RuntimeSection, { props: { module: makeModule(), frameActive: false } });
    const btn = w.find('[data-test="runtime-hold"]');
    expect(btn.attributes("disabled")).toBeUndefined();
  });

  it("hide toggle IS disabled when frameActive=true", () => {
    const w = mount(RuntimeSection, { props: { module: makeModule(), frameActive: true } });
    const btn = w.find('[data-test="runtime-hide"]');
    expect(btn.attributes("disabled")).toBeDefined();
  });

  it("hold toggle IS disabled when frameActive=true", () => {
    const w = mount(RuntimeSection, { props: { module: makeModule(), frameActive: true } });
    const btn = w.find('[data-test="runtime-hold"]');
    expect(btn.attributes("disabled")).toBeDefined();
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
