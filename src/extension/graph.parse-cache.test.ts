/**
 * P3 #29 — the walkers share one parsed object now, so they must not write to
 * it.
 *
 * `parseCached` memoises on the raw widget string because re-parsing a ~294 KB
 * `wp_modules` value cost more than the traversal it fed, and ten pollers per
 * Context node were each doing it every 400 ms. The price of that is that
 * callers no longer get a private copy. This locks the contract in: the cache
 * is put into freeze mode, every walker is run, and any write to parsed data
 * throws a TypeError in strict mode instead of silently corrupting what the
 * next walker reads.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  collectUpstreamProducers,
  collectUpstreamVariables,
  collectUpstreamWildcardUuids,
  _setParseCacheFreezeForTests,
  _clearParseCacheForTests,
  type LiteGraphLike,
  type LiteNodeLike,
} from "./graph";

function contextNode(id: number, upstreamLink?: number): LiteNodeLike {
  const modules = Array.from({ length: 4 }, (_, m) => ({
    id: `mod${id}${m}`.padEnd(8, "0").slice(0, 8),
    _uid: `u${id}_${m}`,
    type: "wildcard",
    enabled: true,
    meta: { name: `Module ${id}-${m}` },
    payload: {
      var_binding: `var_${id}_${m}`,
      sub_categories: ["red", "warm"],
      options: Array.from({ length: 6 }, (_, o) => ({
        id: `o${o}`,
        value: `value ${o} @{aaaabbbb#other}`,
        weight: 1,
        sub_categories: ["red"],
      })),
    },
  }));
  return {
    id,
    type: "WP_Context",
    inputs: [{ name: "upstream", link: upstreamLink ?? null }],
    outputs: [{ name: "context", links: [], type: "PIPELINE_CONTEXT" }],
    widgets: [{ name: "wp_modules", value: JSON.stringify({ version: 1, modules }) }],
  } as unknown as LiteNodeLike;
}

function injectorNode(id: number, upstreamLink?: number): LiteNodeLike {
  return {
    id,
    type: "WP_ContextInjector",
    inputs: [{ name: "upstream", link: upstreamLink ?? null }],
    outputs: [{ name: "context", links: [], type: "PIPELINE_CONTEXT" }],
    widgets: [{
      name: "wp_rows",
      value: JSON.stringify({
        version: 1,
        rows: [
          { _uid: "r1", kind: "socket", slot_name: "input_0", binding: "lora_outfit", enabled: true, internal: false },
          { _uid: "r2", kind: "socket", slot_name: "input_1", binding: "lora_style", enabled: true, internal: true },
        ],
      }),
    }],
  } as unknown as LiteNodeLike;
}

/** injector(1) -> context(2) -> context(3) */
function buildGraph(): { graph: LiteGraphLike; leaf: LiteNodeLike } {
  const inj = injectorNode(1);
  const mid = contextNode(2, 11);
  const leaf = contextNode(3, 12);
  const nodes = [inj, mid, leaf];
  const graph = {
    _nodes: nodes,
    links: {
      11: { id: 11, origin_id: 1, origin_slot: 0, target_id: 2, target_slot: 0 },
      12: { id: 12, origin_id: 2, origin_slot: 0, target_id: 3, target_slot: 0 },
    },
    getNodeById: (id: number) => nodes.find((n) => Number(n.id) === Number(id)) ?? null,
  } as unknown as LiteGraphLike;
  return { graph, leaf };
}

describe("graph walkers — parsed widget data is read-only", () => {
  beforeEach(() => { _setParseCacheFreezeForTests(true); });
  afterEach(() => { _setParseCacheFreezeForTests(false); });

  it("collectUpstreamProducers does not write to parsed data", () => {
    const { graph, leaf } = buildGraph();
    expect(() => collectUpstreamProducers(graph, leaf)).not.toThrow();
  });

  it("collectUpstreamVariables does not write to parsed data", () => {
    const { graph, leaf } = buildGraph();
    expect(() => collectUpstreamVariables(graph, leaf)).not.toThrow();
  });

  it("collectUpstreamWildcardUuids does not write to parsed data", () => {
    const { graph, leaf } = buildGraph();
    expect(() => collectUpstreamWildcardUuids(graph, leaf)).not.toThrow();
  });

  it("still returns the same answers with the cache warm", () => {
    const { graph, leaf } = buildGraph();
    const first = collectUpstreamVariables(graph, leaf);
    const second = collectUpstreamVariables(graph, leaf);
    expect(second).toEqual(first);
    expect(first.length).toBeGreaterThan(0);
  });
});

describe("parse cache invalidation", () => {
  beforeEach(() => { _clearParseCacheForTests(); });

  it("picks up an edited widget, because the raw string is the key", () => {
    const { graph, leaf } = buildGraph();
    const before = collectUpstreamVariables(graph, leaf);
    expect(before).toContain("var_2_0");

    // Rewrite the middle node's modules — a new string, so a new cache key.
    const mid = (graph as unknown as { _nodes: LiteNodeLike[] })._nodes[1];
    const w = mid.widgets?.find((x) => x.name === "wp_modules");
    if (w) {
      w.value = JSON.stringify({
        version: 1,
        modules: [{
          id: "renamed0", _uid: "uR", type: "wildcard", enabled: true,
          meta: { name: "Renamed" },
          // Needs a real option: collectUpstreamVariables goes through
          // collectUpstreamResolved, so a module with nothing to resolve
          // contributes no variable at all.
          payload: {
            var_binding: "renamed_var",
            options: [{ id: "o0", value: "something", weight: 1 }],
          },
        }],
      });
    }
    const after = collectUpstreamVariables(graph, leaf);
    expect(after).toContain("renamed_var");
    expect(after).not.toContain("var_2_0");
  });
});
