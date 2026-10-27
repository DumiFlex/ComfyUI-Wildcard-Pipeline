import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import AiCardView from "../AiCardView.vue";
import type { CardView, OptionDiffRow } from "../../../composables/card-views/types";

const row = (r: Partial<OptionDiffRow>): OptionDiffRow => ({
  id: "x", change: "same", text: "", wasText: null, empty: false, share: 25, wasShare: 25, weight: 1,
  wasWeight: null, tags: [], negative: "", wasNegative: null, fallback: false, wasFallback: null, ...r,
});

describe("change card views", () => {
  const options: CardView = {
    kind: "options", before: 4, after: 4, same: 1, fields: [],
    rows: [
      row({ id: "a", text: "rain" }),
      row({ id: "b", change: "removed", text: "snow", wasShare: null, share: 20 }),
      row({ id: "c", change: "changed", text: "thick fog", wasText: "fog", wasShare: 40, share: 25, wasWeight: 2, wasNegative: "blur" }),
      row({ id: "e", change: "added", text: "hail", wasShare: null, tags: [{ tag: "cold", change: "added" }] }),
    ],
  };

  it("draws an option diff with the unchanged ones folded", () => {
    const w = mount(AiCardView, { props: { view: options } });
    const rows = w.findAll('[data-test="ai-card-option-row"]');
    expect(rows.map((r) => r.attributes("data-change"))).toEqual(["removed", "changed", "added"]);
    expect(w.get('[data-test="ai-card-unchanged"]').text()).toContain("1 unchanged");
    expect(rows[1].text()).toContain("fog");
    expect(rows[1].text()).toContain("thick fog");
    expect(rows[1].text()).toMatch(/40%\s*→\s*25%/);
    expect(rows[1].text()).toContain("Negative");
    expect(rows[2].text()).toContain("#cold");
  });

  it("lists the unchanged options too in the magnifier", () => {
    const w = mount(AiCardView, { props: { view: options, full: true } });
    expect(w.findAll('[data-test="ai-card-option-row"]')).toHaveLength(4);
    expect(w.find('[data-test="ai-card-unchanged"]').exists()).toBe(false);
  });

  it("caps a long option diff in the chat", () => {
    const many: CardView = { ...options, rows: Array.from({ length: 11 }, (_, i) => row({ id: `n${i}`, change: "added", text: `o${i}`, wasShare: null })) };
    const w = mount(AiCardView, { props: { view: many } });
    expect(w.findAll('[data-test="ai-card-option-row"]')).toHaveLength(8);
    expect(w.get('[data-test="ai-card-more"]').text()).toBe("+3 more changes");
  });

  it("draws a category move as chip → chip", () => {
    const w = mount(AiCardView, { props: { view: { kind: "info", rows: [
      { field: "category", label: "Category", from: { name: "Scenes", color: "#f00", icon: null },
        to: { name: "Sky", color: "#0af", icon: "cloud", isNew: true } },
      { field: "text", label: "Description", from: "", to: "Clouds" },
    ] } } });
    const chips = w.findAll(".wp-chip");
    expect(chips.map((c) => c.text())).toEqual(["Scenes", "Sky"]);
    expect(chips[1].find(".pi-cloud").exists()).toBe(true);
    expect(w.text()).toContain("new");
    expect(w.text()).toMatch(/none\s*→\s*Clouds/);
  });

  it("draws categories, tags and bulk cards", () => {
    const cats = mount(AiCardView, { props: { view: { kind: "categories",
      create: [{ name: "Sky", color: "#0af", icon: null, isNew: true }],
      rename: [{ from: { name: "Sceens", color: null, icon: null }, to: { name: "Scenes", color: null, icon: null } }],
      restyle: [] } } });
    expect(cats.text()).toContain("New");
    expect(cats.findAll(".wp-chip").map((c) => c.text())).toEqual(["Sky", "Sceens", "Scenes"]);

    const tags = mount(AiCardView, { props: { view: { kind: "tags", rows: [{ from: "charcter", to: "character", merge: true, count: 3 }] } } });
    expect(tags.text()).toMatch(/#charcter\s*→\s*#character/);
    expect(tags.text()).toContain("merges into the existing tag · 3 items");

    const bulk = mount(AiCardView, { props: { view: { kind: "bulk", rows: Array.from({ length: 8 }, (_, i) => ({
      name: `Item ${i}`, itemKind: "module", changes: [{ field: "rating" as const, label: "Rating", from: "Safe", to: "NSFW" }],
    })) } } });
    expect(bulk.findAll(".wp-ai-bulk__item")).toHaveLength(6);
    expect(bulk.get('[data-test="ai-card-more"]').text()).toBe("+2 more items");
  });
});

describe("rule change views", () => {
  it("draws a derivation change with the untouched rules folded", () => {
    const view: CardView = {
      kind: "derivation", ruleChanges: ["changed", "same"],
      rules: [
        [
          { key: "IF", test: '$season is "snow"', wasTest: '$season is "winter"', actions: ['set $mood to "cozy"'], change: "changed",
            acts: [{ text: 'set $mood to "cozy"', change: "same" }, { text: 'set $light to "dim"', change: "added" }] },
          { key: "ELSE", test: "", actions: ['set $mood to "calm"'], change: "removed" },
        ],
        [{ key: "IF", test: '$season is "rain"', actions: ['set $mood to "wet"'], change: "same" }],
      ],
    };
    const w = mount(AiCardView, { props: { view } });
    expect(w.findAll('[data-test="ai-card-rule"]')).toHaveLength(1);
    expect(w.get('[data-test="ai-card-unchanged"]').text()).toBe("1 rule unchanged");
    const branches = w.findAll('[data-test="ai-card-branch"]');
    expect(branches.map((b) => b.attributes("data-change"))).toEqual(["changed", "removed"]);
    expect(branches[0].text()).toContain('"winter"');
    expect(branches[0].find('li[data-change="added"]').text()).toContain("$light");
    const full = mount(AiCardView, { props: { view, full: true } });
    expect(full.findAll('[data-test="ai-card-rule"]')).toHaveLength(2);
  });

  it("marks changed grid cells and shows only changed exception rows", () => {
    const view: CardView = {
      kind: "constraint", source: "Season", target: "Outfit", reach: "", same: 2,
      fields: [{ field: "text", label: "Reaches", from: "every use after it", to: "the next 2" }],
      rows: [
        { from: "#cold", to: "#light", byTag: true, effect: "reduce", factor: 0.5, change: "changed", was: { effect: "exclude", factor: null } },
        { from: "#cold", to: "#warm", byTag: true, effect: "boost", factor: 2, change: "same", was: null },
        { from: "#hot", to: "#light", byTag: true, effect: "boost", factor: 3, change: "added", was: null },
        { from: "#hot", to: "#warm", byTag: true, effect: "exclude", factor: null, change: "removed", was: null },
        { from: "snow", to: "sandals", byTag: false, effect: "exclude", factor: null, change: "same", was: null },
        { from: "sun", to: "boots", byTag: false, effect: "exclude", factor: null, change: "added", was: null },
      ],
    };
    const w = mount(AiCardView, { props: { view } });
    const cells = w.get('[data-test="ai-card-matrix"]').findAll("tbody td");
    expect(cells.map((c) => c.attributes("data-change"))).toEqual(["changed", "same", "added", "removed"]);
    expect(cells[0].text()).toMatch(/never\s*×0.5/);
    expect(cells[0].attributes("title")).toBe("never → less likely ×0.5");
    expect(w.findAll('[data-test="ai-card-rule-row"]').map((r) => r.text())).toEqual([expect.stringContaining("sun")]);
    expect(w.get('[data-test="ai-card-unchanged"]').text()).toBe("1 rule unchanged");
    expect(w.text()).toContain("the next 2");
  });

  it("draws a bundle change as its ordered list", () => {
    const row = (name: string, change: "same" | "added" | "removed" | "changed" | "moved", extra = {}) =>
      ({ name, type: "wildcard", change, at: 1, wasAt: null, enabled: true, wasEnabled: null, use: "", wasUse: null, ...extra });
    const view: CardView = { kind: "bundle", before: 4, after: 4, same: 1, rows: [
      row("Season", "same"), row("Shoes", "changed", { enabled: false, wasEnabled: true }),
      row("Outfit", "moved", { at: 3, wasAt: 2 }), row("Old", "removed"), row("Hat", "added", { use: "pick 2-3" }),
    ] };
    const w = mount(AiCardView, { props: { view } });
    const rows = w.findAll('[data-test="ai-card-bundle-row"]');
    expect(rows.map((r) => r.attributes("data-change"))).toEqual(["changed", "moved", "removed", "added"]);
    expect(rows[0].text()).toMatch(/on\s*→\s*off/);
    expect(rows[1].text()).toContain("moved from 2");
    expect(rows[3].text()).toContain("pick 2-3");
    expect(w.get('[data-test="ai-card-unchanged"]').text()).toContain("1 unchanged");
  });
});

describe("value and text change views", () => {
  it("draws fixed values as a table with the changed rows marked", () => {
    const view: CardView = { kind: "values", same: 1, rows: [
      { name: "quality", value: "masterpiece, best quality", negative: "lowres", change: "changed", wasValue: "masterpiece", wasName: null, wasNegative: null },
      { name: "style", value: "flat", negative: "", change: "same" },
      { name: "lens", value: "85mm", negative: "fisheye", change: "added" },
    ] };
    const w = mount(AiCardView, { props: { view } });
    expect(w.findAll("thead th").map((t) => t.text())).toEqual(["", "Variable", "Value", "Negative"]);
    const rows = w.findAll('[data-test="ai-card-value-row"]');
    expect(rows.map((r) => r.attributes("data-change"))).toEqual(["changed", "added"]);
    expect(rows[0].text()).toMatch(/masterpiece\s*→\s*masterpiece, best quality/);
    expect(w.get('[data-test="ai-card-unchanged"]').text()).toBe("1 value unchanged");
    // A create card's table has no change column.
    const create = mount(AiCardView, { props: { view: { kind: "values", rows: [{ name: "a", value: "b", negative: "" }] } } });
    expect(create.findAll("thead th").map((t) => t.text())).toEqual(["Variable", "Value"]);
  });

  it("draws a text change word by word with the variables it reads", () => {
    const w = mount(AiCardView, { props: { view: {
      kind: "text-diff", reads: { added: ["mood"], removed: ["season"] },
      rows: [{ label: "Prompt", parts: [{ text: "$quality, ", change: "same" }, { text: "$season", change: "removed" }, { text: "$mood", change: "added" }] }],
    } } });
    expect(w.findAll(".wp-ai-textdiff__part").map((p) => p.attributes("data-change"))).toEqual(["same", "removed", "added"]);
    expect(w.get('[data-test="ai-card-reads"]').text()).toMatch(/Now reads\s*\$mood\s*·\s*No longer reads\s*\$season/);
  });

  it("draws what a delete removes as library rows", () => {
    const w = mount(AiCardView, { props: { view: {
      kind: "delete",
      items: [{ name: "Lorem", type: "wildcard", category: { name: "Scenes", color: "#0af", icon: null }, rating: "NSFW" }],
      categories: [{ name: "Old", color: null, icon: null, count: 0 }],
      tags: [{ tag: "misc", count: 3 }],
    } } });
    const item = w.get('[data-test="ai-card-delete-item"]');
    expect(item.text()).toContain("Lorem");
    expect(item.find(".wp-chip").text()).toBe("Scenes");
    expect(item.text()).toContain("NSFW");
    expect(w.text()).toContain("empty");
    expect(w.text()).toContain("off 3 items");
    expect(w.text()).toContain("Undo makes them again");
  });
});
