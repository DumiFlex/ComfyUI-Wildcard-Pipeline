import { describe, expect, it } from "vitest";
import { DOC_PAGES } from "../manager/docs/registry";
import CATALOG from "./docs-catalog.json";
import { defaultNoteConfig, parseNoteConfig } from "./note";

describe("WP Note config", () => {
  it("falls back per field on broken input", () => {
    expect(parseNoteConfig("")).toEqual(defaultNoteConfig());
    expect(parseNoteConfig("{oops")).toEqual(defaultNoteConfig());
    expect(parseNoteConfig({ tone: "loud", look: "label", step: 250, text: 3 }))
      .toEqual({ version: 1, tone: "step", look: "label", step: 99, icon: "lightbulb", text: "", color: "", bookmark: null });
    expect(parseNoteConfig(JSON.stringify({ tone: "plain", step: 0.4, text: "hi" })))
      .toEqual({ version: 1, tone: "plain", look: "card", step: 1, icon: "lightbulb", text: "hi", color: "", bookmark: null });
  });

  it("turns the old Tip and Info tones into Icon notes that look the same", () => {
    expect(parseNoteConfig({ tone: "tip" })).toMatchObject({ tone: "icon", icon: "lightbulb", color: "tip" });
    expect(parseNoteConfig({ tone: "info", color: "#123456" })).toMatchObject({ tone: "icon", icon: "info-circle", color: "#123456" });
    expect(parseNoteConfig({ tone: "icon", icon: "star", color: "warning" })).toMatchObject({ tone: "icon", icon: "star", color: "warning" });
  });

  it("keeps a preset or a hex colour and drops anything else", () => {
    expect(parseNoteConfig({ color: "#A1B2C3" }).color).toBe("#a1b2c3");
    expect(parseNoteConfig({ color: " #abc " }).color).toBe("#abc");
    expect(parseNoteConfig({ color: "red" }).color).toBe("");
    expect(parseNoteConfig({ color: "Warning" }).color).toBe("warning");
    expect(parseNoteConfig({ color: "#12345678" }).color).toBe("");
    expect(parseNoteConfig({ color: "url(x)" }).color).toBe("");
  });

  it("moves a saved docs link into the text as a button link", () => {
    expect(parseNoteConfig({ text: "Read this.\n", doc: "wp-label-grid" }).text)
      .toBe("Read this.\n\n[WP Label & Grid docs](docs:wp-label-grid){button pi-book}");
    expect(parseNoteConfig({ text: "", doc: "quick-start" }).text)
      .toBe("[Quick start docs](docs:quick-start){button pi-book}");
    // Once it is in the text, a second load doesn't add it again.
    const once = parseNoteConfig({ text: "x", doc: "bundles" }).text;
    expect(parseNoteConfig({ text: once, doc: "bundles" }).text).toBe(once);
    expect(parseNoteConfig({ text: "x", doc: "Not an id!" }).text).toBe("x");
    expect("doc" in parseNoteConfig({ doc: "bundles" })).toBe(false);
  });

  it("has every docs page in the catalog, with section anchors", () => {
    const ids = DOC_PAGES.map((p) => p.id);
    expect(CATALOG.map((p) => p.id)).toEqual(ids);
    for (const p of CATALOG) {
      expect(p.title).toBeTruthy();
      for (const s of p.sections) expect(s.id).toMatch(/^s-[a-z0-9-]+$/);
    }
  });
});

describe("WP Note as a bookmark", () => {
  it("reads its jump settings with the bookmark's rules, or none", () => {
    expect(parseNoteConfig({}).bookmark).toBeNull();
    expect(parseNoteConfig({ bookmark: "yes" }).bookmark).toBeNull();
    expect(parseNoteConfig({ bookmark: { anchor: "c", zoom: 40, shortcut: "alt + 3", hidden: true, color: "#ffffff" } }).bookmark)
      .toEqual({ anchor: "c", zoomMode: "fixed", zoom: 10, shortcut: "Alt+3", order: 0, view: null });
  });
});
