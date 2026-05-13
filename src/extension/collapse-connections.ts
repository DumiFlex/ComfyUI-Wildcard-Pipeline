/**
 * Visually collapse a node's input/output wires onto a single pin
 * position — pattern lifted from rgthree's `setConnectionsCollapse`
 * but lifted out of their subclass so any node can opt in.
 *
 * Mechanism (paint-time hack, no logical change to graph):
 *   1. Patch the node's getInputPos / getOutputPos / getConnectionPos
 *      so every matched slot reports the position of the FIRST matched
 *      slot. Wires fan into one pin, but each link is still its own
 *      logical connection.
 *   2. Patch computeSize so the node shrinks vertically — without
 *      this, hidden slots would leave empty space below.
 *
 * State lives on `node.properties[propertyKey]` so it persists with
 * the workflow JSON. Default key `collapse_connections` is wire-
 * compatible with rgthree (a workflow saved with their node + state
 * read by our scanner would interop, though we don't promise the
 * reverse).
 */

const DEFAULT_PROPERTY_KEY = "collapse_connections";
const FALLBACK_SLOT_HEIGHT = 20;

type Slot = { name?: string; [k: string]: unknown };

export interface CollapseConfig {
  /** Predicate — return true for inputs that participate in the
   *  collapse group. Non-matching inputs render at their normal
   *  position regardless of collapse state. Omit to skip inputs. */
  matchInput?: (input: Slot, index: number) => boolean;
  /** Same predicate, for outputs. Omit to skip outputs. */
  matchOutput?: (output: Slot, index: number) => boolean;
  /** Override the property name used for persistence. Default
   *  `collapse_connections`. Pass a unique key if a node uses
   *  multiple independent collapse groups. */
  propertyKey?: string;
}

/** Internal — minimal node surface used by the patch. Kept generic
 *  so it can absorb LGraphNode without forcing a hard dep on the
 *  litegraph type. */
interface CollapseTargetNode {
  inputs?: Array<Slot | null | undefined>;
  outputs?: Array<Slot | null | undefined>;
  properties?: Record<string, unknown>;
  getInputPos?: (slot: number) => [number, number] | Float32Array;
  getOutputPos?: (slot: number) => [number, number] | Float32Array;
  getConnectionPos?: (
    isInput: boolean,
    slot: number,
    out?: [number, number] | Float32Array,
  ) => [number, number] | Float32Array;
  computeSize?: (out?: [number, number] | Float32Array) => [number, number] | Float32Array;
  setDirtyCanvas?: (foreground: boolean, background: boolean) => void;
  graph?: { setDirtyCanvas?: (a: boolean, b: boolean) => void } | null | undefined;
}

const ATTACHED_MARKER = "__wpCollapseAttached";

function readCollapsed(node: CollapseTargetNode, key: string): boolean {
  return !!node.properties?.[key];
}

function nodeSlotHeight(): number {
  const lg = (globalThis as { LiteGraph?: { NODE_SLOT_HEIGHT?: number } }).LiteGraph;
  return lg?.NODE_SLOT_HEIGHT ?? FALLBACK_SLOT_HEIGHT;
}

/** Walk a slot list, return the index of the first slot matching
 *  the predicate. -1 if none match. Exported so tests can reuse the
 *  exact resolution rule. */
export function firstMatchingIndex(
  slots: Array<Slot | null | undefined> | undefined,
  match: (s: Slot, i: number) => boolean,
): number {
  if (!slots) return -1;
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    if (s && match(s, i)) return i;
  }
  return -1;
}

/** Count how many slots in a list match the predicate. */
export function countMatching(
  slots: Array<Slot | null | undefined> | undefined,
  match: (s: Slot, i: number) => boolean,
): number {
  if (!slots) return 0;
  let n = 0;
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    if (s && match(s, i)) n++;
  }
  return n;
}

/** Patch the node so its slot-position methods reroute matched
 *  slots to the first matched slot's position when collapsed. Safe
 *  to call once per node — re-calling no-ops. */
export function attachCollapsableConnections(
  node: CollapseTargetNode,
  cfg: CollapseConfig = {},
): void {
  const target = node as CollapseTargetNode & Record<string, unknown>;
  if (target[ATTACHED_MARKER]) return;
  target[ATTACHED_MARKER] = true;

  const propertyKey = cfg.propertyKey ?? DEFAULT_PROPERTY_KEY;
  node.properties = node.properties ?? {};

  // Patch the three position resolvers. Each falls through to the
  // original method when collapse is off OR the slot doesn't match
  // the predicate.
  const origInputPos = node.getInputPos?.bind(node);
  const origOutputPos = node.getOutputPos?.bind(node);
  const origConnPos = node.getConnectionPos?.bind(node);

  function resolveInputPos(slotNumber: number): [number, number] | Float32Array {
    const collapsed = readCollapsed(node, propertyKey);
    if (!collapsed || !cfg.matchInput) return origInputPos?.(slotNumber) ?? [0, 0];
    const slot = node.inputs?.[slotNumber];
    if (!slot || !cfg.matchInput(slot, slotNumber)) return origInputPos?.(slotNumber) ?? [0, 0];
    const first = firstMatchingIndex(node.inputs, cfg.matchInput);
    return origInputPos?.(first >= 0 ? first : slotNumber) ?? [0, 0];
  }

  function resolveOutputPos(slotNumber: number): [number, number] | Float32Array {
    const collapsed = readCollapsed(node, propertyKey);
    if (!collapsed || !cfg.matchOutput) return origOutputPos?.(slotNumber) ?? [0, 0];
    const slot = node.outputs?.[slotNumber];
    if (!slot || !cfg.matchOutput(slot, slotNumber)) return origOutputPos?.(slotNumber) ?? [0, 0];
    const first = firstMatchingIndex(node.outputs, cfg.matchOutput);
    return origOutputPos?.(first >= 0 ? first : slotNumber) ?? [0, 0];
  }

  if (origInputPos) {
    node.getInputPos = (slot: number) => resolveInputPos(slot);
  }
  if (origOutputPos) {
    node.getOutputPos = (slot: number) => resolveOutputPos(slot);
  }
  // Pre-v0.9.9 fallback. New litegraph routes through getInputPos /
  // getOutputPos; keeping getConnectionPos in sync covers older
  // hosts and any callers that still hit the legacy method.
  if (origConnPos) {
    node.getConnectionPos = (isInput: boolean, slot: number) =>
      isInput ? resolveInputPos(slot) : resolveOutputPos(slot);
  }

  // Shrink node height by (hiddenInputs + hiddenOutputs) × slotH so
  // collapsed slots don't leave empty rows. Hidden = matched-minus-1
  // on each side (the first matched slot still occupies its row).
  const origComputeSize = node.computeSize?.bind(node);
  if (origComputeSize) {
    node.computeSize = (out) => {
      const size = origComputeSize(out);
      if (!readCollapsed(node, propertyKey)) return size;
      const hiddenInputs = cfg.matchInput
        ? Math.max(0, countMatching(node.inputs, cfg.matchInput) - 1)
        : 0;
      const hiddenOutputs = cfg.matchOutput
        ? Math.max(0, countMatching(node.outputs, cfg.matchOutput) - 1)
        : 0;
      const totalHidden = Math.max(hiddenInputs, hiddenOutputs);
      if (totalHidden > 0) size[1] = Math.max(0, size[1] - totalHidden * nodeSlotHeight());
      return size;
    };
  }
}

/** Current collapsed state — reads `node.properties[propertyKey]`. */
export function isCollapsed(
  node: CollapseTargetNode,
  propertyKey: string = DEFAULT_PROPERTY_KEY,
): boolean {
  return readCollapsed(node, propertyKey);
}

/** Toggle (default) or set the collapsed flag. Triggers a canvas
 *  repaint via setDirtyCanvas — either the node-local hook or the
 *  parent graph's. Returns the new state. */
export function setCollapsed(
  node: CollapseTargetNode,
  next?: boolean,
  propertyKey: string = DEFAULT_PROPERTY_KEY,
): boolean {
  node.properties = node.properties ?? {};
  const current = !!node.properties[propertyKey];
  const resolved = next === undefined ? !current : next;
  node.properties[propertyKey] = resolved;
  // Prefer the graph-level repaint (covers wires + node body in one
  // call). Fall back to node-local if no graph hook is reachable.
  if (typeof node.graph?.setDirtyCanvas === "function") {
    node.graph.setDirtyCanvas(true, true);
  } else if (typeof node.setDirtyCanvas === "function") {
    node.setDirtyCanvas(true, true);
  }
  return resolved;
}
