import { afterEach, describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { ref } from "vue";
import NoteTextModal from "./NoteTextModal.vue";
import { NOTE_CONTEXTS } from "./note-actions";
import type { NoteImage } from "../../extension/note";

function make(text = "Hello", images: Record<string, NoteImage> = {}) {
  return mount(NoteTextModal, {
    props: { text, images, title: "Read me", look: "card", toneCss: "" },
    attachTo: document.body,
    global: { provide: { [NOTE_CONTEXTS as symbol]: ref([]) } },
  });
}
const $ = <T extends Element = HTMLElement>(sel: string): T | null => document.body.querySelector<T>(sel);
async function type(v: string): Promise<void> {
  const area = $<HTMLTextAreaElement>('[data-test="note-text"]');
  if (!area) throw new Error("no text box");
  area.value = v;
  area.dispatchEvent(new Event("input", { bubbles: true }));
  await flushPromises();
}
async function click(sel: string): Promise<void> {
  const el = $(sel);
  if (!el) throw new Error(`no ${sel}`);
  el.click();
  await flushPromises();
}

afterEach(() => { document.body.innerHTML = ""; });

describe("NoteTextModal", () => {
  it("shows the editor and the preview side by side, the preview following the text", async () => {
    const w = make("**Hi**");
    await flushPromises();
    expect($('[data-test="modal"]')?.textContent).toContain("Read me");
    expect($('[data-test="note-preview-toggle"]')).toBeNull();
    expect($('[data-test="note-text-preview"]')?.innerHTML).toMatch(/>Hi</);
    expect($('[data-test="note-text-preview"]')?.textContent).not.toContain("**");
    await type("# Steps");
    expect($('[data-test="note-text-preview"]')?.textContent).toContain("Steps");
    w.unmount();
  });

  it("writes the draft on Done", async () => {
    const w = make("old");
    await flushPromises();
    await type("new text");
    await click('[data-test="note-text-done"]');
    expect(w.emitted("done")?.[0]?.[0]).toEqual({ text: "new text", images: {} });
    w.unmount();
  });

  it("closes at once when nothing changed", async () => {
    const w = make();
    await flushPromises();
    await click('[data-test="note-text-cancel"]');
    expect(w.emitted("close")).toHaveLength(1);
    w.unmount();
  });

  it("asks before throwing changes away, and Keep editing keeps them", async () => {
    const w = make("old");
    await flushPromises();
    await type("changed");
    await click('[data-test="note-text-cancel"]');
    expect(w.emitted("close")).toBeUndefined();
    expect(document.body.textContent).toContain("Discard your changes?");
    const keep = [...document.body.querySelectorAll("button")].find((b) => b.textContent?.includes("Keep editing"));
    keep?.click();
    await flushPromises();
    expect(w.emitted("close")).toBeUndefined();
    expect($<HTMLTextAreaElement>('[data-test="note-text"]')?.value).toBe("changed");
    await click('[data-test="note-text-cancel"]');
    const discard = [...document.body.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Discard");
    discard?.click();
    await flushPromises();
    expect(w.emitted("close")).toHaveLength(1);
    w.unmount();
  });

  it("Escape on a changed draft asks too", async () => {
    const w = make("old");
    await flushPromises();
    await type("changed");
    $('[data-test="note-text"]')?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await flushPromises();
    expect(w.emitted("close")).toBeUndefined();
    expect(document.body.textContent).toContain("Discard your changes?");
    w.unmount();
  });

  it("Ctrl+Enter is Done", async () => {
    const w = make("old");
    await flushPromises();
    await type("via keys");
    $('[data-test="note-text"]')?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));
    await flushPromises();
    expect(w.emitted("done")?.[0]?.[0]).toEqual({ text: "via keys", images: {} });
    w.unmount();
  });
});
