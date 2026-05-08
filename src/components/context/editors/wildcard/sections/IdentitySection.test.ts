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

describe("IdentitySection", () => {
  it("renders name input bound to module.meta.name", () => {
    const w = mount(IdentitySection, { props: { module: makeModule() } });
    const input = w.find<HTMLInputElement>('[data-test="id-name"]').element;
    expect(input.value).toBe("outfit");
  });

  it("emits update with new meta.name when name input changes", async () => {
    const w = mount(IdentitySection, { props: { module: makeModule() } });
    const input = w.find<HTMLInputElement>('[data-test="id-name"]');
    input.element.value = "Top color picker";
    await input.trigger("input");
    const updates = w.emitted("update")!;
    const patch = updates[updates.length - 1][0] as Partial<ModuleEntry>;
    expect(patch.meta?.name).toBe("Top color picker");
  });

  it("renders binding input with current instance.variable_binding", () => {
    const w = mount(IdentitySection, {
      props: { module: makeModule({ instance: { variable_binding: "outfit_top" } }) },
    });
    const input = w.find<HTMLInputElement>('[data-test="id-binding"]').element;
    expect(input.value).toBe("outfit_top");
  });

  it("placeholder on binding input shows library var_binding when no override", () => {
    const w = mount(IdentitySection, { props: { module: makeModule() } });
    const input = w.find<HTMLInputElement>('[data-test="id-binding"]').element;
    expect(input.placeholder).toBe("outfit");
    expect(input.value).toBe("");
  });

  it("emits update with new variable_binding when binding input changes", async () => {
    const w = mount(IdentitySection, { props: { module: makeModule() } });
    const input = w.find<HTMLInputElement>('[data-test="id-binding"]');
    input.element.value = "outfit_top";
    await input.trigger("input");
    const updates = w.emitted("update")!;
    const patch = updates[updates.length - 1][0] as Partial<ModuleEntry>;
    expect(patch.instance?.variable_binding).toBe("outfit_top");
  });

  it("emits variable_binding=null when binding input is cleared to empty", async () => {
    const w = mount(IdentitySection, {
      props: { module: makeModule({ instance: { variable_binding: "outfit_top" } }) },
    });
    const input = w.find<HTMLInputElement>('[data-test="id-binding"]');
    input.element.value = "";
    await input.trigger("input");
    const updates = w.emitted("update")!;
    const patch = updates[updates.length - 1][0] as Partial<ModuleEntry>;
    expect(patch.instance?.variable_binding).toBeNull();
  });

  it("renders $-prefix label on binding input", () => {
    const w = mount(IdentitySection, { props: { module: makeModule() } });
    expect(w.find('[data-test="id-binding-prefix"]').text()).toBe("$");
  });

  it("name input renders with non-default value", () => {
    const w = mount(IdentitySection, {
      props: { module: makeModule({ meta: { name: "Custom" } }) },
    });
    expect(w.find<HTMLInputElement>('[data-test="id-name"]').element.value).toBe("Custom");
  });

  it("name placeholder uses meta.library_name when present", () => {
    const w = mount(IdentitySection, {
      props: { module: makeModule({ meta: { name: "", library_name: "outfit (lib)" } }) },
    });
    expect(w.find<HTMLInputElement>('[data-test="id-name"]').element.placeholder).toBe("outfit (lib)");
  });

  it("name input gets mod class when value differs from library_name", () => {
    const w = mount(IdentitySection, {
      props: { module: makeModule({ meta: { name: "Custom", library_name: "outfit" } }) },
    });
    expect(w.find('[data-test="id-name"]').classes()).toContain("id__input--mod");
  });

  it("name input does NOT get mod class when value equals library_name", () => {
    const w = mount(IdentitySection, {
      props: { module: makeModule({ meta: { name: "outfit", library_name: "outfit" } }) },
    });
    expect(w.find('[data-test="id-name"]').classes()).not.toContain("id__input--mod");
  });

  it("binding input gets mod class when override is set", () => {
    const w = mount(IdentitySection, {
      props: { module: makeModule({ instance: { variable_binding: "outfit_top" } }) },
    });
    expect(w.find('[data-test="id-binding"]').classes()).toContain("id__input--mod");
  });

  it("typing binding back to library default clears the override (null)", async () => {
    const w = mount(IdentitySection, {
      props: { module: makeModule({ instance: { variable_binding: "outfit_top" } }) },
    });
    const input = w.find<HTMLInputElement>('[data-test="id-binding"]');
    input.element.value = "outfit"; // matches library var_binding
    await input.trigger("input");
    const updates = w.emitted("update")!;
    const patch = updates[updates.length - 1][0] as Partial<ModuleEntry>;
    expect(patch.instance?.variable_binding).toBeNull();
  });

  it("name reset button appears only when name is overridden", () => {
    const noOverride = mount(IdentitySection, {
      props: { module: makeModule({ meta: { name: "outfit", library_name: "outfit" } }) },
    });
    expect(noOverride.find('[data-test="id-name-reset"]').exists()).toBe(false);

    const overridden = mount(IdentitySection, {
      props: { module: makeModule({ meta: { name: "Custom", library_name: "outfit" } }) },
    });
    expect(overridden.find('[data-test="id-name-reset"]').exists()).toBe(true);
  });

  it("name reset button restores meta.name to library_name", async () => {
    const w = mount(IdentitySection, {
      props: { module: makeModule({ meta: { name: "Custom", library_name: "outfit" } }) },
    });
    await w.find('[data-test="id-name-reset"]').trigger("click");
    const updates = w.emitted("update")!;
    const patch = updates[updates.length - 1][0] as Partial<ModuleEntry>;
    expect(patch.meta?.name).toBe("outfit");
  });

  it("binding reset button appears only when binding is overridden", () => {
    const noOverride = mount(IdentitySection, {
      props: { module: makeModule() },
    });
    expect(noOverride.find('[data-test="id-binding-reset"]').exists()).toBe(false);

    const overridden = mount(IdentitySection, {
      props: { module: makeModule({ instance: { variable_binding: "outfit_top" } }) },
    });
    expect(overridden.find('[data-test="id-binding-reset"]').exists()).toBe(true);
  });

  it("binding reset button clears variable_binding override (null)", async () => {
    const w = mount(IdentitySection, {
      props: { module: makeModule({ instance: { variable_binding: "outfit_top" } }) },
    });
    await w.find('[data-test="id-binding-reset"]').trigger("click");
    const updates = w.emitted("update")!;
    const patch = updates[updates.length - 1][0] as Partial<ModuleEntry>;
    expect(patch.instance?.variable_binding).toBeNull();
  });
});
