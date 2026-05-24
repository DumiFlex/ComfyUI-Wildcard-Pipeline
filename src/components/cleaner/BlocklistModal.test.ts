import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import BlocklistModal from "./BlocklistModal.vue";
import type { BlocklistKind } from "./types";

function baseProps() {
  return {
    visible: true,
    modelValue: { kind: "list" as BlocklistKind, entries: ["watermark", "lowres"] },
  };
}

describe("BlocklistModal", () => {
  it("renders mode toggle + textarea seeded with entries", () => {
    const w = mount(BlocklistModal, { props: baseProps(), attachTo: document.body });
    expect(document.querySelector('[data-test="blocklist-mode-list"]')).not.toBeNull();
    expect(document.querySelector('[data-test="blocklist-mode-regex"]')).not.toBeNull();
    const ta = document.querySelector<HTMLTextAreaElement>('[data-test="blocklist-textarea"]');
    expect(ta?.value).toContain("watermark");
    w.unmount();
  });

  it("clicking regex mode toggle switches kind", async () => {
    const w = mount(BlocklistModal, { props: baseProps(), attachTo: document.body });
    (document.querySelector('[data-test="blocklist-mode-regex"]') as HTMLElement).click();
    (document.querySelector('[data-test="blocklist-save"]') as HTMLElement).click();
    await w.vm.$nextTick();
    const emit = w.emitted("update:modelValue");
    expect(emit).toBeTruthy();
    expect((emit?.[0]?.[0] as { kind: string }).kind).toBe("regex");
    w.unmount();
  });

  it("Save emits parsed entries split on comma + newline", async () => {
    const w = mount(BlocklistModal, { props: baseProps(), attachTo: document.body });
    const ta = document.querySelector<HTMLTextAreaElement>('[data-test="blocklist-textarea"]');
    if (!ta) throw new Error("textarea missing");
    ta.value = "a, b\nc, , d";
    ta.dispatchEvent(new Event("input"));
    await w.vm.$nextTick();
    (document.querySelector('[data-test="blocklist-save"]') as HTMLElement).click();
    await w.vm.$nextTick();
    const emit = w.emitted("update:modelValue");
    expect((emit?.[0]?.[0] as { entries: string[] }).entries).toEqual(["a", "b", "c", "d"]);
    w.unmount();
  });

  it("Save emits close event after update", async () => {
    const w = mount(BlocklistModal, { props: baseProps(), attachTo: document.body });
    (document.querySelector('[data-test="blocklist-save"]') as HTMLElement).click();
    await w.vm.$nextTick();
    expect(w.emitted("close")).toBeTruthy();
    w.unmount();
  });

  it("Cancel emits close without update", async () => {
    const w = mount(BlocklistModal, { props: baseProps(), attachTo: document.body });
    (document.querySelector('[data-test="blocklist-cancel"]') as HTMLElement).click();
    await w.vm.$nextTick();
    expect(w.emitted("update:modelValue")).toBeFalsy();
    expect(w.emitted("close")).toBeTruthy();
    w.unmount();
  });

  it("shows duplicate-dedup notice", async () => {
    const w = mount(BlocklistModal, {
      props: { visible: true, modelValue: { kind: "list" as BlocklistKind, entries: ["a", "b", "a"] } },
      attachTo: document.body,
    });
    await w.vm.$nextTick();
    expect(document.body.textContent?.toLowerCase()).toContain("1 duplicate");
    w.unmount();
  });
});
