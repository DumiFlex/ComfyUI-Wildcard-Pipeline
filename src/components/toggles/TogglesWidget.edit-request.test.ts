import { describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import TogglesWidget from "./TogglesWidget.vue";
import { defaultTogglesConfig, type ToggleRow, type TogglesConfig } from "../../extension/toggles";

const cfg: TogglesConfig = {
  ...defaultTogglesConfig(),
  rows: [
    { id: "00000001", kind: "toggle", name: "Day", var: "day", on: true, pin: false, out: 0, style: "switch", icon: "sun" },
    { id: "aaaa0001", kind: "label", name: "Time", color: 2, hex: "#ffaa00", icon: "clock" },
    { id: "00000002", kind: "toggle", name: "Night", var: "night", on: false, pin: false, out: 0, style: "switch" },
  ],
};

/** The toggle window is teleported to body and loads lazily. */
async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await vi.dynamicImportSettled();
    await flushPromises();
  }
}
function q(sel: string): HTMLElement | null {
  return document.body.querySelector<HTMLElement>(sel);
}
function lastConfig(w: { emitted: (e: string) => unknown[][] | undefined }): TogglesConfig | undefined {
  const all = w.emitted("update:modelValue");
  return all?.[all.length - 1]?.[0] as TogglesConfig | undefined;
}

describe("TogglesWidget edit view (toolbar pencil)", () => {
  it("flips the edit view in the node each time the request is bumped", async () => {
    const w = mount(TogglesWidget, { props: { modelValue: cfg, editRequest: 0 } });
    expect(w.find(".wp-tg--edit").exists()).toBe(false);
    await w.setProps({ editRequest: 1 });
    expect(w.find(".wp-tg--edit").exists()).toBe(true);
    await w.setProps({ editRequest: 2 });
    expect(w.find(".wp-tg--edit").exists()).toBe(false);
    w.unmount();
  });

  it("keeps the group buttons in the node", async () => {
    const w = mount(TogglesWidget, { props: { modelValue: cfg, editRequest: 0 } });
    await w.setProps({ editRequest: 1 });
    expect(w.find('[data-test="tg-color-aaaa0001"]').exists()).toBe(true);
    expect(w.find('[data-test="tg-label-icon-aaaa0001"]').exists()).toBe(true);
    w.unmount();
  });
});

describe("TogglesWidget toggle window", () => {
  it("a row's pencil opens its window; Done stores the draft and the variable follows the name", async () => {
    const w = mount(TogglesWidget, { attachTo: document.body, props: { modelValue: cfg, editRequest: 0, nodeTitle: "Light" } });
    await w.setProps({ editRequest: 1 });
    await w.find('[data-test="tg-edit-00000001"]').trigger("click");
    await settle();
    expect(q('[data-test="modal"]')?.textContent).toContain("Light");
    const name = q('[data-test="tg-name"]') as HTMLInputElement | null;
    if (name) {
      name.value = "Sunrise";
      name.dispatchEvent(new Event("change"));
    }
    await settle();
    expect(w.emitted("update:modelValue")).toBeUndefined();
    q('[data-test="tg-window-done"]')?.click();
    await settle();
    const row = lastConfig(w)?.rows.find((r): r is ToggleRow => r.id === "00000001" && r.kind === "toggle");
    expect(row).toMatchObject({ name: "Sunrise", var: "sunrise", icon: "sun" });
    expect(q('[data-test="modal"]')).toBeNull();
    w.unmount();
  });

  it("Done moves the toggle to the group picked in its window", async () => {
    const w = mount(TogglesWidget, { attachTo: document.body, props: { modelValue: cfg, editRequest: 0 } });
    await w.setProps({ editRequest: 1 });
    await w.find('[data-test="tg-edit-00000002"]').trigger("click");
    await settle();
    // Night sits under "Time"; Top moves it above the label.
    const win = w.findComponent({ name: "ToggleEditWindow" });
    expect(win.exists()).toBe(true);
    win.vm.$emit("done", cfg.rows[2], "");
    await settle();
    expect(lastConfig(w)?.rows.map((r) => r.id)).toEqual(["00000001", "00000002", "aaaa0001"]);
    w.unmount();
  });

  it("the row's trash removes the toggle", async () => {
    const w = mount(TogglesWidget, { props: { modelValue: cfg, editRequest: 0 } });
    await w.setProps({ editRequest: 1 });
    await w.find('[data-test="tg-remove-00000002"]').trigger("click");
    expect(lastConfig(w)?.rows.map((r) => r.id)).toEqual(["00000001", "aaaa0001"]);
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
