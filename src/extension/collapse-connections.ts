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
 *   3. Mutate `.label` on matched slots: first matched slot shows the
 *      configured unified label (e.g. "inputs"), the rest get a blank
 *      " " so litegraph doesn't render their names overlapping at the
 *      same Y. Original labels are stashed in the module-private
 *      `slotOrigLabel` WeakMap and restored on expand.
 *
 * State lives on `node.properties[propertyKey]` so it persists with
 * the workflow JSON. Default key `collapse_connections` is wire-
 * compatible with rgthree. Transient metadata (label stash, attach
 * marker, per-node config) lives in WeakMaps from `_stashes.ts` so
 * other extensions can't read or collide with our internals.
 */

import {
  nodeCollapseAnimating,
  nodeCollapseAnimToken,
  nodeCollapseAttached,
  nodeCollapseConfig,
  slotLabelStashed,
  slotOrigLabel,
} from "./_stashes";

const DEFAULT_PROPERTY_KEY = "collapse_connections";
const FALLBACK_SLOT_HEIGHT = 20;
/** LiteGraph default node-size grid. Mirrored from `_shared.ts` —
 *  duplicated rather than imported because this module is pure
 *  extension logic with no Vue dependency, and the constant is one
 *  number. Bumping here means bumping there too. */
const NODE_SIZE_GRID = 10;
function snapToGrid(n: number): number {
  return Math.round(n / NODE_SIZE_GRID) * NODE_SIZE_GRID;
}

type Slot = { name?: string; label?: string; [k: string]: unknown };

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
  /** Label shown on the FIRST matched input slot when collapsed.
   *  All other matched inputs render with a blank " " label so their
   *  names don't overlap. Pass a static string (e.g. "inputs") or a
   *  function for dynamic content (e.g. count-aware). Omit to keep
   *  the original label on the first slot. */
  collapsedInputLabel?: string | ((node: CollapseTargetNode) => string);
  /** Mirror of collapsedInputLabel for outputs. */
  collapsedOutputLabel?: string | ((node: CollapseTargetNode) => string);
}

/** Internal — minimal node surface used by the patch. Kept generic
 *  so it can absorb LGraphNode without forcing a hard dep on the
 *  litegraph type. */
interface CollapseTargetNode {
  inputs?: Array<Slot | null | undefined>;
  outputs?: Array<Slot | null | undefined>;
  properties?: Record<string, unknown>;
  size?: [number, number] | Float32Array;
  getInputPos?: (slot: number) => [number, number] | Float32Array;
  getOutputPos?: (slot: number) => [number, number] | Float32Array;
  getConnectionPos?: (
    isInput: boolean,
    slot: number,
    out?: [number, number] | Float32Array,
  ) => [number, number] | Float32Array;
  computeSize?: (out?: [number, number] | Float32Array) => [number, number] | Float32Array;
  setSize?: (size: [number, number]) => void;
  setDirtyCanvas?: (foreground: boolean, background: boolean) => void;
  graph?: { setDirtyCanvas?: (a: boolean, b: boolean) => void } | null | undefined;
}

function readCollapsed(node: CollapseTargetNode, key: string): boolean {
  return !!node.properties?.[key];
}

function readConfig(node: CollapseTargetNode): CollapseConfig | undefined {
  return nodeCollapseConfig.get(node as object) as CollapseConfig | undefined;
}

function nodeSlotHeight(): number {
  const lg = (globalThis as { LiteGraph?: { NODE_SLOT_HEIGHT?: number } }).LiteGraph;
  return lg?.NODE_SLOT_HEIGHT ?? FALLBACK_SLOT_HEIGHT;
}

function resolveLabel(
  raw: CollapseConfig["collapsedInputLabel"],
  node: CollapseTargetNode,
): string | undefined {
  if (raw === undefined) return undefined;
  return typeof raw === "function" ? raw(node) : raw;
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

/** Mutate matched slots' `.label` based on current collapsed state.
 *  Collapsed: first matched slot gets the configured unified label
 *  (or the original if no config), all other matched slots get a
 *  blank " " so litegraph doesn't render them overlapping. Expanded:
 *  restore stashed `_wpOrigLabel` (set during the collapse pass).
 *
 *  Stash presence is tracked via the `in` operator rather than a
 *  value comparison — slots without an explicit `.label` rely on
 *  litegraph's `label || name` fallback at paint, so the stashed
 *  value can legitimately be `undefined`. Using `"_wpOrigLabel" in
 *  slot` lets us distinguish "never stashed" from "stashed as
 *  undefined", and `delete slot.label` on restore re-enables the
 *  name-fallback rather than leaving an empty string sitting there.
 *
 *  Exported so callers that mutate inputs/outputs at runtime can
 *  manually re-sync labels (e.g. injector adds an input_N after
 *  reindex — the new slot needs its blank label applied if the node
 *  is currently collapsed). */
export function applyCollapsedLabels(node: CollapseTargetNode): void {
  const cfg = readConfig(node);
  if (!cfg) return;
  const propertyKey = cfg.propertyKey ?? DEFAULT_PROPERTY_KEY;
  const collapsed = readCollapsed(node, propertyKey);

  const sides: Array<{
    slots: Array<Slot | null | undefined> | undefined;
    match: ((s: Slot, i: number) => boolean) | undefined;
    label: string | undefined;
  }> = [
    {
      slots: node.inputs,
      match: cfg.matchInput,
      label: resolveLabel(cfg.collapsedInputLabel, node),
    },
    {
      slots: node.outputs,
      match: cfg.matchOutput,
      label: resolveLabel(cfg.collapsedOutputLabel, node),
    },
  ];

  for (const { slots, match, label } of sides) {
    if (!slots || !match) continue;
    const first = firstMatchingIndex(slots, match);
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      if (!slot || !match(slot, i)) continue;
      if (collapsed) {
        // First-time-collapse stash. Capture whatever .label is now
        // (possibly undefined if the slot used name-fallback). The
        // WeakSet `has` check is critical: a slot already collapsed
        // once has its label stashed (even if as `undefined`) —
        // re-stashing would overwrite it with our placeholder (" ")
        // and corrupt the next restore.
        if (!slotLabelStashed.has(slot as object)) {
          slotOrigLabel.set(slot as object, slot.label);
          slotLabelStashed.add(slot as object);
        }
        const stashed = slotOrigLabel.get(slot as object);
        if (i === first) {
          // Unified label if configured; otherwise restore the
          // original (handles cases where the caller doesn't supply
          // a label but still wants other slots blanked).
          slot.label = label !== undefined ? label : stashed;
        } else {
          slot.label = " ";
        }
      } else if (slotLabelStashed.has(slot as object)) {
        // Restore. If the original was undefined, delete the .label
        // key so litegraph's name-fallback resumes — assigning
        // undefined would leave the property defined with a falsy
        // value, which some hosts render as empty string.
        const stashed = slotOrigLabel.get(slot as object);
        if (stashed === undefined) {
          delete slot.label;
        } else {
          slot.label = stashed;
        }
        slotOrigLabel.delete(slot as object);
        slotLabelStashed.delete(slot as object);
      }
    }
  }
}

/** Animation duration for the collapse/expand height tween. Short
 *  enough to feel snappy, long enough to read as motion (not a
 *  snap). Bypassed when `wp-a11y-no-motion` is on the body. */
const COLLAPSE_ANIM_MS = 200;

function prefersReducedMotion(): boolean {
  if (typeof document === "undefined") return false;
  return document.body.classList.contains("wp-a11y-no-motion");
}

/** Smooth tween of `node.size[1]` from current to target height.
 *  Animation cancels cleanly if `setCollapsed` is invoked again
 *  mid-tween (token bump check on each rAF tick). Falls back to a
 *  snap (single setSize) when reduced motion is requested or when
 *  the delta is small enough that animation would be invisible. */
function animateResize(node: CollapseTargetNode, targetH: number): void {
  if (!node.size) return;
  const startH = node.size[1];
  const delta = targetH - startH;
  // <3px delta — not worth the rAF round-trip.
  if (Math.abs(delta) < 3 || prefersReducedMotion()) {
    snapToSize(node, targetH);
    return;
  }

  const prevToken = nodeCollapseAnimToken.get(node as object) ?? 0;
  const myToken = prevToken + 1;
  nodeCollapseAnimToken.set(node as object, myToken);
  // Tell the widget autosize machinery to pause: `pushSize` and
  // `requestRelayout` in `widgets/_shared.ts` would otherwise fire
  // a setSize the moment Vue removes the collapsed rows from the DOM,
  // overriding our captured `startH` and leaving the tween to start
  // from the already-collapsed height (visible as: instant snap to
  // target, then an animation that bounces back to the start before
  // tweening down). Cleared in the `else` branch when the tween
  // finishes — or implicitly garbage-collected with the node.
  nodeCollapseAnimating.add(node as object);

  const start = performance.now();
  function step(now: number): void {
    // A newer token means a fresh toggle superseded us — bail so
    // the two animations don't fight over node.size[1].
    if (nodeCollapseAnimToken.get(node as object) !== myToken) return;
    const t = Math.min(1, (now - start) / COLLAPSE_ANIM_MS);
    // easeInOutQuad — symmetric ease, no overshoot.
    const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    const nextH = startH + delta * eased;
    if (node.size) node.size[1] = nextH;
    node.setDirtyCanvas?.(true, true);
    if (t < 1) {
      requestAnimationFrame(step);
    } else {
      // Tween finished. Clear the autosize-suppression flag BEFORE
      // calling snapToSize so the final setSize lands through the
      // normal pipeline + any deferred pushSize fires once on the
      // next observer tick to land on the now-snapped target.
      nodeCollapseAnimating.delete(node as object);
      // Snap to exact target at end + go through setSize so any
      // host-side layout hooks fire on completion.
      snapToSize(node, targetH);
    }
  }
  requestAnimationFrame(step);
}

function snapToSize(node: CollapseTargetNode, targetH: number): void {
  if (!node.size) return;
  // Preserve the current width — collapse should only affect height.
  // Some hosts (ComfyUI) widen nodes manually past computeSize's
  // suggested width; respecting that avoids visible width snap-back.
  // Snap both axes: targetH (from forceResize) is already snapped, but
  // the current width can drift off-grid via cumulative setSize calls
  // or restored workflow JSON. Snapping here lands the collapse end
  // on the same lattice the widget autosize uses, so pushSize won't
  // fire a second corrective setSize a moment later — the visible
  // "size then snap" two-step the user reported.
  const targetW = snapToGrid(node.size[0]);
  const snappedH = snapToGrid(targetH);
  if (typeof node.setSize === "function") {
    node.setSize([targetW, snappedH]);
  } else {
    node.size[1] = snappedH;
  }
  node.setDirtyCanvas?.(true, true);
}

/** Compute the post-collapse target height via computeSize + apply
 *  it. Defaults to an animated tween for user toggles; pass
 *  `{ animate: false }` for workflow-load initialization so the
 *  pre-collapsed state doesn't briefly flash at expanded height
 *  before animating down. */
function forceResize(node: CollapseTargetNode, opts: { animate?: boolean } = {}): void {
  if (!node.computeSize) return;
  const next = node.computeSize();
  // Snap the height target at source so the animation tween ends on
  // the same 10px grid the widget's autosize lands on. Otherwise the
  // tween would settle at an off-grid pixel, pushSize would fire a
  // corrective setSize a microtask later, and the user would see
  // "animation finishes here, then jumps to grid."
  const h = snapToGrid((next as { 1: number })[1]);
  if (opts.animate === false) snapToSize(node, h);
  else animateResize(node, h);
}

/** Patch the node so its slot-position methods reroute matched
 *  slots to the first matched slot's position when collapsed. Safe
 *  to call once per node — re-calling no-ops. */
export function attachCollapsableConnections(
  node: CollapseTargetNode,
  cfg: CollapseConfig = {},
): void {
  if (nodeCollapseAttached.has(node as object)) return;
  nodeCollapseAttached.add(node as object);
  nodeCollapseConfig.set(node as object, cfg);

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

  // Workflows can load with collapse_connections=true (state persists
  // in node.properties). Apply labels + resize immediately so the
  // node renders correctly on first paint without waiting for a
  // toggle. Skip animation so the user doesn't see a brief expanded
  // flash before the tween settles to the saved collapsed height.
  if (readCollapsed(node, propertyKey)) {
    applyCollapsedLabels(node);
    forceResize(node, { animate: false });
  }
}

/** Rename a slot's display label IF the current label matches a
 *  predicate. Handles both expanded (live `.label`) and collapsed
 *  (stashed via the slotOrigLabel WeakMap) states transparently —
 *  callers that rename slots programmatically can use this to keep
 *  labels in sync without knowing whether the node is currently
 *  collapsed.
 *
 *  Typical use: after renaming `slot.name` from "input_3" to
 *  "input_2", call with `predicate: (cur) => cur === "input_3"` so
 *  the label only updates when it was the DEFAULT mirroring the old
 *  name. User-customized labels (predicate fails) stay put. */
export function relabelSlotIf(
  slot: Slot,
  newLabel: string | undefined,
  predicate: (currentLabel: string | undefined) => boolean,
): void {
  const inStash = slotLabelStashed.has(slot as object);
  const current = inStash ? slotOrigLabel.get(slot as object) : slot.label;
  if (!predicate(current)) return;
  if (inStash) {
    slotOrigLabel.set(slot as object, newLabel);
  } else if (newLabel === undefined) {
    delete slot.label;
  } else {
    slot.label = newLabel;
  }
}

/** Read the slot's effective display label — returns the stashed
 *  original when collapsed (so callers see the user-visible value
 *  rather than our " " placeholder), otherwise the live `.label`.
 *  Exported so consumers like the injector compute layer can surface
 *  the right value in DOM widgets without needing to know about the
 *  stash internals. */
export function readSlotLabel(slot: Slot): string | undefined {
  if (slotLabelStashed.has(slot as object)) {
    return slotOrigLabel.get(slot as object);
  }
  return slot.label;
}

/** Current collapsed state — reads `node.properties[propertyKey]`. */
export function isCollapsed(
  node: CollapseTargetNode,
  propertyKey: string = DEFAULT_PROPERTY_KEY,
): boolean {
  return readCollapsed(node, propertyKey);
}

/** Toggle (default) or set the collapsed flag. Applies the label
 *  swap + size recalculation if the node was wired through
 *  attachCollapsableConnections, then triggers a canvas repaint.
 *  Returns the new state. */
export function setCollapsed(
  node: CollapseTargetNode,
  next?: boolean,
  propertyKey: string = DEFAULT_PROPERTY_KEY,
): boolean {
  node.properties = node.properties ?? {};
  const current = !!node.properties[propertyKey];
  const resolved = next === undefined ? !current : next;
  node.properties[propertyKey] = resolved;

  // If the node was attached via attachCollapsableConnections, the
  // stored cfg lets us apply unified labels + force the size
  // recompute. Callers using setCollapsed without attaching first
  // still get the property flip + repaint, just no extras.
  if (readConfig(node)) {
    applyCollapsedLabels(node);
    forceResize(node);
  }

  // Prefer the graph-level repaint (covers wires + node body in one
  // call). Fall back to node-local if no graph hook is reachable.
  if (typeof node.graph?.setDirtyCanvas === "function") {
    node.graph.setDirtyCanvas(true, true);
  } else if (typeof node.setDirtyCanvas === "function") {
    node.setDirtyCanvas(true, true);
  }
  return resolved;
}
