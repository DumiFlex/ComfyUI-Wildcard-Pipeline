import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ChoiceCards from "../ChoiceCards.vue";

const OPTIONS = [
  { value: "a", label: "Alpha", hint: "First." },
  { value: "b", label: "Beta", hint: "Second." },
  { value: "c", label: "Gamma", hint: "Third." },
];

function make(modelValue = "b", compact = false) {
  return mount(ChoiceCards, { props: { modelValue, options: OPTIONS, compact, testPrefix: "cc", ariaLabel: "Pick" } });
}

describe("ChoiceCards", () => {
  it("is a radio group with the chosen card checked and in the Tab order", () => {
    const w = make();
    expect(w.get("[role=radiogroup]").attributes("aria-label")).toBe("Pick");
    const b = w.get('[data-test="cc-b"]');
    expect(b.attributes("aria-checked")).toBe("true");
    expect(b.attributes("tabindex")).toBe("0");
    expect(w.get('[data-test="cc-a"]').attributes("tabindex")).toBe("-1");
    expect(b.text()).toContain("Second.");
  });

  it("picks on click and with the arrow keys, Home and End", async () => {
    const w = make();
    await w.get('[data-test="cc-a"]').trigger("click");
    await w.get('[data-test="cc-b"]').trigger("keydown", { key: "ArrowRight" });
    await w.get('[data-test="cc-b"]').trigger("keydown", { key: "ArrowLeft" });
    await w.get('[data-test="cc-b"]').trigger("keydown", { key: "End" });
    await w.get('[data-test="cc-b"]').trigger("keydown", { key: "Home" });
    expect(w.emitted("update:modelValue")).toEqual([["a"], ["c"], ["a"], ["c"], ["a"]]);
  });

  it("does not emit for the card already chosen, and ignores other keys", async () => {
    const w = make();
    await w.get('[data-test="cc-b"]').trigger("click");
    await w.get('[data-test="cc-b"]').trigger("keydown", { key: "x" });
    expect(w.emitted("update:modelValue")).toBeUndefined();
  });

  it("compact moves the hint into the tooltip", () => {
    const w = make("a", true);
    const a = w.get('[data-test="cc-a"]');
    expect(a.attributes("title")).toBe("First.");
    expect(a.text()).not.toContain("First.");
  });
});
