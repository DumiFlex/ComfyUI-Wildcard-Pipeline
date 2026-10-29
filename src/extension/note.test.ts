import { describe, expect, it } from "vitest";
import { DOC_PAGES } from "../manager/docs/registry";
import { NOTE_DOC_PAGES, defaultNoteConfig, docUrl, parseNoteConfig } from "./note";

describe("WP Note config", () => {
  it("links only to docs pages that exist", () => {
    const ids = new Set(DOC_PAGES.map((p) => p.id));
    for (const p of NOTE_DOC_PAGES) expect(ids.has(p.id), p.id).toBe(true);
  });

  it("falls back per field on broken input", () => {
    expect(parseNoteConfig("")).toEqual(defaultNoteConfig());
    expect(parseNoteConfig("{oops")).toEqual(defaultNoteConfig());
    expect(parseNoteConfig({ tone: "loud", look: "label", step: 250, text: 3, doc: "nope" }))
      .toEqual({ version: 1, tone: "step", look: "label", step: 99, text: "", doc: "" });
    expect(parseNoteConfig(JSON.stringify({ tone: "tip", step: 0.4, text: "hi", doc: "bundles" })))
      .toEqual({ version: 1, tone: "tip", look: "card", step: 1, text: "hi", doc: "bundles" });
  });

  it("builds the docs URL on the given origin", () => {
    expect(docUrl("wp-context", "http://x:8188")).toBe("http://x:8188/wp/docs/wp-context");
  });
});
