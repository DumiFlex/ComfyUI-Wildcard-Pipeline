import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import FixedValuesInstanceModal from "./FixedValuesInstanceModal.vue";
import type { ModuleEntry } from "../../../../widgets/_shared";

function makeModule(overrides: Partial<ModuleEntry> = {}): ModuleEntry {
  return {
    id: "fv012345",
    type: "fixed_values",
    enabled: true,
    meta: { name: "presets", library_name: "presets" },
    entries: [],
    payload: {
      values: [
        { id: "v1", name: "lens", value: "85mm" },
        { id: "v2", name: "angle", value: "wide" },
      ],
    },
    instance: {},
    payload_hash: "h",
    ...overrides,
  };
}

describe("FixedValuesInstanceModal", () => {
  it("renders header with kind chip + name", () => {
    const w = mount(FixedValuesInstanceModal, { props: { module: makeModule() } });
    expect(w.find('[data-test="fvm-name"]').text()).toBe("presets");
    expect(w.find('[data-test="fvm-chip"]').text().toLowerCase()).toBe("fixed");
  });

  it("renders all 3 sections", () => {
    const w = mount(FixedValuesInstanceModal, { props: { module: makeModule() } });
    expect(w.findComponent({ name: "IdentitySection" }).exists()).toBe(true);
    expect(w.findComponent({ name: "ValuesSection" }).exists()).toBe(true);
    expect(w.findComponent({ name: "RuntimeSection" }).exists()).toBe(true);
  });

  it("forwards section update events upward", async () => {
    const w = mount(FixedValuesInstanceModal, { props: { module: makeModule() } });
    const id = w.findComponent({ name: "IdentitySection" });
    id.vm.$emit("update", { meta: { name: "x" } });
    await w.vm.$nextTick();
    expect((w.emitted("update")![0][0] as Partial<ModuleEntry>).meta?.name).toBe("x");
  });

  it("Save + Cancel buttons emit save / cancel", async () => {
    const w = mount(FixedValuesInstanceModal, { props: { module: makeModule() } });
    await w.find('[data-test="fvm-save"]').trigger("click");
    expect(w.emitted("save")).toBeTruthy();
    await w.find('[data-test="fvm-cancel"]').trigger("click");
    expect(w.emitted("cancel")).toBeTruthy();
  });

  it("Reset overrides button emits clear-all-overrides", async () => {
    const w = mount(FixedValuesInstanceModal, { props: { module: makeModule() } });
    await w.find('[data-test="fvm-clear-all"]').trigger("click");
    expect(w.emitted("clear-all-overrides")).toBeTruthy();
  });

  it("SPA link points at /wp/fixed-values/<id>/edit (not manager/...)", () => {
    const w = mount(FixedValuesInstanceModal, { props: { module: makeModule() } });
    expect(w.find('[data-test="fvm-spa-link"]').attributes("href")).toBe("/wp/fixed-values/fv012345/edit");
  });

  it("inline-created module (no payload_hash) hides SPA link, Reset overrides, and kebab", () => {
    const w = mount(FixedValuesInstanceModal, {
      props: { module: makeModule({ payload_hash: undefined }), isDrifted: false },
    });
    expect(w.find('[data-test="fvm-spa-link"]').exists()).toBe(false);
    expect(w.find('[data-test="fvm-clear-all"]').exists()).toBe(false);
    expect(w.find('[data-test="fvm-kebab"]').exists()).toBe(false);
  });

  it("kebab visible whenever module is library-tracked (regardless of drift)", () => {
    const tracked = mount(FixedValuesInstanceModal, {
      props: { module: makeModule(), isDrifted: false },
    });
    expect(tracked.find('[data-test="fvm-kebab"]').exists()).toBe(true);
    const inline = mount(FixedValuesInstanceModal, {
      props: { module: makeModule({ payload_hash: undefined }), isDrifted: false },
    });
    expect(inline.find('[data-test="fvm-kebab"]').exists()).toBe(false);
  });
});
