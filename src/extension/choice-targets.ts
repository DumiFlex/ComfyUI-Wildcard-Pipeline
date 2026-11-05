/**
 * What a WP_VarToChoice output feeds, read off the canvas — pure, no DOM.
 *
 * The widget names the dropdown input(s) the `choice` output is wired into
 * (`Load Checkpoint › ckpt_name · 24 options`) before any run, so the user
 * sees what the value will be matched against, and fills the fallback
 * dropdown with that input's options. The run itself reads the options
 * server side (`engine/choice.py`).
 */
import type { LiteGraphLike, LiteNodeLike } from "./graph";

interface WidgetWithOptions {
  name: string;
  value: unknown;
  options?: { values?: unknown };
}

export interface ChoiceTarget {
  title: string;
  input: string;
  /** Dropdown option count, or `null` when the input has no option list. */
  options: number | null;
  /** The dropdown's options, or `null` when the input has no option list. */
  values: string[] | null;
}

/** First entry of the fallback dropdown (`engine/choice.py:FIRST_OPTION`). */
export const FIRST_OPTION = "(first option)";

/** Legacy frontend-only reroute nodes the value passes straight through. */
const PASS_THROUGH = new Set(["Reroute"]);

function optionValues(node: LiteNodeLike, input: string): string[] | null {
  const widgets = (node.widgets ?? []) as WidgetWithOptions[];
  const values = widgets.find((w) => w.name === input)?.options?.values;
  return Array.isArray(values) ? values.map(String) : null;
}

/** Every input fed by `node`'s output `slot`, following legacy reroutes. */
export function findChoiceTargets(graph: LiteGraphLike | null | undefined, node: LiteNodeLike, slot = 0): ChoiceTarget[] {
  if (!graph) return [];
  const out: ChoiceTarget[] = [];
  const seen = new Set<number>();
  const walk = (from: LiteNodeLike, fromSlot: number, depth: number): void => {
    for (const linkId of from.outputs?.[fromSlot]?.links ?? []) {
      const link = graph.links[linkId];
      if (!link || seen.has(link.target_id)) continue;
      const target = graph.getNodeById(link.target_id);
      if (!target) {
        // Subgraph output boundary (-20) or a node litegraph hasn't placed yet.
        out.push({ title: "a subgraph", input: "", options: null, values: null });
        continue;
      }
      if (PASS_THROUGH.has(target.type) && depth < 8) {
        seen.add(link.target_id);
        walk(target, 0, depth + 1);
        continue;
      }
      const input = target.inputs?.[link.target_slot]?.name ?? "";
      const values = optionValues(target, input);
      out.push({ title: target.title || target.type, input, options: values ? values.length : null, values });
    }
  };
  walk(node, slot, 0);
  return out;
}

/** One line for the widget: the dropdown the run matches against (the first
 *  target with options, like `engine/choice.py`), its option count, and how
 *  many more dropdowns it feeds. Targets without a list (a Preview as Text
 *  beside the loader) don't count; they only show when nothing has a list. */
export function describeChoiceTargets(targets: readonly ChoiceTarget[]): string {
  if (targets.length === 0) return "not wired: connect choice to a dropdown input";
  const listed = targets.filter((t) => t.options !== null);
  const first = listed[0] ?? targets[0];
  const where = first.input ? `${first.title} › ${first.input}` : first.title;
  const count = first.options === null ? "no option list" : `${first.options} options`;
  const more = listed.length > 1 ? ` (+${listed.length - 1} more)` : "";
  return `${where} · ${count}${more}`;
}

/** The fallback dropdown's entries: `(first option)`, then the options of
 *  the first target with a list (the one the run matches against). */
export function fallbackChoices(targets: readonly ChoiceTarget[]): string[] {
  const listed = targets.find((t) => t.values !== null);
  return [FIRST_OPTION, ...(listed?.values ?? []).filter((v) => v !== FIRST_OPTION)];
}
