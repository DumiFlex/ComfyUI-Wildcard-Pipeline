/**
 * WP Toggles mute / bypass control — frontend only, the run never sees it.
 *
 * A toggle with `control` ("mute" | "bypass") gets an input `ctl_<id>` in
 * front of its row (`field-sockets.ts`). Whatever is wired there is a
 * target: the node itself, or every member of a WP Node Group (followed
 * through reroutes and nested groups). Canvas groups named in the toggle's
 * `groups` add the nodes inside them. When the toggle is on its targets run
 * (mode 0); off (or off by `needs` / Pick one) they are muted (2) or
 * bypassed (4). `invert` swaps the two: on mutes / bypasses. A subgraph node takes the mode down into its inner nodes, as
 * ComfyUI does not do that itself (same as rgthree's `changeModeOfNodes`).
 *
 * The control links are real links on a server node, so `stripControlInputs`
 * drops them from the prompt (else the server would run the targets first).
 *
 * Modes are written only when a toggle flips or its wiring / control
 * changes, never while a workflow loads (the saved modes are already right).
 */
import { effectiveToggles, toggleRows, type ToggleControl, type TogglesConfig } from "./toggles";

export const CTL_PREFIX = "ctl_";
export const NODE_GROUP_TYPE = "WP_NodeGroup";
/** LiteGraph modes. */
export const MODE_ALWAYS = 0;
export const MODE_NEVER = 2;
export const MODE_BYPASS = 4;

export const ctlInputName = (toggleId: string): string => `${CTL_PREFIX}${toggleId}`;
export const isCtlInput = (name: string): boolean => name.startsWith(CTL_PREFIX);

export interface CtlLink { origin_id: number | string; origin_slot?: number }
export interface CtlInput { name: string; link?: number | null; type?: string }
export interface CtlNode {
  id: number | string;
  type?: string;
  mode?: number;
  title?: string;
  inputs?: CtlInput[];
  graph?: CtlGraph | null;
  subgraph?: { nodes?: CtlNode[] } | null;
  isVirtualNode?: boolean;
}
export interface CtlGroup {
  title?: string;
  recomputeInsideNodes?: () => void;
  _children?: Iterable<unknown>;
  nodes?: Iterable<unknown>;
}
export interface CtlGraph {
  links?: Record<string | number, CtlLink | undefined> | Map<string | number, CtlLink>;
  getNodeById?: (id: number | string) => CtlNode | null | undefined;
  groups?: CtlGroup[];
  _groups?: CtlGroup[];
}

export function offMode(control: ToggleControl): number {
  return control === "mute" ? MODE_NEVER : MODE_BYPASS;
}

function linkById(graph: CtlGraph, id: number): CtlLink | undefined {
  const links = graph.links;
  if (!links) return undefined;
  if (links instanceof Map) return links.get(id);
  return links[id];
}

/** The node wired into `input`, or null. */
export function originOf(node: CtlNode, input: CtlInput | undefined): CtlNode | null {
  const graph = node.graph;
  if (!graph || input?.link == null) return null;
  const link = linkById(graph, input.link);
  if (!link) return null;
  return graph.getNodeById?.(link.origin_id) ?? null;
}

const isPassThrough = (n: CtlNode): boolean => n.type === NODE_GROUP_TYPE || n.type === "Reroute";

/**
 * Real nodes behind `start`: a WP Node Group or reroute stands for whatever
 * is wired into it (followed to any depth, loops cut), anything else is a
 * target itself.
 */
export function expandTargets(start: CtlNode | null, seen = new Set<CtlNode>()): CtlNode[] {
  if (!start || seen.has(start)) return [];
  seen.add(start);
  if (!isPassThrough(start)) return [start];
  return (start.inputs ?? []).flatMap((inp) => expandTargets(originOf(start, inp), seen));
}

function nodesOfGroup(group: CtlGroup): CtlNode[] {
  group.recomputeInsideNodes?.();
  const kids = [...(group._children ?? group.nodes ?? [])];
  return kids.filter((k): k is CtlNode => !!k && typeof k === "object" && "id" in k && "mode" in k);
}

/** Canvas groups of `graph` by title (several may share one). */
export function groupsByTitle(graph: CtlGraph | null | undefined, titles: readonly string[]): CtlGroup[] {
  if (!graph || !titles.length) return [];
  const all = graph.groups ?? graph._groups ?? [];
  return all.filter((g) => titles.includes(g.title ?? ""));
}

/** Titles of the canvas groups in `graph`, for the edit panel. */
export function groupTitles(graph: CtlGraph | null | undefined): string[] {
  const all = graph?.groups ?? graph?._groups ?? [];
  return [...new Set(all.map((g) => g.title ?? "").filter(Boolean))];
}

/** Everything one toggle drives (never the toggles node itself). */
export function toggleTargets(node: CtlNode, toggleId: string, groups: readonly string[] = []): CtlNode[] {
  const input = node.inputs?.find((i) => i.name === ctlInputName(toggleId));
  const found = new Set<CtlNode>(expandTargets(originOf(node, input)));
  for (const g of groupsByTitle(node.graph, groups)) for (const n of nodesOfGroup(g)) found.add(n);
  found.delete(node);
  return [...found].filter((n) => !n.isVirtualNode);
}

/** Whether toggle state `on` (after needs / Pick one) drives its targets
 *  off, given `invert`. */
export function drivesOff(on: boolean, invert: boolean | undefined): boolean {
  return invert ? on : !on;
}

/** Set `mode` on `n` and, for a subgraph node, on every node inside it.
 *  Returns how many nodes changed. */
export function setMode(n: CtlNode, mode: number): number {
  let changed = 0;
  if (n.mode !== mode) {
    // Not `changeMode()`: it accepts only modes 0..3 and ignores bypass (4).
    n.mode = mode;
    changed++;
  }
  for (const inner of n.subgraph?.nodes ?? []) changed += setMode(inner, mode);
  return changed;
}

/**
 * Bring every controlled toggle's targets in line with `cfg`: on → mode 0,
 * off → its control's mode. `only` limits it to some toggles. Returns how
 * many nodes changed.
 */
export function applyControl(node: CtlNode, cfg: TogglesConfig, only?: ReadonlySet<string>): number {
  const eff = effectiveToggles(cfg);
  let changed = 0;
  for (const t of toggleRows(cfg)) {
    if (!t.control || (only && !only.has(t.id))) continue;
    const mode = drivesOff(!!eff.get(t.id), t.invert) ? offMode(t.control) : MODE_ALWAYS;
    for (const target of toggleTargets(node, t.id, t.groups)) changed += setMode(target, mode);
  }
  return changed;
}

/** Let nodes a toggle stops driving run again, when they still have the
 *  mode it gave them (a mode set by hand is left alone). */
export function releaseTargets(targets: readonly CtlNode[], control: ToggleControl): number {
  const off = offMode(control);
  let changed = 0;
  for (const t of targets) if (t.mode === off) changed += setMode(t, MODE_ALWAYS);
  return changed;
}

/** The `ctl_*` inputs `cfg` wants on the node, in row order. */
export function wantedCtlInputs(cfg: TogglesConfig): string[] {
  return toggleRows(cfg).filter((t) => t.control).map((t) => ctlInputName(t.id));
}

interface PromptEntry { class_type?: string; inputs?: Record<string, unknown> }

/** Drop control links from an API prompt (`graphToPrompt().output`). */
export function stripControlInputs(output: Record<string, PromptEntry | undefined> | null | undefined): void {
  for (const entry of Object.values(output ?? {})) {
    if (entry?.class_type !== "WP_Toggles" || !entry.inputs) continue;
    for (const key of Object.keys(entry.inputs)) if (isCtlInput(key)) delete entry.inputs[key];
  }
}

/** A toggle's control state for its row icon. `active`: it is muting /
 *  bypassing its targets right now. */
export interface ControlState {
  control: ToggleControl;
  active: boolean;
  /** What the tooltip says. */
  hint: string;
}

/** Row icon state, or null while nothing is wired and no group is picked. */
export function controlState(
  targets: readonly CtlNode[],
  control: ToggleControl,
  groups: readonly string[],
  on: boolean,
  invert: boolean | undefined,
): ControlState | null {
  if (!targets.length && !groups.length) return null;
  const off = drivesOff(on, invert);
  const word = control === "mute" ? "Mutes" : "Bypasses";
  const verb = off ? `${word} now` : `${word} when ${invert ? "on" : "off"}`;
  const names = targets.slice(0, 4).map((n) => n.title || `#${n.id}`);
  if (targets.length > 4) names.push(`${targets.length - 4} more`);
  if (groups.length) names.push(groups.length === 1 ? `group ${groups[0]}` : `${groups.length} groups`);
  return { control, active: off, hint: `${verb}: ${names.join(", ")}` };
}
