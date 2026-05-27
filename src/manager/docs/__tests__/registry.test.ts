import { describe, it, expect } from "vitest";
import { DOC_GROUPS, DOC_PAGES, pagesByGroup, findPage, searchPages, toneVar } from "../registry";

describe("docs registry", () => {
  it("every page has a unique id, a known group, and a component", () => {
    const ids = new Set<string>();
    const groupIds = new Set(DOC_GROUPS.map((g) => g.id));
    for (const p of DOC_PAGES) {
      expect(ids.has(p.id), `dupe id ${p.id}`).toBe(false);
      ids.add(p.id);
      expect(groupIds.has(p.group), `bad group ${p.group}`).toBe(true);
      expect(p.component).toBeTruthy();
      expect(p.title.length).toBeGreaterThan(0);
    }
  });

  it("every group has at least one page", () => {
    for (const g of DOC_GROUPS) {
      expect(pagesByGroup(g.id).length, `empty group ${g.id}`).toBeGreaterThan(0);
    }
  });

  it("findPage resolves by id and returns undefined for unknown", () => {
    expect(findPage("introduction")?.id).toBe("introduction");
    expect(findPage("nope")).toBeUndefined();
  });

  it("searchPages matches title, blurb, and keywords case-insensitively", () => {
    const hits = searchPages("CONTEXT");
    expect(hits.some((p) => p.id === "wp-context")).toBe(true);
    expect(searchPages("").length).toBe(DOC_PAGES.length);
  });

  it("toneVar maps tones to css vars; bundle + neutral are muted", () => {
    expect(toneVar("node")).toContain("--wp-node");
    expect(toneVar("wildcard")).toContain("--wp-kind-wildcard");
    expect(toneVar("bundle")).toContain("--wp-text-muted");
    expect(toneVar("neutral")).toContain("--wp-text-muted");
  });
});
