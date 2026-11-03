import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import RichTextInput from "./RichTextInput.vue";

/**
 * Moving the caret without typing must re-check the suggestion list.
 *
 * It was only re-checked on input, so `$sty` typed at the end, then Ctrl+Home,
 * left the list open for the token the caret had left, and Enter inserted
 * `$style` at the start of the field.
 */
describe("RichTextInput — suggestions follow the caret", () => {
  const listOpen = () => document.querySelectorAll(".wp-rt-suggestions").length > 0;

  function caretAt(host: HTMLElement, where: "start" | "end"): void {
    const range = document.createRange();
    range.selectNodeContents(host);
    range.collapse(where === "start");
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  }

  async function typedToken() {
    const w = mount(RichTextInput, {
      props: { modelValue: "a $sty", surface: "assembler", multiline: true, varSuggestions: ["style", "mood"] },
      attachTo: document.body,
    });
    await w.vm.$nextTick();
    const host = w.get(".wp-rt__host").element as HTMLElement;
    host.focus();
    caretAt(host, "end");
    host.dispatchEvent(new InputEvent("input", { inputType: "insertText", data: "y", bubbles: true }));
    await w.vm.$nextTick();
    return { w, host };
  }

  it("closes when the caret leaves the token", async () => {
    const { w, host } = await typedToken();
    expect(listOpen()).toBe(true);
    caretAt(host, "start");
    await w.vm.$nextTick();
    expect(listOpen()).toBe(false);
    w.unmount();
  });

  it("stays open while the caret stays on the token", async () => {
    const { w, host } = await typedToken();
    caretAt(host, "end");
    await w.vm.$nextTick();
    expect(listOpen()).toBe(true);
    w.unmount();
  });

  it("Enter after the caret moved does not insert the suggestion", async () => {
    const { w, host } = await typedToken();
    caretAt(host, "start");
    await w.vm.$nextTick();
    host.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await w.vm.$nextTick();
    const all = w.emitted("update:modelValue") as string[][] | undefined;
    expect(all?.some(([v]) => v.includes("$style"))).toBeFalsy();
    w.unmount();
  });
});
