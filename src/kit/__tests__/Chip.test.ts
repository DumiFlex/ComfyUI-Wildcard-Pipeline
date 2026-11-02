import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import Chip from "../Chip.vue";

describe("Chip.vue", () => {
  it("emits remove when close button clicked", async () => {
    const wrap = mount(Chip, {
      props: { removable: true },
      slots: { default: "tag" },
    });
    await wrap.get(".wp-chip__close").trigger("click");
    expect(wrap.emitted("remove")).toBeTruthy();
  });

  it("applies tone class", () => {
    const wrap = mount(Chip, { props: { tone: "success" }, slots: { default: "ok" } });
    expect(wrap.get("span.wp-chip").classes()).toContain("wp-chip--success");
  });

  it("is a span by default and a pressable button with as=button", async () => {
    expect(mount(Chip, { slots: { default: "a" } }).element.tagName).toBe("SPAN");
    const b = mount(Chip, { props: { as: "button", removable: true }, slots: { default: "portrait" } });
    expect(b.element.tagName).toBe("BUTTON");
    expect(b.attributes("type")).toBe("button");
    expect(b.classes()).toContain("wp-chip--action");
    // A pressable chip never nests a ✕ button.
    expect(b.find(".wp-chip__close").exists()).toBe(false);
    await b.trigger("click");
    expect(b.emitted("click")).toHaveLength(1);
  });

  it("renders as a link", () => {
    const a = mount(Chip, { props: { as: "a" }, attrs: { href: "/browse?tag=x" }, slots: { default: "x" } });
    expect(a.element.tagName).toBe("A");
    expect(a.attributes("type")).toBeUndefined();
    expect(a.attributes("href")).toBe("/browse?tag=x");
  });
});
