import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import NoteTextEditor from "./NoteTextEditor.vue";
import NoteMarkdown from "./note-markdown";

function make(text: string) {
  return mount(NoteTextEditor, { props: { modelValue: text, hint: "" }, attachTo: document.body });
}

function lastText(w: ReturnType<typeof make>): string | undefined {
  const calls = w.emitted("update:modelValue") as string[][] | undefined;
  return calls?.[calls.length - 1]?.[0];
}

describe("NoteTextEditor inserts", () => {
  it("puts a link where the caret is when Insert is pressed, not where it was when the panel opened", async () => {
    const w = make("first line");
    const area = w.get('[data-test="note-text"]').element as HTMLTextAreaElement;
    area.setSelectionRange(10, 10);
    await w.get('[data-test="note-fmt-link"]').trigger("click");
    await w.get('[data-test="note-link-kind-web"]').trigger("click");
    await w.get('[data-test="note-link-url"]').setValue("https://example.com");
    await w.get('[data-test="note-link-text"]').setValue("X");
    // Click back into the text, after "first".
    area.setSelectionRange(5, 5);
    await w.get('[data-test="note-text"]').trigger("mouseup");
    await w.get('[data-test="note-link-insert"]').trigger("click");
    expect(lastText(w)).toBe("first[X](https://example.com){button pi-book} line");
    w.unmount();
  });

  it("puts an icon where the caret is after the panel opened", async () => {
    const w = make("abc");
    const area = w.get('[data-test="note-text"]').element as HTMLTextAreaElement;
    area.setSelectionRange(3, 3);
    await w.get('[data-test="note-fmt-icon"]').trigger("click");
    area.setSelectionRange(1, 1);
    await w.get('[data-test="note-text"]').trigger("blur");
    await w.findAll('[data-test="note-icon-panel"] button')[2]?.trigger("click");
    expect(lastText(w)?.startsWith("a:pi-")).toBe(true);
    expect(lastText(w)?.endsWith(":bc")).toBe(true);
    w.unmount();
  });
});

describe("NoteMarkdown link colours", () => {
  it("draws a coloured button and a coloured text link, and leaves plain links on the tone", () => {
    const w = mount(NoteMarkdown, {
      props: { text: "[Go](https://x.y){button pi-play #e11d48} [Read](https://x.y){#22c55e} [Plain](https://x.y)" },
    });
    const links = w.findAll("a");
    expect(links[0]?.classes()).toContain("wp-note-md__btn");
    expect((links[0]?.element as HTMLElement).style.getPropertyValue("--wp-note-link")).toBe("#e11d48");
    expect(links[1]?.classes()).toContain("wp-note-md__link--color");
    expect((links[1]?.element as HTMLElement).style.getPropertyValue("--wp-note-link")).toBe("#22c55e");
    expect(links[2]?.classes()).not.toContain("wp-note-md__link--color");
    expect(w.text()).not.toContain("{");
    w.unmount();
  });
});
