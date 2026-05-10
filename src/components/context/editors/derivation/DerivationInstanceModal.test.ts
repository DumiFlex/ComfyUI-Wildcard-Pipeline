// DerivationInstanceModal — single-pane v2 shell. Mirrors
// WildcardInstanceModal + CombineInstanceModal + FixedValuesInstanceModal
// structure: brand-gradient header, sections, footer with SPA link +
// reset overrides + drift kebab + cancel/save. Header icon: pi-arrow-right-arrow-left
// (same icon picker.ts uses for derivation kind).

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import DerivationInstanceModal from "./DerivationInstanceModal.vue";
import type { ModuleEntry } from "../../../../widgets/_shared";

function makeModule(overrides: Partial<ModuleEntry> = {}): ModuleEntry {
  return {
    id: "dv012345",
    type: "derivation",
    enabled: true,
    meta: { name: "mood-rules" },
    entries: [],
    payload: {
      rules: [{
        id: "r1",
        branches: [{
          condition: { var: "color", op: "equals", value: "red" },
          action: { target_var: "mood", mode: "replace", value: "warm" },
        }],
      }],
    },
    instance: {},
    payload_hash: "h",
    ...overrides,
  };
}

describe("DerivationInstanceModal", () => {
  it("renders pi-arrow-right-arrow-left icon in header", () => {
    const w = mount(DerivationInstanceModal, { props: { module: makeModule() } });
    expect(w.find(".dvm__head-icon.pi.pi-arrow-right-arrow-left").exists()).toBe(true);
  });

  it("renders 'derivation' chip + module name", () => {
    const w = mount(DerivationInstanceModal, { props: { module: makeModule() } });
    expect(w.find('[data-test="dvm-name"]').text()).toBe("mood-rules");
    expect(w.find('[data-test="dvm-chip"]').text().toLowerCase()).toBe("derivation");
  });

  it("renders Identity + Rules + Runtime sections", () => {
    const w = mount(DerivationInstanceModal, { props: { module: makeModule() } });
    expect(w.findComponent({ name: "IdentitySection" }).exists()).toBe(true);
    expect(w.findComponent({ name: "RulesSection" }).exists()).toBe(true);
    // Runtime added in 2026-05-10 tier-D expansion (Lock seed + Hide).
    expect(w.findComponent({ name: "RuntimeSection" }).exists()).toBe(true);
  });

  it("RuntimeSection updates bubble through to update event", async () => {
    const w = mount(DerivationInstanceModal, { props: { module: makeModule() } });
    const runtime = w.findComponent({ name: "RuntimeSection" });
    runtime.vm.$emit("update", { instance: { locked_seed: 4242 } });
    await w.vm.$nextTick();
    const updates = w.emitted("update")!;
    expect((updates[0][0] as Partial<ModuleEntry>).instance?.locked_seed).toBe(4242);
  });

  it("forwards section update events upward", async () => {
    const w = mount(DerivationInstanceModal, { props: { module: makeModule() } });
    const rules = w.findComponent({ name: "RulesSection" });
    rules.vm.$emit("update", { instance: { disabled_rule_ids: ["r1"] } });
    await w.vm.$nextTick();
    const updates = w.emitted("update")!;
    expect((updates[0][0] as Partial<ModuleEntry>).instance?.disabled_rule_ids).toEqual(["r1"]);
  });

  it("SPA link points at /wp/derivations/<id>/edit", () => {
    const w = mount(DerivationInstanceModal, { props: { module: makeModule() } });
    const link = w.find<HTMLAnchorElement>('[data-test="dvm-spa-link"]').element;
    expect(link.getAttribute("href")).toBe("/wp/derivations/dv012345/edit");
  });

  it("Save + Cancel emit correct events", async () => {
    const w = mount(DerivationInstanceModal, { props: { module: makeModule() } });
    await w.find('[data-test="dvm-save"]').trigger("click");
    expect(w.emitted("save")).toBeTruthy();
    await w.find('[data-test="dvm-cancel"]').trigger("click");
    expect(w.emitted("cancel")).toBeTruthy();
  });

  it("Save to library hidden when not modified (no point pushing unchanged payload)", () => {
    const w = mount(DerivationInstanceModal, {
      props: { module: makeModule(), isDrifted: false, isModified: false },
    });
    expect(w.find('[data-test="dvm-save-lib"]').exists()).toBe(false);
  });

  it("Save to library visible when library-tracked + modified", () => {
    const w = mount(DerivationInstanceModal, {
      props: { module: makeModule(), isDrifted: false, isModified: true },
    });
    expect(w.find('[data-test="dvm-save-lib"]').exists()).toBe(true);
  });

  it("Save to library hidden for inline-created (no payload_hash) even if modified", () => {
    const w = mount(DerivationInstanceModal, {
      props: { module: makeModule({ payload_hash: undefined }), isModified: true },
    });
    expect(w.find('[data-test="dvm-save-lib"]').exists()).toBe(false);
  });

  it("Reset overrides emits clear-all-overrides", async () => {
    const w = mount(DerivationInstanceModal, { props: { module: makeModule() } });
    await w.find('[data-test="dvm-clear-all"]').trigger("click");
    expect(w.emitted("clear-all-overrides")).toBeTruthy();
  });
});
