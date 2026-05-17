import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import Select from "../../components/ui/Select.vue";

const opts = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta" },
  { value: "c", label: "Gamma" },
];

// The menu is teleported to <body>, so queries must use `document` rather than
// the test-utils wrapper. `attachTo: document.body` plus `wrap.unmount()` keeps
// teleported nodes from leaking between tests.

describe("Select.vue", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("opens menu on click and renders options", async () => {
    const wrap = mount(Select, {
      props: { modelValue: null, options: opts },
      attachTo: document.body,
    });
    expect(document.querySelector(".wp-select__menu")).toBeNull();
    await wrap.get("[data-test='select-trigger']").trigger("click");
    expect(document.querySelector(".wp-select__menu")).not.toBeNull();
    expect(document.querySelectorAll(".wp-select__option").length).toBe(3);
    wrap.unmount();
  });

  it("Enter on highlighted option emits update:modelValue", async () => {
    const wrap = mount(Select, {
      props: { modelValue: null, options: opts },
      attachTo: document.body,
    });
    const trigger = wrap.get("[data-test='select-trigger']");
    await trigger.trigger("click");
    // First option (index 0) is active by default; ArrowDown moves to index 1 ("b").
    await trigger.trigger("keydown", { key: "ArrowDown" });
    await trigger.trigger("keydown", { key: "Enter" });
    const events = wrap.emitted("update:modelValue");
    expect(events).toBeTruthy();
    expect(events![0]).toEqual(["b"]);
    wrap.unmount();
  });

  it("Esc closes the menu", async () => {
    const wrap = mount(Select, {
      props: { modelValue: null, options: opts },
      attachTo: document.body,
    });
    const trigger = wrap.get("[data-test='select-trigger']");
    await trigger.trigger("click");
    expect(document.querySelector(".wp-select__menu")).not.toBeNull();
    await trigger.trigger("keydown", { key: "Escape" });
    expect(document.querySelector(".wp-select__menu")).toBeNull();
    wrap.unmount();
  });

  it("reflects error state via aria-invalid on trigger", () => {
    const wrap = mount(Select, {
      props: { modelValue: null, options: opts, error: true },
      attachTo: document.body,
    });
    expect(wrap.get("[data-test='select-trigger']").attributes("aria-invalid")).toBe("true");
    wrap.unmount();
  });
});
