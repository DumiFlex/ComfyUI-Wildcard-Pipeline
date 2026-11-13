import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import NegativeTemplateBox from "./NegativeTemplateBox.vue";

function box(linked: boolean, collapsed = false) {
  return mount(NegativeTemplateBox, {
    props: { modelValue: "lowres, $negatives", collapsed, linked, varSuggestions: [], varProducers: new Map() },
    global: { stubs: { RichTextInput: { template: '<div data-test="neg-editor" />' } } },
  });
}

describe("NegativeTemplateBox", () => {
  it("shows the editor while nothing is wired", () => {
    const w = box(false);
    expect(w.find('[data-test="neg-template-linked"]').exists()).toBe(false);
  });

  it("says where the negative comes from once its input is wired", () => {
    const w = box(true);
    const note = w.find('[data-test="neg-template-linked"]');
    expect(note.exists()).toBe(true);
    expect(note.text()).toContain("From the negative_template input");
  });

  it("the folded line names the wire too", () => {
    const w = box(true, true);
    expect(w.find('[data-test="neg-template-summary"]').text()).toBe("driven by the connected input");
  });
});
