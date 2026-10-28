import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import WpSwitch from "../WpSwitch.vue";

describe("WpSwitch", () => {
  it("is a switch that flips on click, Space and Enter", async () => {
    const w = mount(WpSwitch, { props: { modelValue: false, label: "Hold" } });
    const sw = w.get('[role="switch"]');
    expect(sw.attributes("aria-checked")).toBe("false");
    expect(sw.attributes("tabindex")).toBe("0");
    await sw.trigger("click");
    await sw.trigger("keydown", { key: " " });
    await sw.trigger("keydown", { key: "Enter" });
    expect(w.emitted("update:modelValue")).toEqual([[true], [true], [true]]);
  });

  it("defaults to the canvas size and the track look", () => {
    const w = mount(WpSwitch).get('[role="switch"]');
    expect(w.classes()).toEqual(expect.arrayContaining(["wp-switch", "wp-switch--sm"]));
    expect(w.find(".wp-switch__track").exists()).toBe(true);
  });

  it("draws the chip look with its icon and label", () => {
    const w = mount(WpSwitch, { props: { modelValue: true, variant: "chip", icon: "pi-lock", label: "Lock pick" } }).get('[role="switch"]');
    expect(w.classes()).toContain("wp-switch--chip");
    expect(w.find(".wp-switch__track").exists()).toBe(false);
    expect(w.find(".pi-lock").exists()).toBe(true);
    expect(w.text()).toBe("Lock pick");
    expect(w.attributes("aria-checked")).toBe("true");
  });

  it("shows mixed only while off, and reads as off", () => {
    expect(mount(WpSwitch, { props: { mixed: true } }).get('[role="switch"]').classes()).toContain("wp-switch--mixed");
    const on = mount(WpSwitch, { props: { mixed: true, modelValue: true } }).get('[role="switch"]');
    expect(on.classes()).not.toContain("wp-switch--mixed");
    expect(mount(WpSwitch, { props: { mixed: true } }).get('[role="switch"]').attributes("aria-checked")).toBe("false");
  });

  it("ignores input when disabled, staying focusable so its tooltip shows", async () => {
    const w = mount(WpSwitch, { props: { disabled: true } });
    const sw = w.get('[role="switch"]');
    expect(sw.attributes("aria-disabled")).toBe("true");
    expect(sw.attributes("tabindex")).toBe("0");
    await sw.trigger("click");
    await sw.trigger("keydown", { key: "Enter" });
    expect(w.emitted("update:modelValue")).toBeUndefined();
  });

  it("marks invalid", () => {
    expect(mount(WpSwitch, { props: { invalid: true } }).get('[role="switch"]').attributes("aria-invalid")).toBe("true");
  });
});
