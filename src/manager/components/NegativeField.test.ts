import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import NegativeField from "./NegativeField.vue";
import RichTextInput from "./RichTextInput.vue";

describe("NegativeField", () => {
  it("collapses to a `+ negative` ghost button while empty", () => {
    const w = mount(NegativeField, { props: { modelValue: undefined, testId: "neg" } });
    expect(w.get("[data-test='neg-add']").text()).toBe("+ negative");
    expect(w.findComponent(RichTextInput).exists()).toBe(false);
  });

  it("opens the input on click, with the NEG tag", async () => {
    const w = mount(NegativeField, { props: { modelValue: undefined, testId: "neg" }, attachTo: document.body });
    await w.get("[data-test='neg-add']").trigger("click");
    expect(w.findComponent(RichTextInput).exists()).toBe(true);
    expect(w.get(".wp-negfield__tag").text()).toBe("NEG");
    w.unmount();
  });

  it("forwards RichTextInput props (surface) and shows existing text", () => {
    const w = mount(NegativeField, { props: { modelValue: "strawberry, fruit" }, attrs: { surface: "wildcard" } });
    const rt = w.getComponent(RichTextInput);
    expect(rt.props("surface")).toBe("wildcard");
    expect(rt.props("modelValue")).toBe("strawberry, fruit");
  });

  it("emits undefined for blank input (stored as an absent key)", async () => {
    const w = mount(NegativeField, { props: { modelValue: "x" } });
    w.getComponent(RichTextInput).vm.$emit("update:modelValue", "   ");
    w.getComponent(RichTextInput).vm.$emit("update:modelValue", "fruit");
    expect(w.emitted("update:modelValue")).toEqual([[undefined], ["fruit"]]);
  });

  it("the remove button clears the negative", async () => {
    const w = mount(NegativeField, { props: { modelValue: "hat", testId: "neg" } });
    await w.get("[data-test='neg-clear']").trigger("click");
    expect(w.emitted("update:modelValue")).toEqual([[undefined]]);
  });

  it("alwaysOpen skips the ghost button", () => {
    const w = mount(NegativeField, { props: { modelValue: undefined, alwaysOpen: true } });
    expect(w.findComponent(RichTextInput).exists()).toBe(true);
    expect(w.find(".wp-negfield__clear").exists()).toBe(false);
  });

  it("lists broken refs under the field", () => {
    const w = mount(NegativeField, { props: { modelValue: "@{deadbeef}", brokenRefs: ["@deadbeef"] } });
    expect(w.get(".wp-negfield__broken").text()).toContain("@deadbeef not in the library");
  });
});
