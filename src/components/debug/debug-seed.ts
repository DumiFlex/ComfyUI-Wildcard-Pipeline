/**
 * WP Debug's run seed: the seed most of a run depends on.
 *
 * Contexts in one chain can run on different seeds (WP Seeds rows, Seed
 * from Loop / own, a Loop that overrides Context seeds), so the LAST
 * Context's chain seed is no longer the one worth copying. Each Context's
 * `__wp_nodes__` entry says what its seed was made from (`from`: `loop`,
 * `own`, `row:<name>`; `engine/seed_derive.py:seed_root`); WP Seeds trace
 * rows carry the node's base seed and whether it came from the Loop. Each
 * Context's seed is traced back to its ROOT (the Loop's seed, a Seeds base
 * seed, a Random/Fixed Seeds row, or the Context's own seed) and the head
 * shows the root most Contexts share.
 */

export type SeedRootKind = "loop" | "seeds" | "row" | "own";

export interface NodeSeed {
  nodeId: string;
  /** The chain seed the Context ran with. */
  seed: string;
  kind: SeedRootKind;
  /** Where it came from, as the trace header shows it ("loop", "Seeds · Face",
   *  "own"; "" for a snapshot written before sources were recorded). */
  source: string;
  /** The root key Contexts are counted by. */
  root: string;
}

export interface RunSeed {
  /** The seed to show and copy ("" when the snapshot has none). */
  value: string;
  kind: SeedRootKind;
  /** The head chip's label ("loop seed", "seeds base", "seed · Face", "seed"). */
  label: string;
  /** Tooltip: what the seed is and how many Contexts depend on it. */
  hint: string;
  /** Every Context's seed, in chain order. */
  nodes: NodeSeed[];
  /** How many Contexts run on another root than `value`. */
  others: number;
}

const RANK: Record<SeedRootKind, number> = { loop: 0, seeds: 1, row: 2, own: 3 };

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function num(v: unknown): string {
  return typeof v === "number" && Number.isFinite(v) ? String(v) : typeof v === "string" && /^\d+$/.test(v) ? v : "";
}
function rowKey(name: string): string {
  return name.trim().split(/\s+/).join(" ").toLowerCase();
}

interface SeedsRow { name: string; seed: string; mode: string; base: string; fromLoop: boolean }

export function runSeed(snap: Record<string, unknown>): RunSeed {
  const loop = rec(snap.__wp_loop_seed__);
  const loopBase = num(loop.base);
  const rows = new Map<string, SeedsRow>();
  for (const t of Array.isArray(snap.__wp_trace__) ? snap.__wp_trace__ : []) {
    const e = rec(t);
    if (e.node !== "WP_Seeds") continue;
    const d = rec(e.detail);
    const name = typeof d.row === "string" ? d.row : typeof e.binding === "string" ? e.binding : "";
    if (!name) continue;
    rows.set(rowKey(name), {
      name,
      seed: num(e.value),
      mode: typeof d.mode === "string" ? d.mode : "follow",
      base: num(d.base),
      fromLoop: d.base_from_loop === true,
    });
  }

  const nodes: NodeSeed[] = [];
  for (const n of Array.isArray(snap.__wp_nodes__) ? snap.__wp_nodes__ : []) {
    const e = rec(n);
    const nodeId = e.node_id != null ? String(e.node_id) : "";
    const seed = num(e.seed);
    // A snapshot from before `from` existed says nothing about the source.
    const known = typeof e.from === "string";
    const from = known ? (e.from as string) : "own";
    if (from === "loop") {
      nodes.push({ nodeId, seed, kind: "loop", source: "loop", root: "loop" });
    } else if (from.startsWith("row:")) {
      const name = from.slice(4);
      const r = rows.get(rowKey(name));
      const source = `Seeds · ${r?.name ?? name}`;
      if (r && r.mode === "follow" && r.fromLoop && loopBase) {
        nodes.push({ nodeId, seed, kind: "loop", source, root: "loop" });
      } else if (r && r.mode === "follow" && r.base) {
        nodes.push({ nodeId, seed, kind: "seeds", source, root: `seeds:${r.base}` });
      } else {
        nodes.push({ nodeId, seed, kind: "row", source, root: `row:${rowKey(name)}` });
      }
    } else {
      nodes.push({ nodeId, seed, kind: "own", source: known ? "own" : "", root: `own:${nodeId}` });
    }
  }

  const fallback = num(snap.__wp_node_seed__);
  if (!nodes.length) {
    return { value: fallback, kind: "own", label: "seed", hint: "Chain seed of the last Context", nodes, others: 0 };
  }

  // The root most Contexts share; ties go to the Loop, then a Seeds base,
  // then a Seeds row, then the last Context's own seed.
  const count = new Map<string, number>();
  for (const n of nodes) count.set(n.root, (count.get(n.root) ?? 0) + 1);
  let best = nodes[nodes.length - 1] as NodeSeed;
  for (const n of [...nodes].reverse()) {
    const c = count.get(n.root) ?? 0;
    const bc = count.get(best.root) ?? 0;
    if (c > bc || (c === bc && RANK[n.kind] < RANK[best.kind])) best = n;
  }
  const shared = count.get(best.root) ?? 0;
  const total = nodes.length;
  const others = total - shared;
  const of = total === 1 ? "The Context" : shared === total ? `All ${total} Contexts` : `${shared} of ${total} Contexts`;

  if (best.kind === "loop") {
    const value = loopBase || best.seed;
    return {
      value,
      kind: "loop",
      label: "loop seed",
      hint: `The Context Loop's seed. ${of} run on seeds made from it${num(loop.seed) && num(loop.seed) !== value ? ` (this frame: ${num(loop.seed)})` : ""}.`,
      nodes,
      others,
    };
  }
  if (best.kind === "seeds") {
    const value = best.root.slice("seeds:".length);
    return { value, kind: "seeds", label: "seeds base", hint: `WP Seeds' base seed. ${of} read rows that follow it.`, nodes, others };
  }
  if (best.kind === "row") {
    const name = best.source.slice("Seeds · ".length);
    return { value: best.seed, kind: "row", label: `seed · ${name}`, hint: `WP Seeds row "${name}" (its own seed). ${of} read it.`, nodes, others };
  }
  return {
    value: best.seed || fallback,
    kind: "own",
    label: "seed",
    hint: total === 1 ? "The Context's chain seed" : `Chain seed of the last Context; ${others} other Context${others === 1 ? "" : "s"} run on their own seeds.`,
    nodes,
    others,
  };
}
