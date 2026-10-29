import { describe, expect, it } from "vitest";
import {
  BOOKMARK_ANCHORS,
  comboFromEvent,
  defaultBookmarkConfig,
  findConflicts,
  jumpOffset,
  jumpScale,
  normalizeCombo,
  parseBookmarkConfig,
  sortBookmarks,
  suggestFreeCombo,
  type KeyOwner,
} from "./bookmarks";

describe("WP Bookmark config", () => {
  it("falls back per field on broken input", () => {
    expect(parseBookmarkConfig("")).toEqual(defaultBookmarkConfig());
    expect(parseBookmarkConfig("{oops")).toEqual(defaultBookmarkConfig());
    expect(parseBookmarkConfig({
      anchor: "middle", zoomMode: "warp", zoom: 99, shortcut: "alt + k",
      color: "red", icon: "<b>", hidden: "yes", order: 2.6,
    })).toEqual({
      ...defaultBookmarkConfig(), zoom: 10, shortcut: "Alt+K", order: 3,
    });
    expect(parseBookmarkConfig(JSON.stringify({ anchor: "br", zoomMode: "keep", zoom: 0.01, color: "#AABBCC", hidden: true })))
      .toEqual({ ...defaultBookmarkConfig(), anchor: "br", zoomMode: "keep", zoom: 0.1, color: "#aabbcc", hidden: true });
  });
});

describe("jump maths", () => {
  const rect = [100, 200, 300, 100] as const;
  const viewport = [1000, 800] as const;

  // Screen position of canvas point p after the jump.
  const screen = (p: number, off: number, s: number) => (p + off) * s;

  it("puts each anchor point of the bookmark on the same spot of the screen", () => {
    for (const a of BOOKMARK_ANCHORS) {
      for (const scale of [0.5, 1, 2]) {
        const [ox, oy] = jumpOffset({ rect, viewport, anchor: a.id, scale, margin: 20 });
        const px = rect[0] + a.fx * rect[2];
        const py = rect[1] + a.fy * rect[3];
        expect(screen(px, ox, scale)).toBeCloseTo(20 + a.fx * (1000 - 40));
        expect(screen(py, oy, scale)).toBeCloseTo(20 + a.fy * (800 - 40));
      }
    }
  });

  it("matches rgthree's top-left placement at the default anchor", () => {
    const [ox, oy] = jumpOffset({ rect, viewport, anchor: "tl", scale: 1, margin: 0 });
    expect([ox, oy]).toEqual([-100, -200]);
  });

  it("lands beside the dock, not under it", () => {
    const [ox] = jumpOffset({ rect, viewport, anchor: "tl", scale: 1, margin: 20, inset: [300, 0] });
    expect(screen(rect[0], ox, 1)).toBeCloseTo(320);
    const [rx] = jumpOffset({ rect, viewport, anchor: "tr", scale: 1, margin: 20, inset: [0, 300] });
    expect(screen(rect[0] + rect[2], rx, 1)).toBeCloseTo(1000 - 300 - 20);
    const [cx] = jumpOffset({ rect, viewport, anchor: "c", scale: 1, margin: 20, inset: [300, 0] });
    expect(screen(rect[0] + rect[2] / 2, cx, 1)).toBeCloseTo(320 + (1000 - 300 - 40) / 2);
  });

  it("keeps or sets the zoom", () => {
    expect(jumpScale({ ...defaultBookmarkConfig(), zoom: 1.5 }, 0.7)).toBe(1.5);
    expect(jumpScale({ ...defaultBookmarkConfig(), zoomMode: "keep", zoom: 1.5 }, 0.7)).toBe(0.7);
  });
});

describe("shortcut combos", () => {
  it("normalises typed and recorded combos the same way", () => {
    expect(normalizeCombo("shift + ctrl + k")).toBe("Ctrl+Shift+K");
    expect(normalizeCombo("Cmd+1")).toBe("Ctrl+1");
    expect(normalizeCombo("Alt")).toBe("");
    expect(comboFromEvent({ key: "!", code: "Digit1", shiftKey: true })).toBe("Shift+1");
    expect(comboFromEvent({ key: "˚", code: "KeyK", altKey: true })).toBe("Alt+K");
    expect(comboFromEvent({ key: "F2", code: "F2", metaKey: true })).toBe("Ctrl+F2");
    expect(comboFromEvent({ key: "Shift", code: "ShiftLeft", shiftKey: true })).toBe("");
  });

  const owners: KeyOwner[] = [
    { combo: "Ctrl+S", label: "Save workflow", source: "ComfyUI" },
    { combo: "Alt+1", label: "Go to Prompt", source: "WP Bookmark" },
    { combo: "Alt+1", label: "Go to Prompt", source: "WP Bookmark" },
  ];

  it("names every owner of a combo once and refuses browser keys", () => {
    expect(findConflicts("Ctrl+S", owners)).toEqual([{ severity: "warning", message: "Also Save workflow (ComfyUI)." }]);
    expect(findConflicts("Alt+1", owners)).toHaveLength(1);
    expect(findConflicts("Ctrl+T", [])[0]?.severity).toBe("error");
    expect(findConflicts("Ctrl+2", [])[0]?.severity).toBe("error");
    expect(findConflicts("K", []).map((c) => c.severity)).toEqual(["info"]);
    expect(findConflicts("Alt+9", [])).toEqual([]);
    expect(findConflicts("", owners)).toEqual([]);
  });

  it("suggests the first free combo", () => {
    expect(suggestFreeCombo(owners)).toBe("Alt+2");
    expect(suggestFreeCombo([])).toBe("Alt+1");
  });
});

describe("dock order", () => {
  it("sorts by order, then title", () => {
    const e = (title: string, order: number) => ({ title, config: { ...defaultBookmarkConfig(), order } });
    expect(sortBookmarks([e("b", 1), e("c", 0), e("a", 1)]).map((x) => x.title)).toEqual(["c", "a", "b"]);
  });
});
