import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import Input from "../Input.vue";

describe("Input.vue", () => {
  it("two-way binds via v-model", async () => {
    const wrap = mount(Input, { props: { modelValue: "" } });
    const el = wrap.get("input");
    await el.setValue("hello");
    const emitted = wrap.emitted("update:modelValue");
    expect(emitted).toBeTruthy();
    expect(emitted![0]).toEqual(["hello"]);
  });

  it("renders an inline icon when icon prop set", () => {
    const wrap = mount(Input, { props: { modelValue: "x", icon: "search" } });
    expect(wrap.find(".wp-input-group").exists()).toBe(true);
    expect(wrap.find(".wp-input-group__icon .pi-search").exists()).toBe(true);
  });

  it("puts the prefix before the text and the suffix after it", () => {
    const wrap = mount(Input, { props: { modelValue: "hair", prefix: "$", suffix: "px" } });
    const kids = [...wrap.get(".wp-input-group").element.children];
    const input = kids.findIndex((k) => k.tagName === "INPUT");
    expect(kids[input - 1].textContent).toBe("$");
    expect(kids[input + 1].textContent).toBe("px");
  });

  it("readonly keeps the value and shows a lock", async () => {
    const wrap = mount(Input, { props: { modelValue: "hair", readonly: true } });
    expect(wrap.get("input").attributes("readonly")).toBeDefined();
    expect(wrap.find(".wp-input-group--readonly .pi-lock").exists()).toBe(true);
  });

  it("takes the lg size", () => {
    const wrap = mount(Input, { props: { modelValue: "", size: "lg" } });
    expect(wrap.get("input").classes()).toContain("wp-input--lg");
  });

  it("reflects error state via aria-invalid", () => {
    const wrap = mount(Input, { props: { modelValue: "", error: true } });
    expect(wrap.get("input").attributes("aria-invalid")).toBe("true");
  });

  it("omits aria-invalid when error is false", () => {
    const wrap = mount(Input, { props: { modelValue: "" } });
    expect(wrap.get("input").attributes("aria-invalid")).toBeUndefined();
  });
});
