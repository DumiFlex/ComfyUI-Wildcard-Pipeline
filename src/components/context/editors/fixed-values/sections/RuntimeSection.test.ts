import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import RuntimeSection from "./RuntimeSection.vue";
import type { ModuleEntry } from "../../../../../widgets/_shared";

function makeModule(overrides: Partial<ModuleEntry> = {}): ModuleEntry {
  return {
    id: "fv012345",
    type: "fixed_values",
    enabled: true,
    meta: { name: "presets" },
    entries: [],
    payload: { values: [] },
    instance: {},
    ...overrides,
  };
}

describe("fixed-values RuntimeSection", () => {
  it("renders Hide-from-prompt toggle", () => {
    const w = mount(RuntimeSection, { props: { module: makeModule() } });
    expect(w.find('[data-test="runtime-hide"]').exists()).toBe(true);
  });

  it("toggle off → click → emits internal=true", async () => {
    const w = mount(RuntimeSection, { props: { module: makeModule() } });
    await w.find('[data-test="runtime-hide"]').trigger("click");
    const updates = w.emitted("update")!;
    const patch = updates[updates.length - 1][0] as Partial<ModuleEntry>;
    expect(patch.instance?.internal).toBe(true);
  });

  it("toggle on → click → emits internal=false", async () => {
    const w = mount(RuntimeSection, {
      props: { module: makeModule({ instance: { internal: true } }) },
    });
    await w.find('[data-test="runtime-hide"]').trigger("click");
    const updates = w.emitted("update")!;
    const patch = updates[updates.length - 1][0] as Partial<ModuleEntry>;
    expect(patch.instance?.internal).toBe(false);
  });

  it("toggle reflects internal=true with --on class + aria-checked", () => {
    const w = mount(RuntimeSection, {
      props: { module: makeModule({ instance: { internal: true } }) },
    });
    const btn = w.find('[data-test="runtime-hide"]');
    expect(btn.classes()).toContain("toggle--on");
    expect(btn.attributes("aria-checked")).toBe("true");
  });
});
