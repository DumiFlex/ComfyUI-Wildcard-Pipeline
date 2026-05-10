// Constraint IdentitySection — display name only. Constraint produces
// no $vars (returns empty bindings dict from resolve), so there's no
// variable-binding row like wildcard / combine have. Library-defining
// edits (matrix shape, source/target wildcard pair) live in SPA.

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import IdentitySection from "./IdentitySection.vue";
import type { ModuleEntry } from "../../../../../widgets/_shared";

function makeModule(overrides: Partial<ModuleEntry> = {}): ModuleEntry {
  return {
    id: "cn012345",
    type: "constraint",
    enabled: true,
    meta: { name: "color-fabric-rules" },
    entries: [],
    payload: {
      source_wildcard_id: "wc_color",
      target_wildcard_id: "wc_fabric",
      matrix: {},
      exceptions: [],
    },
    instance: {},
    ...overrides,
  };
}

describe("constraint IdentitySection", () => {
  it("renders name input bound to module.meta.name", () => {
    const w = mount(IdentitySection, { props: { module: makeModule() } });
    expect(w.find<HTMLInputElement>('[data-test="id-name"]').element.value).toBe("color-fabric-rules");
  });

  it("emits update with new meta.name on input", async () => {
    const w = mount(IdentitySection, { props: { module: makeModule() } });
    const input = w.find<HTMLInputElement>('[data-test="id-name"]');
    input.element.value = "Custom rules";
    await input.trigger("input");
    const updates = w.emitted("update")!;
    const patch = updates[updates.length - 1][0] as Partial<ModuleEntry>;
    expect(patch.meta?.name).toBe("Custom rules");
  });

  it("name input gets mod class when value differs from library_name", () => {
    const w = mount(IdentitySection, {
      props: { module: makeModule({ meta: { name: "Custom", library_name: "color-fabric-rules" } }) },
    });
    expect(w.find('[data-test="id-name"]').classes()).toContain("id__input--mod");
  });

  it("name reset button restores meta.name to library_name", async () => {
    const w = mount(IdentitySection, {
      props: { module: makeModule({ meta: { name: "Custom", library_name: "color-fabric-rules" } }) },
    });
    await w.find('[data-test="id-name-reset"]').trigger("click");
    const updates = w.emitted("update")!;
    const patch = updates[updates.length - 1][0] as Partial<ModuleEntry>;
    expect(patch.meta?.name).toBe("color-fabric-rules");
  });

  it("does NOT render a variable-binding row (constraint produces no $vars)", () => {
    const w = mount(IdentitySection, { props: { module: makeModule() } });
    expect(w.find('[data-test="id-binding"]').exists()).toBe(false);
  });
});
