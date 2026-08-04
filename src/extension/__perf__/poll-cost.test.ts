/**
 * P3 #29 — how expensive is the 400ms poll, really?
 *
 * Not a pass/fail test of behaviour: it measures the cost of ONE poll cycle on
 * a graph shaped like a real workflow, so the perf discussion has numbers
 * rather than suspicion. Assertions are deliberately loose — this must not go
 * red because a laptop was busy — but the console output is the point.
 *
 * Run: npx vitest run src/extension/__perf__/poll-cost.test.ts
 */
import { describe, it, expect } from "vitest";
import {
  collectUpstreamProducers,
  collectUpstreamVariables,
  collectUpstreamWildcardUuids,
  type LiteGraphLike,
  type LiteNodeLike,
} from "../graph";

/** A Context node carrying `moduleCount` wildcard modules, each with
 *  `optionCount` options — the shape the reported workflow actually has. */
function contextNode(id: number, moduleCount: number, optionCount: number, upstreamLink?: number): LiteNodeLike {
  const modules = Array.from({ length: moduleCount }, (_, m) => ({
    id: `mod${id}_${m}`.padEnd(8, "0").slice(0, 8),
    _uid: `u${id}_${m}`,
    type: "wildcard",
    enabled: true,
    meta: { name: `Module ${id}-${m}` },
    payload: {
      var_binding: `var_${id}_${m}`,
      sub_categories: ["red", "warm", "medium", "vivid", "glossy"],
      options: Array.from({ length: optionCount }, (_, o) => ({
        id: `o${o}`,
        value: `option value number ${o} with some realistic length of text`,
        weight: 1,
        sub_categories: ["red", "warm"],
      })),
    },
  }));
  return {
    id,
    type: "WP_Context",
    inputs: [{ name: "upstream", link: upstreamLink ?? null }],
    outputs: [{ name: "context", links: [], type: "PIPELINE_CONTEXT" }],
    widgets: [{ name: "wp_modules", value: JSON.stringify({ version: 1, modules }) }],
  };
}

function chainOf(count: number, moduleCount: number, optionCount: number) {
  const nodes: LiteNodeLike[] = [];
  const links: Record<number, { id: number; origin_id: number; origin_slot: number; target_id: number; target_slot: number }> = {};
  for (let i = 0; i < count; i++) {
    nodes.push(contextNode(i + 1, moduleCount, optionCount, i === 0 ? undefined : 100 + i));
    if (i > 0) {
      links[100 + i] = { id: 100 + i, origin_id: i, origin_slot: 0, target_id: i + 1, target_slot: 0 };
    }
  }
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const graph = {
    _nodes: nodes,
    links,
    getNodeById: (id: number) => byId[id] ?? null,
  } as unknown as LiteGraphLike;
  return { graph, pov: nodes[nodes.length - 1] };
}

function timed(label: string, fn: () => void, runs = 20): number {
  fn(); // warm
  const t0 = performance.now();
  for (let i = 0; i < runs; i++) fn();
  const per = (performance.now() - t0) / runs;
  console.log(`    ${label.padEnd(34)} ${per.toFixed(2)} ms/call`);
  return per;
}

describe("P3 #29 — cost of one poll cycle", () => {
  it("measures the walkers on a workflow-sized graph", () => {
    // The reported workflow: 5 Context nodes, ~18 modules each, and at least
    // one wildcard carrying 133 options.
    const { graph, pov } = chainOf(5, 18, 133);

    console.log("\n  graph: 5 Context nodes x 18 modules x 133 options");
    const producers = timed("collectUpstreamProducers", () => { collectUpstreamProducers(graph, pov); });
    const vars = timed("collectUpstreamVariables", () => { collectUpstreamVariables(graph, pov); });
    const uuids = timed("collectUpstreamWildcardUuids", () => { collectUpstreamWildcardUuids(graph, pov); });

    // A Context node registers TEN reactiveFromGraph calls; these three are a
    // representative sample of what they run.
    const perNodeSample = producers + vars + uuids;
    console.log(`\n    sample of 3 of the 10 per-node polls: ${perNodeSample.toFixed(2)} ms`);
    console.log(`    x5 Context nodes, every 400ms:        ${(perNodeSample * 5).toFixed(2)} ms per cycle`);
    console.log(`    => ~${((perNodeSample * 5) / 400 * 100).toFixed(1)}% of one core, from 3/10 of the polls alone\n`);

    // Loose: this is a measurement, not a threshold to defend.
    expect(producers).toBeGreaterThan(0);
  });

  it("shows the cost is dominated by re-parsing the widget JSON each time", () => {
    const { graph, pov } = chainOf(5, 18, 133);
    const raw = (pov.widgets?.[0] as { value?: string })?.value ?? "";
    console.log(`\n  wp_modules JSON per node: ${(raw.length / 1024).toFixed(1)} KB`);
    const parse = timed("JSON.parse(wp_modules) x5 nodes", () => {
      for (let i = 0; i < 5; i++) JSON.parse(raw);
    });
    const walk = timed("collectUpstreamProducers (whole)", () => { collectUpstreamProducers(graph, pov); });
    console.log(`\n    parsing is ~${((parse / walk) * 100).toFixed(0)}% of the walk\n`);
    expect(parse).toBeGreaterThan(0);
  });
});
