// Combine IdentitySection — mirrors wildcard's section 1:1 except library
// binding default reads `payload.output_var` (combine's library-binding key)
// instead of `payload.var_binding` (wildcard's). All other UX (per-field
// reset, no-auto-clear on type-matches-default, empty→null collapse) is
// verbatim from the wildcard pattern.

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import IdentitySection from "./IdentitySection.vue";
import type { ModuleEntry } from "../../../../../widgets/_shared";

function makeModule(overrides: Partial<ModuleEntry> = {}): ModuleEntry {
  return {
    id: "ab12cd34",
    type: "combine",
    enabled: true,
    meta: { name: "final_prompt" },
    entries: [],
    payload: { output_var: "final_prompt", template: "$style portrait" },
    instance: {},
    ...overrides,
  };
}

describe("combine IdentitySection", () => {
  it("renders name input bound to module.meta.name", () => {
    const w = mount(IdentitySection, { props: { module: makeModule() } });
    const input = w.find<HTMLInputElement>('[data-test="id-name"]').element;
    expect(input.value).toBe("final_prompt");
  });

  it("emits update with new meta.name when name input changes", async () => {
    const w = mount(IdentitySection, { props: { module: makeModule() } });
    const input = w.find<HTMLInputElement>('[data-test="id-name"]');
    input.element.value = "Final prompt";
    await input.trigger("input");
    const updates = w.emitted("update")!;
    const patch = updates[updates.length - 1][0] as Partial<ModuleEntry>;
    expect(patch.meta?.name).toBe("Final prompt");
  });

  it("placeholder on binding input shows library output_var when no override", () => {
    // Combine's distinguishing test — library default sources from
    // `payload.output_var`, not `payload.var_binding`.
    const w = mount(IdentitySection, { props: { module: makeModule() } });
    const input = w.find<HTMLInputElement>('[data-test="id-binding"]').element;
    expect(input.placeholder).toBe("final_prompt");
    expect(input.value).toBe("");
  });

  it("renders binding input with current instance.variable_binding", () => {
    const w = mount(IdentitySection, {
      props: { module: makeModule({ instance: { variable_binding: "header_text" } }) },
    });
    const input = w.find<HTMLInputElement>('[data-test="id-binding"]').element;
    expect(input.value).toBe("header_text");
  });

  it("emits update with new variable_binding when binding input changes", async () => {
    const w = mount(IdentitySection, { props: { module: makeModule() } });
    const input = w.find<HTMLInputElement>('[data-test="id-binding"]');
    input.element.value = "header_text";
    await input.trigger("input");
    const updates = w.emitted("update")!;
    const patch = updates[updates.length - 1][0] as Partial<ModuleEntry>;
    expect(patch.instance?.variable_binding).toBe("header_text");
  });

  it("empty binding emits null collapse", async () => {
    const w = mount(IdentitySection, {
      props: { module: makeModule({ instance: { variable_binding: "header_text" } }) },
    });
    const input = w.find<HTMLInputElement>('[data-test="id-binding"]');
    input.element.value = "";
    await input.trigger("input");
    const updates = w.emitted("update")!;
    const patch = updates[updates.length - 1][0] as Partial<ModuleEntry>;
    expect(patch.instance?.variable_binding).toBeNull();
  });

  it("binding input gets mod class when override differs from output_var", () => {
    const w = mount(IdentitySection, {
      props: { module: makeModule({ instance: { variable_binding: "header_text" } }) },
    });
    expect(w.find('[data-test="id-binding"]').classes()).toContain("id__input--mod");
  });

  it("name reset button restores meta.name to library_name", async () => {
    const w = mount(IdentitySection, {
      props: { module: makeModule({ meta: { name: "Custom", library_name: "final_prompt" } }) },
    });
    await w.find('[data-test="id-name-reset"]').trigger("click");
    const updates = w.emitted("update")!;
    const patch = updates[updates.length - 1][0] as Partial<ModuleEntry>;
    expect(patch.meta?.name).toBe("final_prompt");
  });

  it("binding reset button clears variable_binding override (null)", async () => {
    const w = mount(IdentitySection, {
      props: { module: makeModule({ instance: { variable_binding: "header_text" } }) },
    });
    await w.find('[data-test="id-binding-reset"]').trigger("click");
    const updates = w.emitted("update")!;
    const patch = updates[updates.length - 1][0] as Partial<ModuleEntry>;
    expect(patch.instance?.variable_binding).toBeNull();
  });
});
