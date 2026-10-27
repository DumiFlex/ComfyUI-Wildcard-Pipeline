import { describe, expect, it } from "vitest";
import type { AiChatOp, AiChatProposal } from "../../api/types";
import { cardViews } from "../card-views";
import type { CardView } from "../card-views/types";

function card(op: unknown): AiChatProposal {
  return { pid: "p1", tool: "t", title: "T", summary: "", preview: ["line"], warnings: [], after: null, op: op as AiChatOp };
}
function only<K extends CardView["kind"]>(views: CardView[], kind: K): Extract<CardView, { kind: K }> {
  const v = views.find((x): x is Extract<CardView, { kind: K }> => x.kind === kind);
  if (!v) throw new Error(`no ${kind} view`);
  return v;
}

describe("card views: fixed values diff", () => {
  it("marks each value row and what changed in it", () => {
    const v = only(cardViews(card({
      op: "update", kind: "module", type: "fixed_values", id: "f1", name: "Quality",
      before: { payload: { values: [
        { id: "v1", name: "quality", value: "masterpiece", negative: "lowres" },
        { id: "v2", name: "style", value: "flat colors" },
        { id: "v3", name: "camera", value: "35mm" },
      ] } },
      body: { payload: { values: [
        { id: "v1", name: "quality", value: "masterpiece, best quality", negative: "lowres" },
        { id: "v2", name: "look", value: "flat colors" },
        { id: "v4", name: "lens", value: "85mm", negative: "fisheye" },
      ] } },
    })), "values");
    expect(v.rows.map((r) => [r.name, r.change])).toEqual([
      ["quality", "changed"], ["look", "changed"], ["camera", "removed"], ["lens", "added"],
    ]);
    expect(v.rows[0]).toMatchObject({ wasValue: "masterpiece", wasNegative: null, wasName: null });
    expect(v.rows[1]).toMatchObject({ wasName: "style", wasValue: null });
    expect(v.same).toBe(0);
  });
});

describe("card views: text diff", () => {
  it("diffs a template's prompt and lists the variables it starts and stops reading", () => {
    const v = only(cardViews(card({
      op: "update", kind: "template", type: "template", id: "t1", name: "Walk",
      before: { template_string: "$quality, $outfit, rainy street", negative_template: "$negatives, lowres" },
      body: { template_string: "$quality, $outfit, $mood, night street", negative_template: "$negatives, lowres" },
    })), "text-diff");
    expect(v.rows.map((r) => r.label)).toEqual(["Prompt"]);
    expect(v.rows[0].parts.filter((x) => x.change !== "same").map((x) => [x.text, x.change]))
      .toEqual([["rainy", "removed"], ["$mood, night ", "added"]]);
    expect(v.reads).toEqual({ added: ["mood"], removed: [] });
  });

  it("diffs a combine's text, negative and the variable it sets", () => {
    const v = only(cardViews(card({
      op: "update", kind: "module", type: "combine", id: "k1", name: "Scene",
      before: { payload: { output_var: "scene", template: "$weather over $street", negative: "" } },
      body: { payload: { output_var: "setting", template: "$weather over $street", negative: "blurry" } },
    })), "text-diff");
    expect(v.rows.map((r) => r.label)).toEqual(["Sets", "Negative"]);
    expect(v.reads).toEqual({ added: [], removed: [] });
  });
});

describe("card views: delete", () => {
  it("lists the items with their category and rating, and the categories and tags", () => {
    const v = only(cardViews(card({
      op: "delete", kind: "delete",
      items: [{ kind: "module", type: "wildcard", id: "a", name: "Lorem", row: { category_id: "c1", content_rating: "nsfw" } },
        { kind: "bundle", type: "bundle", id: "b", name: "Pack", row: {} }],
      categories: [{ id: "c9", name: "Old", color: "#f00", icon: null, sort_order: 0, members: [{ kind: "module", id: "x" }] }],
      tags: [{ tag: "misc", members: [] }],
    }), { category: () => ({ name: "Scenes", color: null, icon: null }) }), "delete");
    expect(v.items).toEqual([
      { name: "Lorem", type: "wildcard", category: { name: "Scenes", color: null, icon: null }, rating: "NSFW" },
      { name: "Pack", type: "bundle", category: null, rating: "" },
    ]);
    expect(v.categories).toEqual([{ name: "Old", color: "#f00", icon: null, count: 1 }]);
    expect(v.tags).toEqual([{ tag: "misc", count: 0 }]);
  });
});
