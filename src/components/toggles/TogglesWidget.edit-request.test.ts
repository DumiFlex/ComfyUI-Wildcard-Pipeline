import { describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import TogglesWidget from "./TogglesWidget.vue";
import { defaultTogglesConfig, type TogglesConfig } from "../../extension/toggles";

const cfg: TogglesConfig = {
  ...defaultTogglesConfig(),
  rows: [
    { id: "aaaa0001", kind: "label", name: "Time", color: 2, hex: "#ffaa00", icon: "clock" },
    { id: "00000001", kind: "toggle", name: "Day", var: "day", on: true, pin: false, out: 0, style: "switch", icon: "sun" },
  ],
};

/** The window is teleported to body; wait for its lazy chunk. */
async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await vi.dynamicImportSettled();
    await flushPromises();
  }
}
function inBody(sel: string): HTMLElement | null {
  return document.body.querySelector<HTMLElement>(sel);
}

describe("TogglesWidget edit window", () => {
  it("keeps the node in its clean view and opens the window on the toolbar pencil", async () => {
    const w = mount(TogglesWidget, { attachTo: document.body, props: { modelValue: cfg, editRequest: 0, nodeTitle: "Light" } });
    expect(w.find(".wp-tg--edit").exists()).toBe(false);
    expect(inBody('[data-test="tg-editor-window"]')).toBeNull();
    await w.setProps({ editRequest: 1 });
    await settle();
    expect(inBody('[data-test="tg-editor-window"]')?.textContent).toContain("Light");
    // The editor column and the preview both draw the draft.
    expect(inBody('[data-test="tg-editor-window"] .wp-tg--edit')).not.toBeNull();
    expect(inBody('[data-test="tg-preview"] [data-test="tg-row-00000001"]')).not.toBeNull();
    w.unmount();
  });

  it("writes the draft on Done and drops it on Cancel", async () => {
    const w = mount(TogglesWidget, { attachTo: document.body, props: { modelValue: cfg, editRequest: 0 } });
    await w.setProps({ editRequest: 1 });
    await settle();
    inBody('[data-test="tg-preview"] [data-test="tg-ctl-00000001"]')?.click();
    await settle();
    inBody('[data-test="tg-window-cancel"]')?.click();
    await settle();
    expect(w.emitted("update:modelValue")).toBeUndefined();
    expect(inBody('[data-test="tg-editor-window"]')).toBeNull();

    await w.setProps({ editRequest: 2 });
    await settle();
    inBody('[data-test="tg-preview"] [data-test="tg-ctl-00000001"]')?.click();
    await settle();
    inBody('[data-test="tg-window-done"]')?.click();
    await settle();
    const next = w.emitted("update:modelValue")?.[0]?.[0] as TogglesConfig | undefined;
    expect(next?.rows.find((r) => r.id === "00000001" && r.kind === "toggle" && !r.on)).toBeDefined();
    w.unmount();
  });

  it("an empty node offers a button that opens the window", async () => {
    const w = mount(TogglesWidget, { attachTo: document.body, props: { modelValue: { ...defaultTogglesConfig(), rows: [] } } });
    await w.find('[data-test="tg-open-window"]').trigger("click");
    await settle();
    expect(inBody('[data-test="tg-editor-window"]')).not.toBeNull();
    w.unmount();
  });

  it("wears the label's own colour and icon", () => {
    const w = mount(TogglesWidget, { props: { modelValue: cfg } });
    const label = w.find('[data-test="tg-label-aaaa0001"]');
    expect(label.attributes("style")).toContain("color: rgb(255, 170, 0)");
    expect(label.find(".pi-clock").exists()).toBe(true);
    w.unmount();
  });
});
