import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { app } from "#comfyui/app";
import BookmarkDock from "./BookmarkDock.vue";
import { bookmarkCells } from "../../extension/_stashes";
import { defaultBookmarkConfig, type BookmarkConfig } from "../../extension/bookmarks";
import { BOOKMARK_NODE_TYPE } from "../../widgets/bookmark";

function bookmark(id: number, title: string, cfg: Partial<BookmarkConfig>, graph: { _nodes: unknown[] }) {
  let config: BookmarkConfig = { ...defaultBookmarkConfig(), ...cfg };
  const node = { id, title, mode: 0, type: BOOKMARK_NODE_TYPE, graph, pos: [0, 0], size: [300, 80] };
  bookmarkCells.set(node, { get: () => config, set: (next) => { config = next as BookmarkConfig; } });
  graph._nodes.push(node);
  return node;
}

beforeEach(() => {
  const root = { _nodes: [] as unknown[] };
  bookmark(1, "Prompts", { order: 0, shortcut: "Alt+1" }, root);
  bookmark(2, "Upscale", { order: 1, hidden: true }, root);
  Object.assign(app as object, { graph: root, canvas: { graph: root, deselect: vi.fn(), setDirty: vi.fn() } });
});

describe("BookmarkDock", () => {
  it("lists and jumps in view mode, and edits behind the pencil", async () => {
    const w = mount(BookmarkDock);
    await w.vm.$nextTick();
    expect(w.findAll('[data-test^="bm-dock-row-"]')).toHaveLength(2);
    expect(w.find('[data-test^="bm-dock-eye-"]').exists()).toBe(false);
    expect(w.find(".wp-sortable__grip").exists()).toBe(false);
    expect(w.find('[data-test="bm-dock-add"]').exists()).toBe(false);

    await w.get('[data-test="bm-dock-edit"]').trigger("click");
    expect(w.findAll('[data-test^="bm-dock-eye-"]')).toHaveLength(2);
    expect(w.find(".wp-sortable__grip").exists()).toBe(true);
    expect(w.find('[data-test="bm-dock-add"]').exists()).toBe(true);
    expect(w.find('[data-test="bm-dock-back"]').exists()).toBe(false);

    await w.get('[data-test="bm-dock-eye-1"]').trigger("click");
    await w.get('[data-test="bm-dock-done"]').trigger("click");
    expect(w.find('[data-test^="bm-dock-eye-"]').exists()).toBe(false);
    w.unmount();
  });
});
