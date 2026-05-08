// CombineInstanceModal — single-pane v2 shell. Mirrors
// WildcardInstanceModal + FixedValuesInstanceModal's structure (header
// with brand gradient + dark wash, IdentitySection / TemplateSection /
// RuntimeSection, footer with SPA link + reset overrides + drift kebab
// + cancel/save). Header uses `pi pi-link` icon and the mint
// `--wp-kind-combine` accent.

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import CombineInstanceModal from "./CombineInstanceModal.vue";
import type { ModuleEntry } from "../../../../widgets/_shared";

function makeModule(overrides: Partial<ModuleEntry> = {}): ModuleEntry {
  return {
    id: "ab12cd34",
    type: "combine",
    enabled: true,
    meta: { name: "final_prompt" },
    entries: [],
    payload: {
      output_var: "final_prompt",
      template: "$style portrait of $subject",
    },
    instance: {},
    payload_hash: "hash-current",
    ...overrides,
  };
}

describe("CombineInstanceModal", () => {
  it("renders pi-link icon in header", () => {
    const w = mount(CombineInstanceModal, { props: { module: makeModule() } });
    expect(w.find(".cbm__head-icon.pi.pi-link").exists()).toBe(true);
  });

  it("renders 'combine' chip + module name in header", () => {
    const w = mount(CombineInstanceModal, { props: { module: makeModule() } });
    expect(w.find('[data-test="cbm-name"]').text()).toBe("final_prompt");
    expect(w.find('[data-test="cbm-chip"]').text().toLowerCase()).toBe("combine");
  });

  it("renders all three sections (identity, template, runtime)", () => {
    const w = mount(CombineInstanceModal, { props: { module: makeModule() } });
    expect(w.findComponent({ name: "IdentitySection" }).exists()).toBe(true);
    expect(w.findComponent({ name: "TemplateSection" }).exists()).toBe(true);
    expect(w.findComponent({ name: "RuntimeSection" }).exists()).toBe(true);
  });

  it("forwards section update events upward", async () => {
    const w = mount(CombineInstanceModal, { props: { module: makeModule() } });
    const tpl = w.findComponent({ name: "TemplateSection" });
    tpl.vm.$emit("update", { instance: { template_override: "new template" } });
    await w.vm.$nextTick();
    const updates = w.emitted("update")!;
    expect((updates[0][0] as Partial<ModuleEntry>).instance?.template_override).toBe("new template");
  });

  it("renders SPA link when module has payload_hash, points at /wp/combines/<id>/edit", () => {
    const w = mount(CombineInstanceModal, { props: { module: makeModule() } });
    const link = w.find<HTMLAnchorElement>('[data-test="cbm-spa-link"]').element;
    expect(link.getAttribute("href")).toBe("/wp/combines/ab12cd34/edit");
  });

  it("does NOT render kebab when not drifted", () => {
    const w = mount(CombineInstanceModal, {
      props: { module: makeModule(), isDrifted: false },
    });
    expect(w.find('[data-test="cbm-kebab"]').exists()).toBe(false);
  });

  it("renders kebab when drifted", () => {
    const w = mount(CombineInstanceModal, {
      props: { module: makeModule(), isDrifted: true },
    });
    expect(w.find('[data-test="cbm-kebab"]').exists()).toBe(true);
  });

  it("Save + Cancel buttons emit the right events", async () => {
    const w = mount(CombineInstanceModal, { props: { module: makeModule() } });
    await w.find('[data-test="cbm-save"]').trigger("click");
    expect(w.emitted("save")).toBeTruthy();
    await w.find('[data-test="cbm-cancel"]').trigger("click");
    expect(w.emitted("cancel")).toBeTruthy();
  });

  it("Reset overrides button emits clear-all-overrides", async () => {
    const w = mount(CombineInstanceModal, { props: { module: makeModule() } });
    await w.find('[data-test="cbm-clear-all"]').trigger("click");
    expect(w.emitted("clear-all-overrides")).toBeTruthy();
  });
});
