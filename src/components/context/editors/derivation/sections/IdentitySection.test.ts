// Derivation IdentitySection — display name only. Derivation modules
// don't produce a single binding (each rule writes a different
// `target_var`), so there's no variable-binding row like wildcard /
// combine have. Rule editing lives in SPA.

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import IdentitySection from "./IdentitySection.vue";
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

describe("derivation IdentitySection", () => {
  it("renders name input bound to module.meta.name", () => {
    const w = mount(IdentitySection, { props: { module: makeModule() } });
    expect(w.find<HTMLInputElement>('[data-test="id-name"]').element.value).toBe("mood-rules");
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
      props: { module: makeModule({ meta: { name: "Custom", library_name: "mood-rules" } }) },
    });
    expect(w.find('[data-test="id-name"]').classes()).toContain("id__input--mod");
  });

  it("name reset button restores meta.name to library_name", async () => {
    const w = mount(IdentitySection, {
      props: { module: makeModule({ meta: { name: "Custom", library_name: "mood-rules" } }) },
    });
    await w.find('[data-test="id-name-reset"]').trigger("click");
    const updates = w.emitted("update")!;
    const patch = updates[updates.length - 1][0] as Partial<ModuleEntry>;
    expect(patch.meta?.name).toBe("mood-rules");
  });

  it("does NOT render a variable-binding row (derivations don't bind a single var)", () => {
    const w = mount(IdentitySection, { props: { module: makeModule() } });
    expect(w.find('[data-test="id-binding"]').exists()).toBe(false);
  });
});
