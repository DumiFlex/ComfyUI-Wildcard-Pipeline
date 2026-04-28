import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import HistoryPanel from "../components/HistoryPanel.vue";
import type { ModuleHistoryEntry } from "../api/types";

function makeEntry(overrides: Partial<ModuleHistoryEntry> = {}): ModuleHistoryEntry {
  return {
    saved_at: "2025-04-26T12:00:00Z",
    name: "snapshot",
    description: "",
    category_id: null,
    tags: [],
    payload: { foo: 1 },
    ...overrides,
  };
}

describe("HistoryPanel.vue", () => {
  it("does not render when closed", () => {
    const wrap = mount(HistoryPanel, {
      props: { open: false, entries: [] },
      global: { plugins: [] },
      attachTo: document.body,
    });
    // Teleport puts the contents on body when open=true; closed = nothing.
    expect(document.body.querySelector('[data-test="history-panel"]')).toBeNull();
    wrap.unmount();
  });

  it("renders empty state when no entries", async () => {
    const wrap = mount(HistoryPanel, {
      props: { open: true, entries: [] },
      global: { plugins: [] },
      attachTo: document.body,
    });
    const empty = document.body.querySelector('[data-test="history-empty"]');
    expect(empty).not.toBeNull();
    expect(empty?.textContent ?? "").toMatch(/No previous versions/);
    wrap.unmount();
  });

  it("renders entries newest-first and emits restore on click", async () => {
    const entries: ModuleHistoryEntry[] = [
      makeEntry({ name: "older", saved_at: "2025-04-20T00:00:00Z" }),
      makeEntry({ name: "newer", saved_at: "2025-04-26T12:00:00Z" }),
    ];
    const wrap = mount(HistoryPanel, {
      props: { open: true, entries },
      global: { plugins: [] },
      attachTo: document.body,
    });
    const list = document.body.querySelector('[data-test="history-list"]');
    expect(list).not.toBeNull();
    const items = document.body.querySelectorAll('[data-test^="history-entry-"]');
    expect(items).toHaveLength(2);
    // First displayed item is newest.
    expect(items[0].textContent ?? "").toContain("newer");
    expect(items[1].textContent ?? "").toContain("older");

    const restoreBtn = document.body.querySelector(
      '[data-test="history-restore-0"]',
    ) as HTMLElement | null;
    expect(restoreBtn).not.toBeNull();
    restoreBtn?.click();
    const restoreEvents = wrap.emitted("restore");
    expect(restoreEvents).toBeTruthy();
    expect((restoreEvents?.[0]?.[0] as ModuleHistoryEntry).name).toBe("newer");
    wrap.unmount();
  });

  it("emits update:open=false when close button clicked", async () => {
    const wrap = mount(HistoryPanel, {
      props: { open: true, entries: [makeEntry()] },
      global: { plugins: [] },
      attachTo: document.body,
    });
    const closeBtn = document.body.querySelector(
      '[data-test="history-close"]',
    ) as HTMLElement | null;
    closeBtn?.click();
    expect(wrap.emitted("update:open")?.[0]).toEqual([false]);
    wrap.unmount();
  });
});
