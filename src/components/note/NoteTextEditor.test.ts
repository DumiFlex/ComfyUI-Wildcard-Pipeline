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
    await w.get('[data-test="icon-picker-cog"]').trigger("click");
    expect(lastText(w)).toBe("a:pi-cog:bc");
    w.unmount();
  });

  it("offers every glyph with a search box and no None when inserting an icon", async () => {
    const w = make("");
    await w.get('[data-test="note-fmt-icon"]').trigger("click");
    const panel = w.get('[data-test="note-icon-panel"]');
    expect(panel.find('[data-test="icon-picker-none"]').exists()).toBe(false);
    const before = panel.findAll('[data-test^="icon-picker-"][role="option"]').length;
    expect(before).toBeGreaterThan(200);
    await panel.get('input[aria-label="Search icons"]').setValue("arrow right");
    const shown = panel.findAll('[role="option"]').map((b) => b.attributes("data-test"));
    expect(shown).toContain("icon-picker-arrow-right");
    expect(shown.length).toBeLessThan(before);
    w.unmount();
  });

  it("lets a link button go without an icon (None)", async () => {
    const w = make("");
    await w.get('[data-test="note-fmt-link"]').trigger("click");
    await w.get('[data-test="note-link-icon"]').trigger("click");
    await w.get('[data-test="note-link-icons"] [data-test="icon-picker-none"]').trigger("click");
    expect(w.find('[data-test="note-link-icons"]').exists()).toBe(false);
    expect(w.get('[data-test="note-link-icon"]').text()).toContain("No icon");
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
