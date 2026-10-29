import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import BookmarkWidget from "./BookmarkWidget.vue";
import { defaultBookmarkConfig, type BookmarkConfig, type KeyOwner } from "../../extension/bookmarks";

function make(config: Partial<BookmarkConfig> = {}, keymap: KeyOwner[] = []) {
  return mount(BookmarkWidget, {
    props: {
      config: { ...defaultBookmarkConfig(), ...config },
      title: "Sampler",
      disabled: false,
      nested: false,
      getKeymap: () => keymap,
      getZoom: () => 0.75,
    },
    attachTo: document.body,
  });
}

function last<T>(list: readonly T[] | undefined): T | undefined {
  return list?.[list.length - 1];
}

function lastConfig(w: ReturnType<typeof make>): BookmarkConfig | undefined {
  const calls = w.emitted("update:config") as BookmarkConfig[][] | undefined;
  return last(calls)?.[0];
}

const key = (init: KeyboardEventInit): void => {
  window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
};

describe("BookmarkWidget", () => {
  it("records a shortcut, skipping lone modifiers", async () => {
    const w = make();
    await w.get('[data-test="bm-record"]').trigger("click");
    expect(w.emitted("recording")?.[0]).toEqual([true]);
    key({ key: "Alt", code: "AltLeft", altKey: true });
    expect(lastConfig(w)).toBeUndefined();
    key({ key: "k", code: "KeyK", altKey: true });
    expect(lastConfig(w)?.shortcut).toBe("Alt+K");
    expect(last(w.emitted("recording"))).toEqual([false]);
    w.unmount();
  });

  it("refuses a browser key and keeps listening", async () => {
    const w = make();
    await w.get('[data-test="bm-record"]').trigger("click");
    key({ key: "t", code: "KeyT", ctrlKey: true });
    await w.vm.$nextTick();
    expect(lastConfig(w)).toBeUndefined();
    expect(w.get('[data-test="bm-refused"]').text()).toContain("Ctrl+T");
    key({ key: "Escape", code: "Escape" });
    expect(last(w.emitted("recording"))).toEqual([false]);
    w.unmount();
  });

  it("names who else holds the combo", () => {
    const w = make({ shortcut: "Ctrl+S" }, [{ combo: "Ctrl+S", label: "Save workflow", source: "ComfyUI" }]);
    expect(w.get('[data-test="bm-conflicts"]').text()).toContain("Save workflow (ComfyUI)");
    w.unmount();
  });

  it("picks the anchor, takes the current zoom and suggests a free key", async () => {
    const w = make({}, [{ combo: "Alt+1", label: "x", source: "y" }]);
    await w.get('[data-test="bm-anchor-br"]').trigger("click");
    expect(lastConfig(w)?.anchor).toBe("br");
    await w.get('[data-test="bm-zoom-now"]').trigger("click");
    expect(lastConfig(w)?.zoom).toBe(0.75);
    await w.get('[data-test="bm-suggest"]').trigger("click");
    expect(lastConfig(w)?.shortcut).toBe("Alt+2");
    w.unmount();
  });
});
