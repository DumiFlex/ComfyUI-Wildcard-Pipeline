import { describe, expect, it } from "vitest";
import { loadDocsIndex, markRanges, queryWords, searchDocs, snippetFor, type IndexPage } from "../search";
import { createOutline, sectionSlug } from "../outline";
import { DOC_PAGES } from "../registry";

const PAGES: IndexPage[] = [
  { id: "wildcard", title: "Wildcard", group: "modules", blurb: "Random picks.", keywords: ["options"], sections: [
    { title: "Fallback", text: "Flag one option as the fallback. It is taken when nothing is live." },
    { title: "Weights", text: "Each option has a weight." },
  ] },
  { id: "constraint", title: "Constraint", group: "modules", blurb: "Steer one pick by another.", keywords: [], sections: [
    { title: "Only", text: "Only turns a row into a guest list. Without a fallback the target prints nothing." },
  ] },
];

describe("docs search", () => {
  it("splits the query into unique lower-case words", () => {
    expect(queryWords("  Seed, seed lock ")).toEqual(["seed", "lock"]);
  });

  it("finds a word in the text of a section, best match first", () => {
    const hits = searchDocs(PAGES, "fallback");
    expect(hits.map((h) => `${h.pageId}/${h.section}`)).toEqual(["wildcard/Fallback", "constraint/Only"]);
  });

  it("needs every word in the same section (page title counts)", () => {
    expect(searchDocs(PAGES, "fallback weight")).toEqual([]);
    expect(searchDocs(PAGES, "wildcard weight").map((h) => h.section)).toEqual(["Weights"]);
  });

  it("gives one page hit when only the page's own words match", () => {
    const hits = searchDocs(PAGES, "steer");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ pageId: "constraint", section: "" });
  });

  it("marks the words in a snippet cut around the first match", () => {
    const long = `${"word ".repeat(40)}the fallback is here ${"tail ".repeat(40)}`;
    const { snippet, marks } = snippetFor(long, ["fallback"]);
    expect(snippet.startsWith("…")).toBe(true);
    expect(snippet.endsWith("…")).toBe(true);
    expect(marks).toHaveLength(1);
    expect(snippet.slice(marks[0][0], marks[0][1])).toBe("fallback");
    expect(markRanges("seed seedling", ["seed", "seedl"])).toEqual([[0, 4], [5, 10]]);
  });

  it("searches the real docs text", async () => {
    const pages = await loadDocsIndex();
    const ids = new Set(DOC_PAGES.map((p) => p.id));
    expect(pages.filter((p) => p.id !== "settings").every((p) => ids.has(p.id))).toBe(true);
    expect(searchDocs(pages, "fallback").length).toBeGreaterThan(2);
  });
});

describe("docs outline", () => {
  it("slugs titles and keeps ids unique", () => {
    expect(sectionSlug("Inputs & outputs")).toBe("inputs-outputs");
    expect(sectionSlug("Café — ünïcode!")).toBe("cafe-unicode");
    let seen: string[] = [];
    const o = createOutline((e) => { seen = e.map((x) => x.id); });
    expect(o.add("Rules")).toBe("s-rules");
    expect(o.add("Rules")).toBe("s-rules-2");
    o.remove("s-rules");
    expect(seen).toEqual(["s-rules-2"]);
  });
});
