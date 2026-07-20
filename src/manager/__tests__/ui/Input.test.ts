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

  it("emits native step=any for number inputs (no off-grid validation popup)", () => {
    // Regression: `min="0.01" step="0.1"` made the browser reject a default
    // weight of 1 ("nearest valid values are 0.91 and 1.01"). The native
    // step is validation-only here (arrows/wheel/chevrons use bump()), so it
    // must be "any" to never grid-validate. bump() still uses props.step.
    const wrap = mount(Input, {
      props: { modelValue: 1, type: "number", step: 0.1, min: 0.01 },
    });
    const el = wrap.get("input").element as HTMLInputElement;
    expect(el.getAttribute("step")).toBe("any");
    expect(el.validity.stepMismatch).toBe(false);
  });

  it("leaves step untouched on non-number inputs", () => {
    const wrap = mount(Input, { props: { modelValue: "x", step: 5 } });
    // Non-number inputs never grid-validate, and `step` is meaningless on
    // them, so nativeStep passes props.step straight through.
    expect(wrap.get("input").attributes("step")).toBe("5");
  });

  it("numeric stepper rounds to step precision (no float fuzz)", async () => {
    // Regression: clicking the up chevron on value=1 with step=0.1
    // historically emitted 1.0000000000000002 (JS float math), which
    // some locales rendered as "1,20000" in the input field.
    const wrap = mount(Input, {
      props: { modelValue: 1, type: "number", step: 0.1, min: 0.01 },
    });
    // Click the up chevron — the first .wp-input-number__btn in the
    // stepper (rendered when type=number).
    const upBtn = wrap.findAll(".wp-input-number__btn")[0];
    expect(upBtn).toBeTruthy();
    await upBtn.trigger("click");
    const emitted = wrap.emitted("update:modelValue");
    expect(emitted).toBeTruthy();
    expect(emitted![0]).toEqual([1.1]);

    // Verify chained bumps stay clean (no cumulative drift).
    await wrap.setProps({ modelValue: 1.1 });
    await upBtn.trigger("click");
    expect(emitted![1]).toEqual([1.2]);
    await wrap.setProps({ modelValue: 1.2 });
    await upBtn.trigger("click");
    expect(emitted![2]).toEqual([1.3]);
  });
});
