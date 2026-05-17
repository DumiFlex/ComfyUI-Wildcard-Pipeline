import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import Input from "../../components/ui/Input.vue";

describe("Input.vue", () => {
  it("two-way binds via v-model", async () => {
    const wrap = mount(Input, { props: { modelValue: "" } });
    const el = wrap.get("input");
    await el.setValue("hello");
    const emitted = wrap.emitted("update:modelValue");
    expect(emitted).toBeTruthy();
    expect(emitted![0]).toEqual(["hello"]);
  });

  it("renders icon addon when icon prop set", () => {
    const wrap = mount(Input, { props: { modelValue: "x", icon: "search" } });
    expect(wrap.find(".wp-input-group").exists()).toBe(true);
    expect(wrap.find(".wp-input-group__addon .pi-search").exists()).toBe(true);
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
