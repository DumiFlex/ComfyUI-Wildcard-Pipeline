import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import NoteWidget from "./NoteWidget.vue";
import { defaultNoteConfig, type NoteConfig } from "../../extension/note";
import { defaultBookmarkConfig, jumpFields } from "../../extension/bookmarks";

function make(config: Partial<NoteConfig> = {}) {
  return mount(NoteWidget, {
    props: {
      config: { ...defaultNoteConfig(), ...config },
      title: "Read me",
      pinned: false,
      editing: true,
      getKeymap: () => [],
      getZoom: () => 1,
      getView: () => ({ x: 0, y: 0 }),
      freshJump: () => jumpFields(defaultBookmarkConfig()),
    },
    attachTo: document.body,
  });
}
function lastConfig(w: ReturnType<typeof make>): NoteConfig | undefined {
  const calls = w.emitted("update:config") as NoteConfig[][] | undefined;
  return calls?.[calls.length - 1]?.[0];
}

afterEach(() => { document.body.innerHTML = ""; });

describe("NoteWidget edit form", () => {
  it("keeps the text out of the node: a summary and a button that opens the text window", async () => {
    const w = make({ text: "## Step one\nLoad the model.\n" });
    expect(w.find('[data-test="note-text"]').exists()).toBe(false);
    expect(w.get('[data-test="note-text-summary"]').text()).toContain("Step one");
    expect(w.get('[data-test="note-text-summary"]').text()).toContain("2 lines");
    await w.get('[data-test="note-text-edit"]').trigger("click");
    await flushPromises();
    await vi.dynamicImportSettled();
    await flushPromises();
    expect(document.body.querySelector('[data-test="note-text-window"]')).not.toBeNull();
    w.unmount();
  });

  it("writes the window's text on Done and drops pictures the text no longer names", async () => {
    const pic = { src: "data:image/png;base64,AAAA", w: 1, h: 1 };
    const w = make({ text: "![a](wp:image/p1)", images: { p1: pic } as NoteConfig["images"] });
    await w.get('[data-test="note-text-edit"]').trigger("click");
    await flushPromises();
    await vi.dynamicImportSettled();
    await flushPromises();
    const area = document.body.querySelector<HTMLTextAreaElement>('[data-test="note-text"]');
    if (!area) throw new Error("no text box");
    area.value = "No pictures now.";
    area.dispatchEvent(new Event("input", { bubbles: true }));
    await flushPromises();
    document.body.querySelector<HTMLElement>('[data-test="node-edit-done"]')?.click();
    await flushPromises();
    expect(lastConfig(w)?.text).toBe("No pictures now.");
    expect(lastConfig(w)?.images).toEqual({});
    expect(document.body.querySelector('[data-test="note-text-window"]')).toBeNull();
    w.unmount();
  });

  it("lets the form's background through so the note drags while open", () => {
    const w = make({ bookmark: jumpFields(defaultBookmarkConfig()) });
    const form = w.get('[data-test="note-form"]').element;
    expect(form.classList.contains("wp-frameless__pass")).toBe(true);
    const parts = [...form.querySelectorAll(".wp-frameless__pass")];
    expect(parts.length).toBeGreaterThan(5);
    for (const p of parts) expect(p.parentElement?.classList.contains("wp-frameless__pass"), p.className).toBe(true);
    w.unmount();
  });
});
