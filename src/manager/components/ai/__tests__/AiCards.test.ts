import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import AiCardView from "../AiCardView.vue";
import AiTestCard from "../AiTestCard.vue";
import { cardView } from "../../../composables/aiCards";
import type { AiChatProposal, AiTestCard as TestCard } from "../../../api/types";

function constraint(matrix: Record<string, Record<string, { mode: string; factor?: number }>>,
  exceptions: Array<Record<string, unknown>> = []): AiChatProposal {
  return {
    pid: "p1", tool: "create_constraint", title: "Create constraint Season → Outfit", summary: "",
    preview: [], warnings: [], after: null, names: { aaaa0001: "Season", aaaa0002: "Outfit" },
    op: { op: "create", kind: "module", new_category: "", body: {
      type: "constraint", name: "Season → Outfit",
      payload: { source_wildcard_id: "aaaa0001", target_wildcard_id: "aaaa0002", matrix, exceptions },
    } },
  } as unknown as AiChatProposal;
}

describe("AiCardView", () => {
  it("shows a constraint's names and rule rows", () => {
    const view = cardView(constraint({ cold: { warm: { mode: "boost", factor: 3 } } },
      [{ source: "summer", target: "wool coat", mode: "exclude" }]));
    expect(view?.kind).toBe("constraint");
    const w = mount(AiCardView, { props: { view: view! } });
    expect(w.text()).toContain("Season");
    expect(w.text()).toContain("Outfit");
    expect(w.text()).toContain("more likely ×3");
    expect(w.text()).toContain("never");
    expect(w.find('[data-test="ai-card-matrix"]').exists()).toBe(false);
  });

  it("lays two or more tags each side out as a matrix", () => {
    const view = cardView(constraint({
      cold: { warm: { mode: "boost", factor: 3 }, light: { mode: "exclude" } },
      hot: { light: { mode: "boost", factor: 2 } },
    }, [{ source: "summer", target: "wool coat", mode: "exclude" }]));
    const w = mount(AiCardView, { props: { view: view! } });
    const grid = w.get('[data-test="ai-card-matrix"]');
    expect(grid.findAll("thead th").map((t) => t.text())).toEqual(["", "#warm", "#light"]);
    const rows = grid.findAll("tbody tr").map((r) => r.findAll("td").map((d) => d.text()));
    expect(rows).toEqual([["×3", "never"], ["·", "×2"]]);
    // The option pair still shows as a row under it.
    expect(w.text()).toContain("summer");
  });

  it("shows a derivation as IF / ELIF / ELSE", () => {
    const p = constraint({});
    (p.op as unknown as { body: Record<string, unknown> }).body = {
      type: "derivation", name: "Extras", payload: { rules: [{ id: "r1", branches: [
        { condition: { var: "season", op: "equals", value: "winter" },
          action: { target_var: "extra", mode: "replace", value: "scarf" } },
        { condition: { match: "any", conditions: [
          { var: "season", op: "not_contains", value: "sum" }, { var: "rain", op: "is_set" }] },
        action: { target_var: "extra", mode: "append", value: "hood" } },
      ], else: { action: { target_var: "extra", mode: "negative", value: "umbrella" } } }] },
    };
    const w = mount(AiCardView, { props: { view: cardView(p)! } });
    expect(w.findAll(".wp-ai-card-view__kw").map((k) => k.text())).toEqual(["IF", "ELIF", "ELSE"]);
    expect(w.text()).toContain('$season does not contain "sum" or $rain has a value');
    expect(w.text()).toContain("add to the negative of $extra");
  });
});

const CARD: TestCard = {
  kind: "test", runs: 40, failed: 0, compared: true, seeds: 40,
  stack: [{ module: "aaaa0001" }],
  vars: [
    { name: "season", distinct: 2, tops: [{ v: "winter", pct: 60, was: 50 }, { v: "summer", pct: 40, was: 50 }] },
    { name: "helper", distinct: 1, internal: true, tops: [{ v: "x", pct: 100, was: 100 }] },
  ],
  never: [{ name: "Outfit", values: ["sundress"], more: 0 }],
  warnings: [{ text: "Outfit came out empty", count: 3 }],
  prompts: [{ p: "winter, wool coat", n: "lowres" }],
};

describe("AiTestCard", () => {
  it("shows shares (was → now), never-picked, warnings and opens the Test Runner", async () => {
    const w = mount(AiTestCard, { props: { card: CARD } });
    expect(w.get(".wp-ai-test__title").text().replace(/\s+/g, " ")).toBe("Test run · 40 seeds · was → now");
    const vars = w.findAll('[data-test="ai-test-var"]');
    expect(vars).toHaveLength(1);
    expect(vars[0].text()).toContain("50% → 60%");
    expect(w.get('[data-test="ai-test-never"]').text()).toContain("Never picked in Outfit: sundress");
    expect(w.text()).toContain("Outfit came out empty (3 of 40)");
    expect(w.text()).toContain("1 more variable");
    await w.get('[data-test="ai-test-open"]').trigger("click");
    expect(w.emitted("open")).toHaveLength(1);
  });

  it("can't open a run of cards only", () => {
    const w = mount(AiTestCard, { props: { card: { ...CARD, stack: [] } } });
    expect(w.get('[data-test="ai-test-open"]').attributes("disabled")).toBeDefined();
  });
});
