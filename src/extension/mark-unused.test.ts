import { describe, expect, it } from "vitest";
import type { LiteGraphLike, LiteLink, LiteNodeLike } from "./graph";
import { applyMarkUnused, nameList, planMarkUnused, summary, undoMarkUnused } from "./mark-unused";

type Node = LiteNodeLike & { widgets: { name: string; value: unknown }[] };

/** A graph of `nodes` wired by `[from, to]` PIPELINE_CONTEXT links (output 0
 *  → input 0). Each node gets `graph` set, like litegraph does. */
function build(nodes: Node[], wires: Array<[number, number]>): LiteGraphLike {
  const links: Record<number, LiteLink> = {};
  const byId = new Map(nodes.map((n) => [n.id, n]));
  wires.forEach(([from, to], i) => {
    const id = 100 + i;
    links[id] = { id, origin_id: from, origin_slot: 0, target_id: to, target_slot: 0 };
    const src = byId.get(from);
    const dst = byId.get(to);
    if (!src || !dst) throw new Error("bad wire");
    const out = src.outputs?.[0];
    if (out) out.links = [...(out.links ?? []), id];
    const inp = dst.inputs?.[0];
    if (inp) inp.link = id;
  });
  const graph: LiteGraphLike = {
    _nodes: nodes,
    links,
    getNodeById: (id) => byId.get(Number(id)) ?? null,
  };
  for (const n of nodes) n.graph = graph;
  return graph;
}

const ctxOut = () => [{ name: "context", links: [] as number[], type: "PIPELINE_CONTEXT" }];

function context(id: number, modules: unknown[]): Node {
  return {
    id, type: "WP_Context",
    inputs: [{ name: "upstream", link: null }],
    outputs: ctxOut(),
    widgets: [{ name: "wp_modules", value: JSON.stringify({ version: 1, modules }) }],
  };
}

function assembler(id: number, template: string, negative = "$negatives"): Node {
  return {
    id, type: "WP_PromptAssembler",
    inputs: [{ name: "context", link: null }],
    outputs: [{ name: "prompt", links: [], type: "STRING" }],
    widgets: [{ name: "template", value: template }, { name: "negative_template", value: negative }],
  };
}

const wildcard = (uid: string, v: string, internal = false) => ({
  id: uid, _uid: uid, type: "wildcard", enabled: true, meta: { name: v }, entries: [],
  payload: { var_binding: v }, instance: internal ? { internal: true } : {},
});
const combine = (uid: string, v: string) => ({
  id: uid, _uid: uid, type: "combine", enabled: true, meta: { name: v }, entries: [],
  payload: { output_var: v, template: "$hero in $place" }, instance: {},
});
const fixed = (uid: string, names: string[]) => ({
  id: uid, _uid: uid, type: "fixed_values", enabled: true, meta: { name: "fv" }, entries: [],
  payload: { values: names.map((n, i) => ({ id: `v${i}`, name: n, value: "x" })) }, instance: {},
});
const derivation = (uid: string, target: string) => ({
  id: uid, _uid: uid, type: "derivation", enabled: true, meta: { name: "d" }, entries: [],
  payload: { rules: [{ branches: [{ action: { target_var: target, value: "calm" } }] }] }, instance: {},
});

function modulesOf(n: Node): Array<{ _uid: string; instance?: { internal?: boolean } }> {
  const raw = n.widgets.find((w) => w.name === "wp_modules")?.value;
  return (JSON.parse(String(raw)) as { modules: Array<{ _uid: string; instance?: { internal?: boolean } }> }).modules;
}
const internalOf = (n: Node, uid: string) => modulesOf(n).find((m) => m._uid === uid)?.instance?.internal === true;

describe("planMarkUnused", () => {
  it("marks what no Assembler reads and keeps what another Assembler or a shared module needs", () => {
    const ctx = context(1, [
      wildcard("h", "hero"),
      wildcard("p", "place"),
      combine("s", "scene"),
      fixed("f", ["a", "b"]),
      derivation("d", "mood"),
      wildcard("o", "outfit"),
    ]);
    const a = assembler(2, "$scene, $a");
    const b = assembler(3, "$outfit.SHOES", "$negatives, $mood.neg");
    const g = build([ctx, a, b], [[1, 2], [1, 3]]);

    const plan = planMarkUnused(g, a);
    expect(plan.wired).toBe(false);
    // $hero and $place are read only by the combine, which still reads an
    // internal variable: hiding them from the prompt is what internal is for.
    expect(plan.marked).toEqual(["hero", "place"]);
    expect(plan.kept).toEqual([
      { name: "b", reason: "shared_module", also: "a" },
      { name: "mood", reason: "other_assembler" },
      { name: "outfit", reason: "other_assembler" },
    ]);

    const changes = applyMarkUnused(plan);
    expect(changes).toHaveLength(1);
    expect(internalOf(ctx, "h")).toBe(true);
    expect(internalOf(ctx, "p")).toBe(true);
    expect(internalOf(ctx, "s")).toBe(false);
    expect(internalOf(ctx, "f")).toBe(false);

    expect(undoMarkUnused(changes)).toBe(0);
    expect(internalOf(ctx, "h")).toBe(false);
  });

  it("only counts Assemblers below the writer, through later Contexts", () => {
    const up = context(1, [wildcard("x", "x"), wildcard("y", "y")]);
    const mid = context(2, [wildcard("z", "z")]);
    const a = assembler(3, "$z");
    const b = assembler(4, "$y");
    // b hangs off `up` directly; a sits below `mid`.
    const g = build([up, mid, a, b], [[1, 2], [2, 3], [1, 4]]);
    const plan = planMarkUnused(g, a);
    expect(plan.marked).toEqual(["x"]);
    expect(plan.kept).toEqual([{ name: "y", reason: "other_assembler" }]);
  });

  it("skips variables already internal and writers that are muted or bypassed", () => {
    const ctx = context(1, [wildcard("i", "inner", true), wildcard("v", "visible")]);
    const muted = context(2, [wildcard("m", "muted")]);
    muted.mode = 4;
    const a = assembler(3, "");
    const g = build([ctx, muted, a], [[1, 2], [2, 3]]);
    expect(planMarkUnused(g, a).marked).toEqual(["visible"]);
  });

  it("uses the closest writer of a name", () => {
    const up = context(1, [wildcard("u", "hero")]);
    const down = context(2, [wildcard("d", "hero")]);
    const a = assembler(3, "");
    const g = build([up, down, a], [[1, 2], [2, 3]]);
    applyMarkUnused(planMarkUnused(g, a));
    expect(internalOf(down, "d")).toBe(true);
    expect(internalOf(up, "u")).toBe(false);
  });

  it("refuses when this Assembler's template is wired", () => {
    const ctx = context(1, [wildcard("h", "hero")]);
    const a = assembler(2, "");
    a.inputs?.push({ name: "template", link: 999 });
    const g = build([ctx, a], [[1, 2]]);
    expect(planMarkUnused(g, a)).toMatchObject({ wired: true, marked: [] });
  });

  it("keeps everything another Assembler could read through a wired template", () => {
    const ctx = context(1, [wildcard("h", "hero")]);
    const a = assembler(2, "");
    const b = assembler(3, "");
    b.inputs?.push({ name: "negative_template", link: 998 });
    const g = build([ctx, a, b], [[1, 2], [1, 3]]);
    const plan = planMarkUnused(g, a);
    expect(plan.marked).toEqual([]);
    expect(plan.kept).toEqual([{ name: "hero", reason: "wired_template" }]);
  });

  it("drops a bundle master's markers so its cascade can't undo the flag", () => {
    const m = { ...wildcard("h", "hero"), instance: { _ui: { master_internal: false, master_internal_by: "b1", keep: 1 } } };
    const ctx = context(1, [m]);
    const a = assembler(2, "");
    const g = build([ctx, a], [[1, 2]]);
    applyMarkUnused(planMarkUnused(g, a));
    const inst = (modulesOf(ctx)[0] as unknown as { instance: { internal: boolean; _ui: Record<string, unknown> } }).instance;
    expect(inst).toEqual({ internal: true, _ui: { keep: 1 } });
  });
});

describe("other writers", () => {
  it("flips injector rows, toggles, model info and loop vars", () => {
    const inj: Node = {
      id: 1, type: "WP_ContextInjector",
      inputs: [{ name: "upstream", link: null }], outputs: ctxOut(),
      widgets: [{ name: "wp_rows", value: JSON.stringify({ version: 1, rows: [
        { binding: "shot", enabled: true },
        { binding: "used", enabled: true },
        { binding: "off", enabled: false },
      ] }) }],
    };
    const tog: Node = {
      id: 2, type: "WP_Toggles",
      inputs: [{ name: "upstream", link: null }], outputs: ctxOut(),
      widgets: [{ name: "wp_toggles", value: JSON.stringify({ version: 1, mode: "any", group_var: "", rows: [
        { id: "t1", kind: "toggle", name: "Rain", var: "rain", on: true, visible: true },
        { id: "t2", kind: "toggle", name: "Hidden", var: "hidden", on: true },
      ] }) }],
    };
    const model: Node = {
      id: 3, type: "WP_ModelInfo",
      inputs: [{ name: "upstream", link: null }], outputs: ctxOut(),
      widgets: [{ name: "wp_model_info", value: JSON.stringify({ version: 1, internal: { family: false, variant: true, name: false } }) }],
    };
    const loop: Node = {
      id: 4, type: "WP_ContextLoop",
      inputs: [{ name: "upstream", link: null }], outputs: ctxOut(),
      widgets: [{ name: "wp_context_loop_config", value: JSON.stringify({ iteration_var_name: "frame", iteration_internal: false, total_internal: false }) }],
    };
    const a = assembler(5, "$used, $model_name, $frame_total");
    const g = build([inj, tog, model, loop, a], [[1, 2], [2, 3], [3, 4], [4, 5]]);
    const plan = planMarkUnused(g, a);
    expect(plan.marked.sort()).toEqual(["frame", "model_family", "rain", "shot"]);

    const changes = applyMarkUnused(plan);
    expect(changes).toHaveLength(4);
    const val = (n: Node, w: string) => JSON.parse(String(n.widgets.find((x) => x.name === w)?.value)) as Record<string, unknown>;
    const rows = val(inj, "wp_rows").rows as Array<{ binding: string; internal?: boolean }>;
    expect(rows.map((r) => r.internal === true)).toEqual([true, false, false]);
    expect((val(tog, "wp_toggles").rows as Array<{ visible?: boolean }>)[0].visible).toBeUndefined();
    expect(val(model, "wp_model_info").internal).toEqual({ family: true, variant: true, name: false });
    expect(val(loop, "wp_context_loop_config")).toMatchObject({ iteration_internal: true, total_internal: false });

    // Undo leaves a node edited since alone.
    loop.widgets[0].value = JSON.stringify({ iteration_var_name: "frame" });
    expect(undoMarkUnused(changes)).toBe(1);
    expect((val(inj, "wp_rows").rows as Array<{ internal?: boolean }>)[0].internal).toBeUndefined();
    expect(val(loop, "wp_context_loop_config")).toEqual({ iteration_var_name: "frame" });
  });
});

describe("summary", () => {
  it("names what was marked and why the rest stayed", () => {
    expect(nameList(["a"])).toBe("$a");
    expect(nameList(["a", "b"])).toBe("$a and $b");
    expect(nameList(["a", "b", "c", "d", "e", "f"])).toBe("$a, $b, $c, $d and 2 more");
    expect(summary({
      wired: false, units: [],
      marked: ["hero"],
      kept: [{ name: "mood", reason: "other_assembler" }, { name: "b", reason: "shared_module", also: "a" }],
    })).toBe("Marked 1 internal: $hero. Kept $mood: another Assembler uses it. Kept $b: its module also writes $a, which is in use.");
  });
});
