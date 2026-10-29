import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import WpButton from "../WpButton.vue";

describe("WpButton", () => {
  it("is a secondary canvas-size button by default", () => {
    const w = mount(WpButton, { slots: { default: "Cancel" } });
    expect(w.classes()).toEqual(expect.arrayContaining(["wp-btn", "wp-btn--secondary", "wp-btn--sm"]));
    expect(w.classes()).not.toContain("wp-btn--icon");
    expect(w.attributes("type")).toBe("button");
    expect(w.text()).toBe("Cancel");
  });

  it("draws a PrimeIcons icon and the variant and size asked for", () => {
    const w = mount(WpButton, { props: { variant: "primary", size: "md", icon: "pi-plus" }, slots: { default: "Add" } });
    expect(w.classes()).toEqual(expect.arrayContaining(["wp-btn--primary", "wp-btn--md"]));
    expect(w.find("i.pi.pi-plus").exists()).toBe(true);
  });

  it("is an icon button without text, named by its aria-label", () => {
    const w = mount(WpButton, { props: { icon: "pi-download", ariaLabel: "Download" } });
    expect(w.classes()).toContain("wp-btn--icon");
    expect(w.attributes("aria-label")).toBe("Download");
  });

  it("emits click, but not while disabled or loading", async () => {
    const w = mount(WpButton, { slots: { default: "Go" } });
    await w.trigger("click");
    expect(w.emitted("click")).toHaveLength(1);
    await w.setProps({ disabled: true });
    expect(w.attributes("disabled")).toBeDefined();
    await w.setProps({ disabled: false, loading: true });
    expect(w.attributes("aria-busy")).toBe("true");
    expect(w.attributes("disabled")).toBeDefined();
    expect(w.find("i.pi").exists()).toBe(false);
  });
});
