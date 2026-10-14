import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AiSelectionChip from "../AiSelectionChip.vue";
import { _resetAiChatForTests, useAiChat } from "../../../composables/useAiChat";
import { useUiStore } from "../../../stores/uiStore";
import { askableSelection, explainPrompt } from "../../../composables/useSelectionAsk";

vi.mock("../../../composables/useAiConfig", async () => {
  const { computed } = await import("vue");
  const ready = computed(() => true);
  return { useAiConfig: () => ({ ready }), _resetAiConfigForTests: () => {} };
});

function select(el: Node): void {
  const range = document.createRange();
  range.selectNodeContents(el);
  // jsdom has no layout: give the range a box.
  range.getBoundingClientRect = () => ({ top: 200, bottom: 216, left: 100, right: 300, width: 200, height: 16, x: 100, y: 200, toJSON: () => ({}) });
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
  document.dispatchEvent(new Event("selectionchange"));
}

describe("AiSelectionChip", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setActivePinia(createPinia());
    _resetAiChatForTests();
    document.body.innerHTML = "";
  });
  afterEach(() => {
    vi.useRealTimers();
    window.getSelection()?.removeAllRanges();
  });

  it("offers Explain over selected page text and sends it", async () => {
    const p = document.createElement("p");
    p.textContent = "Constraints re-weight a target   wildcard.";
    document.body.appendChild(p);
    const w = mount(AiSelectionChip, { attachTo: document.body });
    select(p);
    vi.advanceTimersByTime(200);
    await flushPromises();
    const chip = document.querySelector('[data-test="ai-selection-chip"]');
    expect(chip?.getAttribute("role")).toBe("toolbar");
    (document.querySelector('[data-test="ai-selection-explain"]') as HTMLButtonElement).click();
    await flushPromises();
    const chat = useAiChat();
    expect(chat.open.value).toBe(true);
    expect(chat.queued.value).toBe(explainPrompt("Constraints re-weight a target wildcard."));
    expect(document.querySelector('[data-test="ai-selection-chip"]')).toBeNull();
    w.unmount();
  });

  it("stays away from text boxes and can be turned off", async () => {
    const box = document.createElement("textarea");
    box.value = "my own prompt text";
    document.body.appendChild(box);
    const w = mount(AiSelectionChip, { attachTo: document.body });
    select(box);
    vi.advanceTimersByTime(200);
    await flushPromises();
    expect(document.querySelector('[data-test="ai-selection-chip"]')).toBeNull();

    const p = document.createElement("p");
    p.textContent = "Some docs text";
    document.body.appendChild(p);
    useUiStore().setExplainChip(false);
    select(p);
    vi.advanceTimersByTime(200);
    await flushPromises();
    expect(document.querySelector('[data-test="ai-selection-chip"]')).toBeNull();
    useUiStore().setExplainChip(true);
    w.unmount();
  });

  it("explains the selection on Ctrl+Shift+X", async () => {
    const p = document.createElement("p");
    p.textContent = "Hold keeps a pick for the run";
    document.body.appendChild(p);
    const w = mount(AiSelectionChip, { attachTo: document.body });
    select(p);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "X", ctrlKey: true, shiftKey: true }));
    await flushPromises();
    expect(useAiChat().queued.value).toBe(explainPrompt("Hold keeps a pick for the run"));
    w.unmount();
  });

  it("cuts long selections and ignores tiny ones", () => {
    expect(explainPrompt("a".repeat(700))).toContain(`${"a".repeat(600)}…"`);
    const p = document.createElement("p");
    p.textContent = "a";
    document.body.appendChild(p);
    select(p);
    expect(askableSelection()).toBe("");
  });
});
