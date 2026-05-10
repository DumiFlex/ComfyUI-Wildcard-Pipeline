import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import WildcardInstanceModal from "./WildcardInstanceModal.vue";
import type { ModuleEntry } from "../../../../widgets/_shared";

function makeModule(overrides: Partial<ModuleEntry> = {}): ModuleEntry {
  return {
    id: "ab12cd34",
    type: "wildcard",
    enabled: true,
    meta: { name: "backdrop" },
    entries: [],
    payload: {
      var_binding: "outfit",
      sub_categories: ["warm", "cool"],
      options: [
        { id: "o1", value: "red", weight: 1, sub_category: "warm" },
        { id: "o2", value: "blue", weight: 1, sub_category: "cool" },
      ],
    },
    instance: {},
    payload_hash: "hash-current",
    ...overrides,
  };
}

describe("WildcardInstanceModal", () => {
  it("renders header with kind chip and module name", () => {
    const w = mount(WildcardInstanceModal, { props: { module: makeModule() } });
    expect(w.find('[data-test="wcm-name"]').text()).toBe("backdrop");
    expect(w.find('[data-test="wcm-chip"]').text().toLowerCase()).toBe("wildcard");
  });

  it("renders all four sections (identity, pool, runtime)", () => {
    const w = mount(WildcardInstanceModal, { props: { module: makeModule() } });
    expect(w.findComponent({ name: "IdentitySection" }).exists()).toBe(true);
    expect(w.findComponent({ name: "PoolSection" }).exists()).toBe(true);
    expect(w.findComponent({ name: "RuntimeSection" }).exists()).toBe(true);
  });

  it("forwards IdentitySection update events upward", async () => {
    const w = mount(WildcardInstanceModal, { props: { module: makeModule() } });
    const id = w.findComponent({ name: "IdentitySection" });
    id.vm.$emit("update", { instance: { variable_binding: "renamed" } });
    await w.vm.$nextTick();
    const updates = w.emitted("update")!;
    expect((updates[0][0] as Partial<ModuleEntry>).instance?.variable_binding).toBe("renamed");
  });

  it("forwards PoolSection update events upward", async () => {
    const w = mount(WildcardInstanceModal, { props: { module: makeModule() } });
    const pool = w.findComponent({ name: "PoolSection" });
    pool.vm.$emit("update", { instance: { enabled_options: ["o1"] } });
    await w.vm.$nextTick();
    const updates = w.emitted("update")!;
    expect((updates[0][0] as Partial<ModuleEntry>).instance?.enabled_options).toEqual(["o1"]);
  });

  it("forwards RuntimeSection update events upward", async () => {
    const w = mount(WildcardInstanceModal, { props: { module: makeModule() } });
    const rt = w.findComponent({ name: "RuntimeSection" });
    rt.vm.$emit("update", { instance: { locked_seed: 12345 } });
    await w.vm.$nextTick();
    const updates = w.emitted("update")!;
    expect((updates[0][0] as Partial<ModuleEntry>).instance?.locked_seed).toBe(12345);
  });

  it("renders SPA link in footer", () => {
    const w = mount(WildcardInstanceModal, { props: { module: makeModule() } });
    expect(w.find('[data-test="wcm-spa-link"]').exists()).toBe(true);
  });

  it("renders Save and Cancel buttons + emits the right events", async () => {
    const w = mount(WildcardInstanceModal, { props: { module: makeModule() } });
    await w.find('[data-test="wcm-save"]').trigger("click");
    expect(w.emitted("save")).toBeTruthy();
    await w.find('[data-test="wcm-cancel"]').trigger("click");
    expect(w.emitted("cancel")).toBeTruthy();
  });

  it("Save to library hidden when not modified (no point pushing unchanged payload)", () => {
    const w = mount(WildcardInstanceModal, {
      props: { module: makeModule(), isDrifted: false, isModified: false },
    });
    expect(w.find('[data-test="wcm-save-lib"]').exists()).toBe(false);
  });

  it("Save to library visible when library-tracked + modified", () => {
    const w = mount(WildcardInstanceModal, {
      props: { module: makeModule(), isDrifted: false, isModified: true },
    });
    expect(w.find('[data-test="wcm-save-lib"]').exists()).toBe(true);
  });

  it("Save to library hidden for inline-created (no payload_hash) even if modified", () => {
    const w = mount(WildcardInstanceModal, {
      props: { module: makeModule({ payload_hash: undefined }), isModified: true },
    });
    expect(w.find('[data-test="wcm-save-lib"]').exists()).toBe(false);
  });

  it("Reset overrides button emits clear-all-overrides event", async () => {
    const w = mount(WildcardInstanceModal, { props: { module: makeModule() } });
    await w.find('[data-test="wcm-clear-all"]').trigger("click");
    expect(w.emitted("clear-all-overrides")).toBeTruthy();
  });

  it("SPA URL points at /wp/wildcards/<id>/edit (not /wp/manager/...)", () => {
    const w = mount(WildcardInstanceModal, { props: { module: makeModule() } });
    const link = w.find<HTMLAnchorElement>('[data-test="wcm-spa-link"]').element;
    expect(link.getAttribute("href")).toBe("/wp/wildcards/ab12cd34/edit");
  });
});
