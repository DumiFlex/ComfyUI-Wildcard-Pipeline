import { describe, expect, it } from "vitest";
import type { AiChatOp, AiChatProposal } from "../../api/types";
import { cardViews } from "../card-views";
import { useText } from "../card-views/rules";
import type { CardView } from "../card-views/types";

function card(op: unknown, names: Record<string, string> = {}): AiChatProposal {
  return { pid: "p1", tool: "t", title: "T", summary: "", preview: ["line"], warnings: [], after: null, names, op: op as AiChatOp };
}
function only<K extends CardView["kind"]>(views: CardView[], kind: K): Extract<CardView, { kind: K }> {
  const v = views.find((x): x is Extract<CardView, { kind: K }> => x.kind === kind);
  if (!v) throw new Error(`no ${kind} view`);
  return v;
}
const update = (type: string, before: unknown, after: unknown) =>
  card({ op: "update", kind: "module", type, id: "m1", name: "M", body: { payload: after }, before: { payload: before } },
    { w1: "Season", w2: "Outfit", w3: "Shoes" });

describe("card views: derivation diff", () => {
  const rule = (id: string, branches: unknown[], els?: unknown) => ({ id, branches, ...(els ? { else: els } : {}) });
  const br = (v: string, value: string, extra: Record<string, unknown> = {}) =>
    ({ condition: { var: "season", op: "equals", value: v }, action: { target_var: "mood", mode: "replace", value }, ...extra });

  it("marks the changed branch, a dropped ELSE and an added rule", () => {
    const v = only(cardViews(update("derivation",
      { rules: [rule("r1", [br("winter", "cozy")], { action: { target_var: "mood", mode: "replace", value: "calm" } }), rule("r2", [br("rain", "wet")])] },
      { rules: [rule("r1", [br("snow", "cozy", { extra_actions: [{ target_var: "light", mode: "replace", value: "dim" }] })]), rule("r2", [br("rain", "wet")]), rule("r3", [br("sun", "happy")])] },
    )), "derivation");
    expect(v.ruleChanges).toEqual(["changed", "same", "added"]);
    const [ifB, elseB] = v.rules[0];
    expect(ifB.change).toBe("changed");
    expect(ifB.wasTest).toBe('$season is "winter"');
    expect(ifB.test).toBe('$season is "snow"');
    expect(ifB.acts).toEqual([
      { text: 'set $mood to "cozy"', change: "same" },
      { text: 'set $light to "dim"', change: "added" },
    ]);
    expect(elseB).toMatchObject({ key: "ELSE", change: "removed" });
    expect(v.rules[2][0].change).toBe("added");
  });

  it("has no diff view when the rules didn't change", () => {
    const p = { rules: [rule("r1", [br("rain", "wet")])] };
    expect(cardViews(update("derivation", p, p))).toEqual([]);
  });
});

describe("card views: constraint diff", () => {
  it("marks changed, added and removed rules and a new reach", () => {
    const v = only(cardViews(update("constraint",
      { source_wildcard_id: "w1", target_wildcard_id: "w2",
        matrix: { cold: { light: { mode: "exclude" }, warm: { mode: "boost", factor: 2 } } },
        exceptions: [{ source: "snow", target: "sandals", mode: "exclude" }] },
      { source_wildcard_id: "w1", target_wildcard_id: "w3", target_select: { mode: "next", count: 2 },
        matrix: { cold: { light: { mode: "reduce", factor: 0.5 }, warm: { mode: "boost", factor: 2 } }, hot: { light: { mode: "boost", factor: 3 } } },
        exceptions: [] },
    )), "constraint");
    expect(v.rows.map((r) => [r.from, r.to, r.change])).toEqual([
      ["#cold", "#light", "changed"], ["#cold", "#warm", "same"], ["snow", "sandals", "removed"], ["#hot", "#light", "added"],
    ]);
    expect(v.rows[0].was).toEqual({ effect: "exclude", factor: null });
    expect(v.same).toBe(1);
    expect(v.fields).toEqual([
      { field: "text", label: "Target", from: "Outfit", to: "Shoes" },
      { field: "text", label: "Reaches", from: "every use after it", to: "the next 2" },
    ]);
    expect(v.target).toBe("Shoes");
  });
});

describe("card views: bundle diff", () => {
  const kid = (id: string, name: string, extra: Record<string, unknown> = {}) =>
    ({ id, type: "wildcard", meta: { name }, ...extra });
  const bundle = (before: unknown[], after: unknown[]) =>
    card({ op: "update", kind: "bundle", type: "bundle", id: "b1", name: "Pack", body: { children: after }, before: { children: before } });

  it("marks added, removed, moved, switched off and new use settings", () => {
    const v = only(cardViews(bundle(
      [kid("a", "Season"), kid("b", "Outfit"), kid("c", "Shoes"), kid("d", "Mood"), kid("e", "Old")],
      [kid("a", "Season"), kid("c", "Shoes", { enabled: false }), kid("d", "Mood", { instance: { pick_min: 2, pick_max: 3 } }), kid("b", "Outfit"), kid("f", "Hat")],
    )), "bundle");
    expect(v.rows.map((r) => [r.name, r.change, r.at, r.wasAt])).toEqual([
      ["Season", "same", 1, null], ["Shoes", "changed", 2, null], ["Mood", "changed", 3, null],
      // A removed item stays after the one it followed (Mood); its number is its old place.
      ["Old", "removed", 5, null], ["Outfit", "moved", 4, 2], ["Hat", "added", 5, null],
    ]);
    expect(v.rows[1]).toMatchObject({ enabled: false, wasEnabled: true });
    expect(v.rows[2]).toMatchObject({ use: "pick 2-3", wasUse: "" });
    expect([v.before, v.after, v.same]).toEqual([5, 5, 1]);
  });

  it("keeps two uses of one module apart", () => {
    const v = only(cardViews(bundle([kid("a", "Hair")], [kid("a", "Hair"), kid("a", "Hair")])), "bundle");
    expect(v.rows.map((r) => r.change)).toEqual(["same", "added"]);
  });
});

describe("useText", () => {
  it("says a use's settings like the bundle editor", () => {
    expect(useText({ pick_min: 1, pick_max: 3, pick_independent: true, category_filter: "warm ", exclude_null: true,
      match_variable: "model_variant", seed_scope: "hold", internal: true, variable_binding: "top" }))
      .toBe("pick 1-3 repeats; filter warm; no empty; match $model_variant; hold; internal; as $top");
    expect(useText({ pick_min: 1, pick_max: 1 })).toBe("");
    expect(useText(null)).toBe("");
  });
});
