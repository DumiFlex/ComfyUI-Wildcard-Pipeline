import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import RichTextInput from "./RichTextInput.vue";

/**
 * Enter in a multiline field. The browser's own line break splits the caret's
 * text span and wraps the copy in a `<div>`, `data-atom-index` included, so
 * two spans claimed one atom and every later edit doubled the whole value
 * (reported on the Assembler template: type `1girl` on a new line, Backspace
 * seems dead, Space copies the template again and again).
 */

const ZWSP_RE = /​/g;

function caretAtEnd(host: HTMLElement): void {
  const range = document.createRange();
  range.selectNodeContents(host);
  range.collapse(false);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

function lineBreak(host: HTMLElement, inputType: string): InputEvent {
  const ev = new InputEvent("beforeinput", { inputType, bubbles: true, cancelable: true });
  host.dispatchEvent(ev);
  return ev;
}

function lastEmit(w: ReturnType<typeof mount>): string | undefined {
  const all = w.emitted("update:modelValue") as string[][] | undefined;
  return all?.[all.length - 1]?.[0];
}

describe("RichTextInput — line breaks", () => {
  it("Enter puts a newline in the value instead of a browser <div>", async () => {
    const w = mount(RichTextInput, {
      props: { modelValue: "$hero, $style", surface: "assembler", multiline: true },
      attachTo: document.body,
    });
    await w.vm.$nextTick();
    const host = w.get(".wp-rt__host").element as HTMLElement;
    host.focus();
    caretAtEnd(host);
    const ev = lineBreak(host, "insertParagraph");
    expect(ev.defaultPrevented).toBe(true);
    expect(lastEmit(w)).toBe("$hero, $style\n");
    await w.vm.$nextTick();
    await w.vm.$nextTick();
    expect(host.querySelector("div")).toBeNull();
    expect(host.querySelectorAll('[data-atom-index="0"]').length).toBe(1);
    // A trailing newline draws its line only with a pad after it.
    expect(host.textContent?.endsWith("\n​")).toBe(true);
    w.unmount();
  });

  it("Shift+Enter (insertLineBreak) does the same", async () => {
    const w = mount(RichTextInput, {
      props: { modelValue: "a b", surface: "assembler", multiline: true },
      attachTo: document.body,
    });
    await w.vm.$nextTick();
    const host = w.get(".wp-rt__host").element as HTMLElement;
    host.focus();
    caretAtEnd(host);
    expect(lineBreak(host, "insertLineBreak").defaultPrevented).toBe(true);
    expect(lastEmit(w)).toBe("a b\n");
    w.unmount();
  });

  it("a single-line field swallows the break", async () => {
    const w = mount(RichTextInput, {
      props: { modelValue: "a b", surface: "assembler", multiline: false },
      attachTo: document.body,
    });
    await w.vm.$nextTick();
    const host = w.get(".wp-rt__host").element as HTMLElement;
    host.focus();
    caretAtEnd(host);
    expect(lineBreak(host, "insertParagraph").defaultPrevented).toBe(true);
    expect(w.emitted("update:modelValue")).toBeUndefined();
    w.unmount();
  });

  it("a span the browser cloned is repaired instead of doubling the value", async () => {
    const w = mount(RichTextInput, {
      props: { modelValue: "$hero, $style", surface: "assembler", multiline: true },
      attachTo: document.body,
    });
    await w.vm.$nextTick();
    const host = w.get(".wp-rt__host").element as HTMLElement;
    // What a native line break leaves behind: the caret's span, cloned.
    const original = host.querySelector(".wp-rt__text");
    const clone = original?.cloneNode(false) as HTMLElement;
    clone.textContent = "1girl";
    const div = document.createElement("div");
    div.appendChild(clone);
    host.appendChild(div);
    host.dispatchEvent(new InputEvent("input", { inputType: "insertText", data: "l", bubbles: true }));
    expect(lastEmit(w)).toBe("$hero, $style1girl");
    await w.vm.$nextTick();
    await w.vm.$nextTick();
    const fresh = w.get(".wp-rt__host").element as HTMLElement;
    expect(fresh.querySelectorAll('[data-atom-index="0"]').length).toBe(1);
    expect((fresh.textContent ?? "").replace(ZWSP_RE, "")).toBe("$hero, $style1girl");
    w.unmount();
  });
});
