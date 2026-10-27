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
    const chips = w.findAll(".wp-cat-chip");
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
    expect(cats.findAll(".wp-cat-chip").map((c) => c.text())).toEqual(["Sky", "Sceens", "Scenes"]);

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
