import { afterEach, describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { ref } from "vue";
import NoteTextModal from "./NoteTextModal.vue";
import { NOTE_CONTEXTS } from "./note-actions";
import { defaultNoteConfig, type NoteConfig, type NoteImage } from "../../extension/note";

function make(text = "Hello", images: Record<string, NoteImage> = {}, more: Partial<NoteConfig> = {}, width?: number) {
  return mount(NoteTextModal, {
    props: { config: { ...defaultNoteConfig(), text, images, ...more }, title: "Read me", width },
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

  it("previews the note with the node's own settings", async () => {
    const w = make("Body", {}, { tone: "step", step: 3, look: "sticky", color: "#ff0000" }, 320);
    await flushPromises();
    const panel = $('[data-test="note-text-preview"] [data-test="note-panel"]');
    expect(panel?.classList.contains("wp-note__panel--sticky")).toBe(true);
    expect($('[data-test="note-text-preview"] [data-test="note-step"]')?.textContent).toBe("3");
    expect($('[data-test="note-text-preview"] [data-test="note-title-text"]')?.textContent).toBe("Read me");
    const card = panel?.parentElement;
    expect(card?.style.width).toBe("320px");
    expect(card?.style.getPropertyValue("--wp-note-tone")).toBe("#ff0000");
    w.unmount();
  });

  it("previews a label as its tag plus the hover card with the text", async () => {
    const w = make("**Hidden** until hover", {}, { look: "label" });
    await flushPromises();
    expect($('[data-test="note-text-preview"] .wp-note__panel--label')?.textContent).toContain("Read me");
    expect($('[data-test="note-text-preview"] .wp-note__body')).toBeNull();
    const peek = $('[data-test="note-text-preview"] [data-test="note-peek"]');
    expect(peek?.textContent).toContain("Hidden until hover");
    expect($('[data-test="note-peek-edit"]')).toBeNull();
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
