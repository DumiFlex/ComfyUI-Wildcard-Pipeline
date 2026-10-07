import { describe, it, expect, beforeEach } from "vitest";
import {
  draftEdits, dropDraftEdits, editsFor, fitTileSize, readZoomPref, saveDraftEdits, withMask, withText, writeZoomPref,
} from "./picker-state";

describe("picker edits", () => {
  it("sets a prompt on every key given and clears it when it matches the original", () => {
    let e = withText({}, ["0:0", "0:1"], "positive", "dog", "cat");
    expect(e).toEqual({ "0:0": { positive: "dog" }, "0:1": { positive: "dog" } });
    e = withText(e, ["0:0", "0:1"], "positive", "cat", "cat");
    expect(e).toEqual({});
  });

  it("an empty prompt is an edit when the original had text", () => {
    expect(withText({}, ["0:0"], "negative", "", "blurry")).toEqual({ "0:0": { negative: "" } });
    expect(withText({}, ["0:0"], "negative", "", undefined)).toEqual({});
  });

  it("masks add and clear without touching prompt edits", () => {
    let e = withMask({ "0:0": { positive: "x" } }, "0:0", "data:image/png;base64,AA");
    expect(e["0:0"]).toEqual({ positive: "x", mask: "data:image/png;base64,AA" });
    e = withMask(e, "0:0", "");
    expect(e["0:0"]).toEqual({ positive: "x" });
    expect(withMask({}, "1:0", "")).toEqual({});
  });

  it("only sends edits for images that go on", () => {
    const all = { "0:0": { positive: "a" }, "1:0": { mask: "m" } };
    expect(editsFor(all, ["1:0"])).toEqual({ "1:0": { mask: "m" } });
    expect(editsFor(all, ["2:0"])).toBeUndefined();
  });

  it("drafts outlive the modal per request", () => {
    saveDraftEdits("t", { "0:0": { positive: "a" } });
    expect(draftEdits("t")).toEqual({ "0:0": { positive: "a" } });
    dropDraftEdits("t");
    expect(draftEdits("t")).toEqual({});
  });
});

describe("zoom preference", () => {
  beforeEach(() => localStorage.clear());
  it("round-trips", () => {
    expect(readZoomPref()).toBe(false);
    writeZoomPref(true);
    expect(readZoomPref()).toBe(true);
    writeZoomPref(false);
    expect(readZoomPref()).toBe(false);
  });
});

describe("fitTileSize", () => {
  const box = { width: 1000, height: 600, gap: 10, extraW: 0, extraH: 0 };
  it("lets a few square images fill the space", () => {
    expect(fitTileSize(1, 1, box)).toBe(600);
    // 3 squares: one row of three, each (1000 - 20) / 3.
    expect(fitTileSize(3, 1, box)).toBe(327);
  });
  it("uses the images' shape: portraits are bounded by height", () => {
    // 2 portraits (h/w 1.5): side by side, 600 tall each.
    expect(fitTileSize(2, 1.5, box)).toBe(600);
  });
  it("never goes below the small tile size", () => {
    expect(fitTileSize(500, 1, box)).toBe(80);
    expect(fitTileSize(0, 1, box)).toBe(200);
  });
});
