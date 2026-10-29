/**
 * WP Node Group — a frontend-only node that gathers nodes for a WP Toggles
 * mute / bypass control (rgthree's Node Collector + Repeater in one).
 *
 * Inputs grow: there is always one free input at the end, a freed one in
 * the middle goes, and a wired one is labelled with its node's title. Its
 * one output (`WP_NODES`) goes into a toggle's control dot, which then
 * drives every member (`toggle-control.ts:expandTargets` follows it, nested
 * groups included). Muting or bypassing the group node itself repeats that
 * mode to its members; setting it back to always lets them run again.
 *
 * Virtual: never in the prompt, and `getInputLink` answers nothing so the
 * prompt builder never follows it to a member either.
 */
import { expandTargets, originOf, setMode, type CtlInput, type CtlNode } from "./toggle-control";

export { NODE_GROUP_TYPE } from "./toggle-control";
export const NODE_GROUP_OUTPUT = "WP_NODES";
export const MEMBER_PREFIX = "node_";

export interface GroupHostNode extends CtlNode {
  inputs?: (CtlInput & { label?: string })[];
  addInput?: (name: string, type: string) => unknown;
  removeInput?: (slot: number) => void;
}

/** Next free `node_<n>` input name. */
export function nextInputName(node: GroupHostNode): string {
  const used = new Set((node.inputs ?? []).map((i) => i.name));
  let n = 1;
  while (used.has(`${MEMBER_PREFIX}${n}`)) n++;
  return `${MEMBER_PREFIX}${n}`;
}

/**
 * Keep exactly one free input, at the end, and label wired ones with their
 * node's title. Returns true when it changed anything.
 */
export function stabilizeInputs(node: GroupHostNode): boolean {
  let changed = false;
  const inputs = node.inputs ?? [];
  // Free inputs other than the last go (from the end, so indexes hold).
  for (let i = inputs.length - 2; i >= 0; i--) {
    if (inputs[i]?.link == null) {
      node.removeInput?.(i);
      changed = true;
    }
  }
  const now = node.inputs ?? [];
  const last = now[now.length - 1];
  if (!last || last.link != null) {
    node.addInput?.(nextInputName(node), "*");
    changed = true;
  }
  for (const inp of node.inputs ?? []) {
    const origin = originOf(node, inp);
    const label = origin ? origin.title || `#${origin.id}` : undefined;
    if (inp.label !== label) {
      if (label) inp.label = label;
      else delete inp.label;
      changed = true;
    }
  }
  return changed;
}

/** The real nodes the group drives, nested groups and reroutes followed. */
export function members(node: GroupHostNode): CtlNode[] {
  return expandTargets(node).filter((n) => n !== node);
}

/** Set every member to `mode`; returns how many nodes changed. */
export function setMembersMode(node: GroupHostNode, mode: number): number {
  return members(node).reduce((sum, m) => sum + setMode(m, mode), 0);
}

export type MemberMode = "on" | "muted" | "bypassed";

export function modeName(mode: number | undefined): MemberMode {
  return mode === 2 ? "muted" : mode === 4 ? "bypassed" : "on";
}
