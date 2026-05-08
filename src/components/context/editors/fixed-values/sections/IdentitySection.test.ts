import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import IdentitySection from "./IdentitySection.vue";
import type { ModuleEntry } from "../../../../../widgets/_shared";

function makeModule(overrides: Partial<ModuleEntry> = {}): ModuleEntry {
  return {
    id: "fv012345",
    type: "fixed_values",
    enabled: true,
    meta: { name: "presets", library_name: "presets" },
    entries: [],
    payload: { values: [] },
    instance: {},
    ...overrides,
  };
}

describe("fixed-values IdentitySection", () => {
  it("renders display name input bound to meta.name", () => {
    const w = mount(IdentitySection, { props: { module: makeModule() } });
    expect(w.find<HTMLInputElement>('[data-test="id-name"]').element.value).toBe("presets");
  });

  it("placeholder uses meta.library_name when name is empty", () => {
    const w = mount(IdentitySection, {
      props: { module: makeModule({ meta: { name: "", library_name: "presets" } }) },
    });
    expect(w.find<HTMLInputElement>('[data-test="id-name"]').element.placeholder).toBe("presets");
  });

  it("name input emits update with new meta.name", async () => {
    const w = mount(IdentitySection, { props: { module: makeModule() } });
    const input = w.find<HTMLInputElement>('[data-test="id-name"]');
    input.element.value = "portrait — soft";
    await input.trigger("input");
    const updates = w.emitted("update")!;
    const patch = updates[updates.length - 1][0] as Partial<ModuleEntry>;
    expect(patch.meta?.name).toBe("portrait — soft");
  });

  it("name input gets --mod class when value differs from library_name", () => {
    const w = mount(IdentitySection, {
      props: { module: makeModule({ meta: { name: "Custom", library_name: "presets" } }) },
    });
    expect(w.find('[data-test="id-name"]').classes()).toContain("id__input--mod");
  });

  it("name input does NOT get --mod class when value equals library_name", () => {
    const w = mount(IdentitySection, {
      props: { module: makeModule({ meta: { name: "presets", library_name: "presets" } }) },
    });
    expect(w.find('[data-test="id-name"]').classes()).not.toContain("id__input--mod");
  });

  it("reset button appears only when name is overridden", () => {
    const noOv = mount(IdentitySection, {
      props: { module: makeModule({ meta: { name: "presets", library_name: "presets" } }) },
    });
    expect(noOv.find('[data-test="id-name-reset"]').exists()).toBe(false);

    const ov = mount(IdentitySection, {
      props: { module: makeModule({ meta: { name: "Custom", library_name: "presets" } }) },
    });
    expect(ov.find('[data-test="id-name-reset"]').exists()).toBe(true);
  });

  it("reset button restores meta.name to library_name", async () => {
    const w = mount(IdentitySection, {
      props: { module: makeModule({ meta: { name: "Custom", library_name: "presets" } }) },
    });
    await w.find('[data-test="id-name-reset"]').trigger("click");
    const updates = w.emitted("update")!;
    const patch = updates[updates.length - 1][0] as Partial<ModuleEntry>;
    expect(patch.meta?.name).toBe("presets");
  });

  it("inline-mode (no library_name) hides the reset button entirely", () => {
    const w = mount(IdentitySection, {
      props: { module: makeModule({ meta: { name: "scratch" }, payload_hash: undefined }) },
    });
    expect(w.find('[data-test="id-name-reset"]').exists()).toBe(false);
  });
});
