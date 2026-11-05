/**
 * WP Mode Relay — a frontend-only node that watches the modes of the nodes
 * wired into it and passes a mode on to the nodes its output goes to
 * (rgthree's Mute / Bypass Relay).
 *
 * Watched modes combine as: all muted → "muted", all bypassed → "bypassed",
 * any running → "on"; a mix of muted and bypassed sends nothing. The relay
 * maps each case to Run / Mute / Bypass / Nothing (`RelayMap`, saved on
 * `node.properties.wp_relay`) and sets that mode on its targets: a WP Node
 * Group's members, or any other node it is wired into (subgraph nodes
 * reach inside, `setMode`). Only a change does it, never a workflow load.
 */
import { members, modeName, type GroupHostNode, type MemberMode } from "./node-group";
import { MODE_ALWAYS, MODE_BYPASS, MODE_NEVER, NODE_GROUP_TYPE, originOf, setMode, type CtlNode } from "./toggle-control";

export const MODE_RELAY_TYPE = "WP_ModeRelay";
export const RELAY_PROP = "wp_relay";

export type RelayAction = "run" | "mute" | "bypass" | "nothing";
export interface RelayMap { muted: RelayAction; bypassed: RelayAction; on: RelayAction }
export const DEFAULT_RELAY: RelayMap = { muted: "mute", bypassed: "bypass", on: "run" };
const ACTIONS: readonly RelayAction[] = ["run", "mute", "bypass", "nothing"];

export function parseRelayMap(raw: unknown): RelayMap {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const pick = (k: keyof RelayMap): RelayAction =>
    ACTIONS.includes(o[k] as RelayAction) ? (o[k] as RelayAction) : DEFAULT_RELAY[k];
  return { muted: pick("muted"), bypassed: pick("bypassed"), on: pick("on") };
}

export const actionMode = (a: RelayAction): number | null =>
  a === "run" ? MODE_ALWAYS : a === "mute" ? MODE_NEVER : a === "bypass" ? MODE_BYPASS : null;

/** The watched nodes' combined state, or null (none watched, or a mix of
 *  muted and bypassed). */
export function combinedState(modes: readonly (number | undefined)[]): MemberMode | null {
  if (!modes.length) return null;
  const names = modes.map(modeName);
  if (names.includes("on")) return "on";
  if (names.every((m) => m === "muted")) return "muted";
  if (names.every((m) => m === "bypassed")) return "bypassed";
  return null;
}

export interface RelayNode extends GroupHostNode {
  outputs?: { links?: number[] | null }[];
}

/** Nodes wired into the relay (what it watches). */
export function watched(node: RelayNode): CtlNode[] {
  return (node.inputs ?? []).map((i) => originOf(node, i)).filter((n): n is CtlNode => !!n && !n.isVirtualNode);
}

/** Nodes the relay sets: a WP Node Group stands for its members. */
export function relayTargets(node: RelayNode): CtlNode[] {
  const graph = node.graph;
  if (!graph) return [];
  const out = new Set<CtlNode>();
  for (const output of node.outputs ?? []) {
    for (const id of output.links ?? []) {
      const links = graph.links;
      const link = links instanceof Map ? links.get(id) : links?.[id];
      const target = (link as { target_id?: number | string } | undefined)?.target_id;
      const n = target == null ? null : graph.getNodeById?.(target);
      if (!n || n === node) continue;
      if (n.type === NODE_GROUP_TYPE) for (const m of members(n as GroupHostNode)) out.add(m);
      else if (!n.isVirtualNode) out.add(n);
    }
  }
  return [...out];
}

/** Apply `state` through `map` to the relay's targets; how many changed. */
export function relay(node: RelayNode, state: MemberMode | null, map: RelayMap): number {
  if (!state) return 0;
  const mode = actionMode(map[state]);
  if (mode === null) return 0;
  return relayTargets(node).reduce((sum, t) => sum + setMode(t, mode), 0);
}
