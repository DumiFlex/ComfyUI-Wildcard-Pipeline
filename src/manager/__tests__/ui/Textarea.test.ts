import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import Textarea from "../../components/ui/Textarea.vue";

describe("Textarea.vue", () => {
  it("two-way binds via v-model", async () => {
    const wrap = mount(Textarea, { props: { modelValue: "" } });
    await wrap.get("textarea").setValue("hello");
    const emitted = wrap.emitted("update:modelValue");
    expect(emitted).toBeTruthy();
    expect(emitted![0]).toEqual(["hello"]);
  });

  it("reflects error state via aria-invalid", () => {
    const wrap = mount(Textarea, { props: { modelValue: "", error: true } });
    expect(wrap.get("textarea").attributes("aria-invalid")).toBe("true");
  });

  it("omits aria-invalid when error is false", () => {
    const wrap = mount(Textarea, { props: { modelValue: "" } });
    expect(wrap.get("textarea").attributes("aria-invalid")).toBeUndefined();
  });
});
