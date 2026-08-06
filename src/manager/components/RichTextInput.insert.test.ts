import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import RichTextInput from "./RichTextInput.vue";

/**
 * `insertTextAtCaret` is the component's only public method, and its only
 * caller lives in a different widget: the assembler's chip strip. Before Vue
 * Nodes that caller spliced into the native `<textarea>` at `widget.inputEl`;
 * that element is now detached and unrendered, so this method IS the seam.
 *
 * jsdom has no real caret, so these cover the no-selection path — which is
 * also the path the chip strip actually takes, because clicking a chip moves
 * focus out of the editor. `currentCursorCharOffset` reports end-of-text in
 * that case, so the contract is "append, with one separating space".
 */
describe("RichTextInput — insertTextAtCaret", () => {
  type Exposed = { insertTextAtCaret: (t: string) => void };
  const insert = (w: ReturnType<typeof mount>, t: string) =>
    (w.vm as unknown as Exposed).insertTextAtCaret(t);
  /** Last value the component emitted. */
  const emitted = (w: ReturnType<typeof mount>) => {
    const evs = w.emitted("update:modelValue") ?? [];
    return evs.length ? (evs[evs.length - 1] as string[])[0] : undefined;
  };

  it("appends with a separating space when the text does not end in whitespace", async () => {
    const w = mount(RichTextInput, {
      props: { modelValue: "a portrait of", surface: "assembler", multiline: true },
    });
    await w.vm.$nextTick();
    insert(w, "$subject");
    await w.vm.$nextTick();
    expect(emitted(w)).toBe("a portrait of $subject");
  });

  it("does not double the space when the text already ends in one", async () => {
    const w = mount(RichTextInput, {
      props: { modelValue: "a portrait of ", surface: "assembler", multiline: true },
    });
    await w.vm.$nextTick();
    insert(w, "$subject");
    await w.vm.$nextTick();
    expect(emitted(w)).toBe("a portrait of $subject");
  });

  it("adds no leading space when the editor is empty", async () => {
    const w = mount(RichTextInput, {
      props: { modelValue: "", surface: "assembler", multiline: true },
    });
    await w.vm.$nextTick();
    insert(w, "$subject");
    await w.vm.$nextTick();
    expect(emitted(w)).toBe("$subject");
  });

  it("chipifies an inserted $var on a surface that reads vars", async () => {
    // The whole reason the assembler routes through here instead of writing
    // `widget.value`: the insert is re-parsed, so the new token renders as a
    // chip immediately rather than sitting as literal text until the next
    // keystroke.
    const w = mount(RichTextInput, {
      props: { modelValue: "a portrait of", surface: "assembler", multiline: true },
    });
    await w.vm.$nextTick();
    insert(w, "$subject");
    await w.vm.$nextTick();
    const labels = w.findAll(".wp-refchip__label").map((c) => c.text());
    expect(labels).toContain("$subject");
  });

  it("separates on the trailing side too, so the token keeps its identity", async () => {
    // Regression: inserting at a caret that sits BEFORE existing text produced
    // `$moodportrait`, which re-parses as a variable called `moodportrait` —
    // the insert silently changed what it inserted. Needs a real caret, so
    // this one drives jsdom's Selection rather than relying on the
    // end-of-text fallback the other cases use.
    const w = mount(RichTextInput, {
      props: { modelValue: "portrait", surface: "assembler", multiline: true },
      attachTo: document.body,
    });
    await w.vm.$nextTick();
    const host = w.get(".wp-rt__host").element;
    const target = host.querySelector(".wp-rt__text")?.firstChild ?? host.firstChild;
    expect(target).toBeTruthy();
    const range = document.createRange();
    range.setStart(target as Node, 0);
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);

    insert(w, "$mood");
    await w.vm.$nextTick();
    expect(emitted(w)).toBe("$mood portrait");
    w.unmount();
  });

  it("leaves an inserted $var as literal text on a producer surface", async () => {
    // fixed_values DEFINES `$name`; it does not read one. Insert must respect
    // the surface rather than chipifying unconditionally.
    const w = mount(RichTextInput, {
      props: { modelValue: "cozy", surface: "fixed_values", multiline: true },
    });
    await w.vm.$nextTick();
    insert(w, "$subject");
    await w.vm.$nextTick();
    expect(emitted(w)).toBe("cozy $subject");
    expect(w.findAll(".wp-refchip__label").map((c) => c.text())).not.toContain("$subject");
  });
});
