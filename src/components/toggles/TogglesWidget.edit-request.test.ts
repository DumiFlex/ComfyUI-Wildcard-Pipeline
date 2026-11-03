import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import TogglesWidget from "./TogglesWidget.vue";
import { defaultTogglesConfig } from "../../extension/toggles";

describe("TogglesWidget edit request (toolbar pencil)", () => {
  it("flips the edit view each time the request is bumped", async () => {
    const w = mount(TogglesWidget, { props: { modelValue: defaultTogglesConfig(), editRequest: 0 } });
    expect(w.find(".wp-tg--edit").exists()).toBe(false);
    await w.setProps({ editRequest: 1 });
    expect(w.find(".wp-tg--edit").exists()).toBe(true);
    await w.setProps({ editRequest: 2 });
    expect(w.find(".wp-tg--edit").exists()).toBe(false);
    w.unmount();
  });
});
