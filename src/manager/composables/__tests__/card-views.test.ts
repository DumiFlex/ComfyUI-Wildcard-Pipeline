import { describe, expect, it } from "vitest";
import type { AiChatOp, AiChatProposal } from "../../api/types";
import { cardViews } from "../card-views";
import type { CardView } from "../card-views/types";

function card(op: unknown): AiChatProposal {
  return { pid: "p1", tool: "t", title: "T", summary: "", preview: ["line"], warnings: [], after: null, op: op as AiChatOp };
}

const opt = (id: string, value: string, extra: Record<string, unknown> = {}) =>
  ({ id, value, weight: 1, sub_categories: [], ...extra });

function wildcardEdit(before: unknown[], after: unknown[], payload: Record<string, unknown> = {}) {
  return card({
    op: "update", kind: "module", type: "wildcard", id: "m1", name: "Weather",
    body: { payload: { var_binding: "weather", options: after, ...payload } },
    before: { payload: { var_binding: "weather", options: before } },
  });
}

const find = <K extends CardView["kind"]>(views: CardView[], kind: K) =>
  views.find((v): v is Extract<CardView, { kind: K }> => v.kind === kind);
function only<K extends CardView["kind"]>(views: CardView[], kind: K): Extract<CardView, { kind: K }> {
  const v = find(views, kind);
  if (!v) throw new Error(`no ${kind} view`);
  return v;
}

describe("card views: wildcard option diff", () => {
  it("marks added, removed and changed options and folds the rest", () => {
    const views = cardViews(wildcardEdit(
      [opt("a", "rain"), opt("b", "snow"), opt("c", "fog", { weight: 2, negative: "blur" }), opt("d", "sun")],
      [opt("a", "rain"), opt("c", "thick fog", { weight: 1 }), opt("d", "sun", { sub_categories: ["warm"] }), opt("e", "hail")],
    ));
    const v = only(views, "options");
    expect(v.rows.map((r) => [r.id, r.change])).toEqual([
      ["a", "same"], ["b", "removed"], ["c", "changed"], ["d", "changed"], ["e", "added"],
    ]);
    expect(v.same).toBe(1);
    expect([v.before, v.after]).toEqual([4, 4]);
    const fog = v.rows[2];
    expect(fog.wasText).toBe("fog");
    expect(fog.text).toBe("thick fog");
    expect(fog.wasWeight).toBe(2);
    expect(fog.wasNegative).toBe("blur");
    expect(fog.negative).toBe("");
    // fog was 2 of 5 (40%), now 1 of 4 (25%).
    expect(fog.wasShare).toBeCloseTo(40);
    expect(fog.share).toBeCloseTo(25);
    expect(v.rows[3].tags).toEqual([{ tag: "warm", change: "added" }]);
    expect(v.rows[3].wasText).toBeNull();
    expect(v.rows[1].share).toBeCloseTo(20);
  });

  it("leaves a card that only adds options to its tick list", () => {
    expect(find(cardViews(wildcardEdit([opt("a", "rain")], [opt("a", "rain"), opt("b", "snow")])), "options")).toBeUndefined();
  });

  it("shows a renamed variable even beside new options", () => {
    const v = only(cardViews(wildcardEdit([opt("a", "rain")], [opt("a", "rain"), opt("b", "snow")], { var_binding: "sky" })), "options");
    expect(v.rows).toEqual([]);
    expect(v.fields).toEqual([{ field: "text", label: "Variable", from: "$weather", to: "$sky" }]);
  });

  it("marks a fallback flag that moves", () => {
    const v = only(cardViews(wildcardEdit(
      [opt("a", "rain", { fallback: true }), opt("b", "snow")],
      [opt("a", "rain"), opt("b", "snow", { fallback: true })],
    )), "options");
    expect(v.rows.map((r) => [r.fallback, r.wasFallback])).toEqual([[false, true], [true, false]]);
  });
});

describe("card views: item fields", () => {
  it("draws a category move chip → chip from the library", () => {
    const views = cardViews(card({
      op: "update", kind: "module", type: "wildcard", id: "m1", name: "Weather",
      body: { category_id: "c2", tags: ["sky", "mood"], content_rating: "nsfw" },
      before: { category_id: "c1", tags: ["sky", "old"], content_rating: "safe" },
    }), { category: (id) => ({ name: id === "c1" ? "Scenes" : "Moods", color: "#f00", icon: "star" }) });
    const v = only(views, "info");
    expect(v.rows).toEqual([
      { field: "tags", label: "Tags", tags: [
        { tag: "sky", change: "same" }, { tag: "old", change: "removed" }, { tag: "mood", change: "added" }] },
      { field: "category", label: "Category", from: { name: "Scenes", color: "#f00", icon: "star" },
        to: { name: "Moods", color: "#f00", icon: "star" } },
      { field: "rating", label: "Rating", from: "Safe", to: "NSFW" },
    ]);
  });

  it("shows a category the card makes as new, in its style", () => {
    const v = only(cardViews(card({
      op: "update", kind: "module", type: "wildcard", id: "m1", name: "W", new_category: "Sky",
      new_category_style: { color: "#0af", icon: "cloud" }, body: { category_id: null }, before: { category_id: null },
    })), "info");
    expect(v.rows[0]).toEqual({ field: "category", label: "Category", from: null,
      to: { name: "Sky", color: "#0af", icon: "cloud", isNew: true } });
  });

  it("has no view for an update that changes nothing it knows", () => {
    expect(cardViews(card({ op: "update", kind: "bundle", type: "bundle", id: "b", name: "B", body: { children: [] }, before: {} }))).toEqual([]);
  });
});

describe("card views: library cards", () => {
  it("draws categories: new ones styled, renames and restyles chip → chip", () => {
    const v = only(cardViews(card({
      op: "categories", kind: "categories", create: ["Sky"],
      rename: [{ id: "c1", from: "Sceens", to: "Scenes" }],
      styles: [
        { name: "Sky", color: "#0af", icon: "cloud" },
        { name: "Moods", id: "c2", color: "#a0f", before: { color: null, icon: "heart" } },
      ],
    }), { category: (id) => (id === "c1" ? { name: "Sceens", color: "#333", icon: null } : null) }), "categories");
    expect(v.create).toEqual([{ name: "Sky", color: "#0af", icon: "cloud", isNew: true }]);
    expect(v.rename).toEqual([{ from: { name: "Sceens", color: "#333", icon: null }, to: { name: "Scenes", color: "#333", icon: null } }]);
    expect(v.restyle).toEqual([{ from: { name: "Moods", color: null, icon: "heart" }, to: { name: "Moods", color: "#a0f", icon: "heart" } }]);
  });

  it("draws tag renames and merges with their item counts", () => {
    const v = only(cardViews(card({
      op: "tags", kind: "tags",
      rename: [{ from: "charcter", to: "character", merge: true, members: [{ kind: "module", id: "a", tags: [] }, { kind: "module", id: "b", tags: [] }] }],
    })), "tags");
    expect(v.rows).toEqual([{ from: "charcter", to: "character", merge: true, count: 2 }]);
  });

  it("draws a bulk change one row per item", () => {
    const v = only(cardViews(card({
      op: "bulk", kind: "bulk", new_category: "Sky",
      items: [
        { kind: "module", id: "a", name: "Rain", to_new: true, body: { category_id: null }, before: { category_id: "c1" } },
        { kind: "template", id: "t", name: "Portrait", body: { content_rating: "nsfw" }, before: { content_rating: "safe" } },
        { kind: "module", id: "b", name: "Same", body: { tags: ["x"] }, before: { tags: ["x"] } },
      ],
    }), { category: () => ({ name: "Scenes", color: null, icon: null }) }), "bulk");
    expect(v.rows.map((r) => r.name)).toEqual(["Rain", "Portrait"]);
    expect(v.rows[0].changes[0]).toMatchObject({ field: "category", to: { name: "Sky", isNew: true } });
    expect(v.rows[1].changes[0]).toEqual({ field: "rating", label: "Rating", from: "Safe", to: "NSFW" });
  });

  it("falls back to the lines when a builder can't read the op", () => {
    expect(cardViews(card({ op: "tags", kind: "tags", rename: null }))).toEqual([]);
  });
});
