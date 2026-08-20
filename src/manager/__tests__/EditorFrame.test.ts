import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import EditorFrame from "../components/EditorFrame.vue";
import type { ModuleHistoryEntry } from "../api/types";

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: { template: "<div/>" } },
      { path: "/wildcards", component: { template: "<div/>" } },
    ],
  });
}

function mountFrame(props: Partial<{
  title: string;
  subtitle: string;
  backRoute: string;
  backLabel: string;
  saving: boolean;
  saveDisabled: boolean;
  historyEntries: ModuleHistoryEntry[];
}> = {}) {
  return mount(EditorFrame, {
    props: {
      title: "New wildcard",
      backRoute: "/wildcards",
      backLabel: "Wildcards",
      ...props,
    },
    slots: { default: "<div data-test=\"body\">body</div>" },
    global: { plugins: [makeRouter()] },
  });
}

describe("EditorFrame.vue", () => {
  it("renders title and back link", () => {
    const wrap = mountFrame();
    expect(wrap.text()).toContain("New wildcard");
    const back = wrap.find('[data-test="editor-back"]');
    expect(back.exists()).toBe(true);
    expect(back.text()).toContain("Wildcards");
    expect(back.attributes("href")).toBe("/wildcards");
  });

  it("renders subtitle when provided", () => {
    const wrap = mountFrame({ subtitle: "Edit existing module" });
    expect(wrap.text()).toContain("Edit existing module");
  });

  it("renders the body slot", () => {
    const wrap = mountFrame();
    expect(wrap.find('[data-test="body"]').text()).toBe("body");
  });

  it("save button emits save", async () => {
    const wrap = mountFrame();
    const saveBtn = wrap.find('[data-test="save-btn"]');
    expect(saveBtn.exists()).toBe(true);
    await saveBtn.trigger("click");
    expect(wrap.emitted("save")?.length).toBe(1);
  });

  it("cancel button emits cancel", async () => {
    const wrap = mountFrame();
    const cancelBtn = wrap.find('[data-test="cancel-btn"]');
    expect(cancelBtn.exists()).toBe(true);
    await cancelBtn.trigger("click");
    expect(wrap.emitted("cancel")?.length).toBe(1);
  });

  it("history button hidden when historyEntries empty", () => {
    const wrap = mountFrame({ historyEntries: [] });
    expect(wrap.find('[data-test="history-btn"]').exists()).toBe(false);
  });

  it("history button shows count when entries present", () => {
    const entries: ModuleHistoryEntry[] = [
      { saved_at: "2025-04-26T00:00:00Z", name: "older", payload: {} },
      { saved_at: "2025-04-26T01:00:00Z", name: "newer", payload: {} },
    ];
    const wrap = mountFrame({ historyEntries: entries });
    const btn = wrap.find('[data-test="history-btn"]');
    expect(btn.exists()).toBe(true);
    expect(btn.text()).toContain("History (2)");
  });

  it("save button respects saveDisabled prop", () => {
    const wrap = mountFrame({ saveDisabled: true });
    const saveBtn = wrap.find('[data-test="save-btn"]');
    expect((saveBtn.element as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("EditorFrame.vue — failed-save auto-scroll", () => {
  it("scrolls the first error's field into view when errors first appear", async () => {
    // The offending section must exist in the DOM to be scrolled to.
    const section = document.createElement("div");
    section.id = "editor-section-options";
    const input = document.createElement("input");
    section.appendChild(input);
    document.body.appendChild(section);
    // jsdom has no scrollIntoView — define it as a spy.
    const spy = vi.fn();
    (section as unknown as { scrollIntoView: unknown }).scrollIntoView = spy;

    const wrap = mount(EditorFrame, {
      props: { title: "T", backRoute: "/wildcards", backLabel: "W", errors: [] },
      slots: { default: "<div/>" },
      global: { plugins: [makeRouter()] },
    });
    // Empty -> populated is the "tried to save while invalid" edge.
    await wrap.setProps({
      errors: [{ field: "editor-section-options", label: "Options", message: "Required" }],
    });
    await nextTick();
    expect(spy).toHaveBeenCalledOnce();

    section.remove();
  });

  it("does not re-scroll while the error list only shrinks/changes", async () => {
    const section = document.createElement("div");
    section.id = "editor-section-identity";
    document.body.appendChild(section);
    const spy = vi.fn();
    (section as unknown as { scrollIntoView: unknown }).scrollIntoView = spy;
    const err = (field: string) => ({ field, label: "X", message: "bad" });

    const wrap = mount(EditorFrame, {
      props: { title: "T", backRoute: "/wildcards", backLabel: "W",
        errors: [err("editor-section-identity"), err("editor-section-options")] },
      slots: { default: "<div/>" },
      global: { plugins: [makeRouter()] },
    });
    await nextTick();
    spy.mockClear();
    // Fixing one error keeps the list non-empty — must NOT yank the scroll.
    await wrap.setProps({ errors: [err("editor-section-identity")] });
    await nextTick();
    expect(spy).not.toHaveBeenCalled();
    section.remove();
  });
});
