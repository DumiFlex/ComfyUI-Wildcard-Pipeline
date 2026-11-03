import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import NoteTextEditor from "./NoteTextEditor.vue";
import { ref } from "vue";
import NoteMarkdown from "./note-markdown";
import { NOTE_ACTIONS, NOTE_CONTEXTS, type NoteActions } from "./note-actions";

function make(text: string) {
  return mount(NoteTextEditor, {
    props: { modelValue: text, hint: "" },
    attachTo: document.body,
    global: { provide: { [NOTE_CONTEXTS as symbol]: ref([{ value: "7", label: "WP Context · calm-fox" }]) } },
  });
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

  it("inserts a library button for the workflow, and for one Context", async () => {
    const w = make("");
    await w.get('[data-test="note-fmt-link"]').trigger("click");
    await w.get('[data-test="note-link-kind-library"]').trigger("click");
    expect(w.find('[data-test="note-link-style-text"]').exists()).toBe(false);
    await w.get('[data-test="note-link-insert"]').trigger("click");
    expect(lastText(w)).toBe("[Add this workflow's lists to my library](wp:library){button pi-download}");

    await w.get('[data-test="note-fmt-link"]').trigger("click");
    await w.get('[data-test="note-link-kind-library"]').trigger("click");
    await w.get('[data-test="note-link-scope-context"]').trigger("click");
    expect(w.get('[data-test="note-link-insert"]').attributes("disabled")).toBeDefined();
    await w.get('[data-test="note-link-context"]').setValue("7");
    await w.get('[data-test="note-link-text"]').setValue("Add the Scene lists");
    await w.get('[data-test="note-link-insert"]').trigger("click");
    expect(lastText(w)).toContain("[Add the Scene lists](wp:library#node-7){button pi-download}");
    w.unmount();
  });

  it("inserts a community pack link from a pasted address", async () => {
    const w = make("");
    await w.get('[data-test="note-fmt-link"]').trigger("click");
    await w.get('[data-test="note-link-kind-community"]').trigger("click");
    await w.get('[data-test="note-link-pack"]').setValue("https://wp.dumiflex.dev/p/dumi/fantasy");
    await w.get('[data-test="note-link-insert"]').trigger("click");
    expect(lastText(w)).toBe("[Get the pack](wp:community/dumi/fantasy){button pi-globe}");
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

describe("NoteMarkdown library button", () => {
  function draw(text: string, actions: NoteActions | null) {
    return mount(NoteMarkdown, {
      props: { text },
      global: actions ? { provide: { [NOTE_ACTIONS as symbol]: actions } } : {},
    });
  }

  it("is a real button that runs the action for its scope, with the state as its tooltip", async () => {
    const ran: string[] = [];
    const actions: NoteActions = {
      library: (node) => ({ ready: true, hint: node ? "Add 1 module from this WP Context to your library" : "Add 2 bundles from this workflow to your library" }),
      runLibrary: (node) => ran.push(node),
    };
    const w = draw("[Add all](wp:library){button} [Add one](wp:library#node-3){button pi-box}", actions);
    const buttons = w.findAll('[data-test="note-library-button"]');
    expect(buttons).toHaveLength(2);
    expect(buttons[0]?.element.tagName).toBe("BUTTON");
    expect(buttons[0]?.attributes("title")).toBe("Add 2 bundles from this workflow to your library");
    expect(buttons[0]?.find(".pi-download").exists()).toBe(true);
    expect(buttons[1]?.find(".pi-box").exists()).toBe(true);
    await buttons[0]?.trigger("click");
    await buttons[1]?.trigger("click");
    expect(ran).toEqual(["", "3"]);
    w.unmount();
  });

  it("stays off, saying why, when there is nothing to add or no canvas", async () => {
    const ran: string[] = [];
    const w = draw("[Add](wp:library)", { library: () => ({ ready: false, hint: "Already in your library" }), runLibrary: (n) => ran.push(n) });
    const b = w.get('[data-test="note-library-button"]');
    expect(b.attributes("aria-disabled")).toBe("true");
    expect(b.attributes("title")).toBe("Already in your library");
    await b.trigger("click");
    expect(ran).toEqual([]);
    w.unmount();
    const lone = draw("[Add](wp:library)", null);
    expect(lone.get('[data-test="note-library-button"]').attributes("aria-disabled")).toBe("true");
    lone.unmount();
  });

  it("opens a community pack like a link", () => {
    const w = draw("[Pack](wp:community/dumi/fantasy){button pi-globe}", null);
    expect(w.get("a").attributes("href")).toBe(`${window.location.origin}/wp/community/p/dumi/fantasy`);
    w.unmount();
  });
});
