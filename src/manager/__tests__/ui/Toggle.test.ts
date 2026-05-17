import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import Toggle from "../../components/ui/Toggle.vue";

describe("Toggle.vue", () => {
  it("toggles modelValue", async () => {
    const wrap = mount(Toggle, { props: { modelValue: true } });
    await wrap.get("button.wp-toggle").trigger("click");
    expect(wrap.emitted("update:modelValue")?.[0]).toEqual([false]);
  });

  it("renders the data-on attribute reflecting state", () => {
    const wrap = mount(Toggle, { props: { modelValue: true } });
    expect(wrap.get("button.wp-toggle").attributes("data-on")).toBe("true");
  });

  it("reflects error state via aria-invalid on the switch button", () => {
    const wrap = mount(Toggle, { props: { modelValue: false, error: true } });
    expect(wrap.get("button.wp-toggle").attributes("aria-invalid")).toBe("true");
  });
});
