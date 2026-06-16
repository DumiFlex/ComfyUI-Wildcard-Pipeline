import { describe, it, expect } from "vitest";
import { collectFullChainModules } from "./cross-node-pairings";
import { baseCodename } from "./node-codename";
import type { LiteGraphLike, LiteNodeLike } from "./graph";

/** Build a WP_Context node carrying `modules` + an optional persisted
 *  `node_label`. Mirrors the widget-JSON shape graph.ts reads under the
 *  `wp_modules` widget. `upstreamLink` wires this node's PIPELINE_CONTEXT
 *  input to the link id of its upstream producer; `downstreamLinks` lists
 *  the link ids flowing OUT of its PIPELINE_CONTEXT output. */
function ctxNode(
  id: number,
  modules: Array<Record<string, unknown>>,
  opts: { upstreamLink?: number; downstreamLinks?: number[] } = {},
): LiteNodeLike {
  const value: Record<string, unknown> = { version: 1, modules };
  return {
    id,
    type: "WP_Context",
    inputs: [{ name: "upstream", link: opts.upstreamLink ?? null, type: "PIPELINE_CONTEXT" }],
    outputs: [{ name: "context", links: opts.downstreamLinks ?? [], type: "PIPELINE_CONTEXT" }],
    widgets: [{ name: "wp_modules", value: JSON.stringify(value) }],
  };
}

const wildcard = (id: string): Record<string, unknown> => ({
  id,
  _uid: `${id}-uid`,
  type: "wildcard",
  enabled: true,
  meta: { name: id },
  entries: [],
  payload: { var_binding: id, options: [] },
});

describe("collectFullChainModules — codename tagging", () => {
  it("tags each flattened module with its node's stable codename (from node id)", () => {
    // A → B chain. Codenames are fixed + derived from the litegraph node
    // id — no editable label, no walk-position letters.
    const a = ctxNode(1, [wildcard("aa")], { downstreamLinks: [100] });
    const b = ctxNode(2, [wildcard("bb")], { upstreamLink: 100 });
    const graph: LiteGraphLike = {
      _nodes: [a, b],
      links: { 100: { id: 100, origin_id: 1, origin_slot: 0, target_id: 2, target_slot: 0 } },
      getNodeById: (n) => ({ 1: a, 2: b } as Record<number, LiteNodeLike>)[n] ?? null,
    };

    const out = collectFullChainModules(graph, b);
    expect(out.find((m) => m.id === "aa")?.nodeLabel).toBe(baseCodename(1));
    expect(out.find((m) => m.id === "bb")?.nodeLabel).toBe(baseCodename(2));
  });

  it("is POV-independent: a node keeps the SAME codename regardless of which node we walk from", () => {
    // The core fix for the old A/B/C scheme: walking from A vs from C must
    // give node B the identical name (the pre-2026 letters shifted by POV
    // and by empty upstream nodes, so two heads both became "A").
    const a = ctxNode(1, [wildcard("aa")], { downstreamLinks: [100] });
    const b = ctxNode(2, [wildcard("bb")], { upstreamLink: 100, downstreamLinks: [200] });
    const c = ctxNode(3, [wildcard("cc")], { upstreamLink: 200 });
    const graph: LiteGraphLike = {
      _nodes: [a, b, c],
      links: {
        100: { id: 100, origin_id: 1, origin_slot: 0, target_id: 2, target_slot: 0 },
        200: { id: 200, origin_id: 2, origin_slot: 0, target_id: 3, target_slot: 0 },
      },
      getNodeById: (n) => ({ 1: a, 2: b, 3: c } as Record<number, LiteNodeLike>)[n] ?? null,
    };

    const fromA = collectFullChainModules(graph, a).find((m) => m.id === "bb")?.nodeLabel;
    const fromC = collectFullChainModules(graph, c).find((m) => m.id === "bb")?.nodeLabel;
    expect(fromA).toBe(baseCodename(2));
    expect(fromC).toBe(baseCodename(2));
    expect(fromA).toBe(fromC);
  });

  it("distinct nodes get distinct codenames across the chain", () => {
    const a = ctxNode(1, [wildcard("aa")], { downstreamLinks: [100] });
    const b = ctxNode(2, [wildcard("bb")], { upstreamLink: 100, downstreamLinks: [200] });
    const c = ctxNode(3, [wildcard("cc")], { upstreamLink: 200 });
    const graph: LiteGraphLike = {
      _nodes: [a, b, c],
      links: {
        100: { id: 100, origin_id: 1, origin_slot: 0, target_id: 2, target_slot: 0 },
        200: { id: 200, origin_id: 2, origin_slot: 0, target_id: 3, target_slot: 0 },
      },
      getNodeById: (n) => ({ 1: a, 2: b, 3: c } as Record<number, LiteNodeLike>)[n] ?? null,
    };
    const out = collectFullChainModules(graph, b);
    const labels = [
      out.find((m) => m.id === "aa")?.nodeLabel,
      out.find((m) => m.id === "bb")?.nodeLabel,
      out.find((m) => m.id === "cc")?.nodeLabel,
    ];
    expect(new Set(labels).size).toBe(3);
  });

  it("single own node → its own codename", () => {
    const a = ctxNode(7, [wildcard("aa")]);
    const graph: LiteGraphLike = {
      _nodes: [a],
      links: {},
      getNodeById: (n) => ({ 7: a } as Record<number, LiteNodeLike>)[n] ?? null,
    };
    const out = collectFullChainModules(graph, a);
    expect(out.find((m) => m.id === "aa")?.nodeLabel).toBe(baseCodename(7));
  });
});

describe("collectFullChainModules — instance.target_select override (SP3 reach)", () => {
  /** Constraint carrying a library payload reach + an instance-level
   *  override. The editor modal writes reach edits to `instance.target_select`
   *  (default `all` dropped to null), so the flatten MUST fold that override
   *  over `payload.target_select` — otherwise computePairingsFull reads the
   *  stale library value and the canvas badge never reflects the edit. */
  const constraintMod = (
    instanceTargetSelect: unknown,
    payloadTargetSelect: unknown,
  ): Record<string, unknown> => ({
    id: "cn0",
    _uid: "cn0-uid",
    type: "constraint",
    enabled: true,
    meta: { name: "pairing" },
    payload: {
      source_wildcard_id: "s0",
      target_wildcard_id: "t0",
      target_select: payloadTargetSelect,
    },
    instance: { target_select: instanceTargetSelect },
  });

  function flattenOne(mod: Record<string, unknown>) {
    const a = ctxNode(1, [mod]);
    const graph: LiteGraphLike = {
      _nodes: [a],
      links: {},
      getNodeById: (n) => ({ 1: a } as Record<number, LiteNodeLike>)[n] ?? null,
    };
    const flat = collectFullChainModules(graph, a).find((m) => m.id === "cn0");
    return (flat?.payload as { target_select?: unknown }).target_select;
  }

  it("folds a present instance.target_select over the library payload value", () => {
    // Library says `all`; instance overrides to `next 2`. Effective = next 2.
    expect(flattenOne(constraintMod({ mode: "next", count: 2 }, { mode: "all" }))).toEqual({
      mode: "next",
      count: 2,
    });
  });

  it("inherits the library payload value when the instance override is null", () => {
    // null = "no per-instance override" → library `first` shows through.
    expect(flattenOne(constraintMod(null, { mode: "first" }))).toEqual({ mode: "first" });
  });
});
