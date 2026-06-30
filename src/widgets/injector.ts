import { defineAsyncComponent, h, ref, type Component } from "vue";
import { app } from "#comfyui/app";
import {
  createDomWidgetHost,
  emptyInjectorRowsValue,
  parseWidgetJson,
  serializeWidgetJson,
  type InjectorRow,
  type InjectorRowsValue,
  type MountTargetNode,
} from "./_shared";
import { attachThemeDetector } from "../extension/theme-detector";
import { reactiveFromGraph, stringArrayEqual } from "../extension/reactive";
import {
  applyCollapsedLabels,
  attachCollapsableConnections,
  isCollapsed as readCollapsed,
  relabelSlotIf,
  setCollapsed,
} from "../extension/collapse-connections";
import {
  collectUpstreamVariables,
  findRootGraph,
  type LiteGraphLike,
  type LiteNodeLike,
} from "../extension/graph";

const InjectorWidget = defineAsyncComponent(
  () => import("../components/injector/InjectorWidget.vue"),
);

type InjectorInput = {
  name?: string;
  type?: string;
  link?: number | null;
  label?: string;
};

type InjectorNode = LiteNodeLike & MountTargetNode & {
  inputs?: Array<InjectorInput | null | undefined>;
  /** litegraph methods for direct socket manipulation. */
  addInput?: (name: string, type: string, extraInfo?: Record<string, unknown>) => InjectorInput;
  removeInput?: (slot: number) => void;
};

/**
 * Slot id used by the row JSON. Sockets we add directly via
 * `node.addInput("input_0", "*")` use bare `input_N` names — no
 * namespace prefix from V3 Autogrow. Workflows saved during the
 * Autogrow phase (`inputs.input_0`) still parse since we strip the
 * namespace.
 */
function injectorSlotName(inp: { name?: string }): string | null {
  if (typeof inp.name !== "string") return null;
  const tail = inp.name.split(".").pop() ?? "";
  return tail.startsWith("input_") ? tail : null;
}

/** Parse the numeric tail of an `input_N` slot name. Returns 999 for
 *  non-matching strings so sorts push junk to the end. */
function parseInputIndex(slotName: string): number {
  const m = slotName.match(/^input_(\d+)$/);
  return m ? parseInt(m[1], 10) : 999;
}

/** Soft cap on dynamic input slots per Injector node. When the
 *  connected count reaches this, no trailing empty is added — user
 *  must disconnect an existing slot before they can wire another.
 *  Workflows loaded with more than MAX connected slots keep them all
 *  (we don't truncate), they just can't grow further until below
 *  the cap. */
const MAX_INJECTOR_SLOTS = 10;

/** Surface used by reindexInjectorSlots — narrow shape over the
 *  LiteGraph node so the algorithm is testable against a plain mock. */
export interface ReindexSurface {
  inputs: Array<{ name?: string; type?: string; link?: number | null } | null | undefined>;
  addInput: (name: string, type: string) => unknown;
  removeInput: (slot: number) => void;
  setDirtyCanvas?: (a: boolean, b: boolean) => void;
}

/** Snapshot, remove disconnected, renumber survivors to contiguous
 *  input_0..input_N, add trailing empty input_N+1. Returns BOTH a
 *  rename map (old name → new name for survivors) AND a removed
 *  set (names of slots that were dropped entirely). Caller uses
 *  removed to drop orphaned rows BEFORE applying the rename map —
 *  otherwise a row whose original socket vanished collides with the
 *  new tenant of its old name (e.g. row@input_0 sticks around after
 *  the original input_0 is disconnected and a different socket gets
 *  renamed INTO input_0). */
export interface ReindexResult {
  renames: Map<string, string>;
  removed: Set<string>;
}

export function reindexInjectorSlots(node: ReindexSurface): ReindexResult {
  const inputs = node.inputs ?? [];

  // 1. Snapshot dynamic slot info BEFORE any mutation.
  type SlotInfo = { idx: number; oldName: string; connected: boolean };
  const dynamic: SlotInfo[] = [];
  for (let i = 0; i < inputs.length; i++) {
    const inp = inputs[i];
    if (!inp) continue;
    const slot = injectorSlotName(inp);
    if (!slot) continue;
    dynamic.push({ idx: i, oldName: slot, connected: inp.link != null });
  }

  // Names of slots about to be dropped — used by caller to filter
  // orphaned rows before applying the rename map.
  const removed = new Set<string>();
  for (const s of dynamic) {
    if (!s.connected) removed.add(s.oldName);
  }

  // 2. Remove all disconnected dynamic slots in reverse so indices
  //    stay valid during the loop.
  for (let k = dynamic.length - 1; k >= 0; k--) {
    if (!dynamic[k].connected) node.removeInput(dynamic[k].idx);
  }

  // 3. Walk remaining dynamic slots in array order. Mutate .name in
  //    place to be contiguous input_0..input_N. Build the rename map
  //    so the caller can update row JSON.
  const renames = new Map<string, string>();
  const after = node.inputs ?? [];
  let counter = 0;
  for (const inp of after) {
    if (!inp) continue;
    const slot = injectorSlotName(inp);
    if (!slot) continue;
    const newName = `input_${counter++}`;
    if (slot !== newName) {
      renames.set(slot, newName);
      inp.name = newName;
    }
  }

  // 4. Add the trailing empty slot at input_${counter}, unless we're
  //    at or above the soft cap. Connected slots over MAX stay (no
  //    truncation), but no new empty slot appears so the user can't
  //    grow further until disconnecting brings count back below cap.
  if (counter < MAX_INJECTOR_SLOTS) {
    node.addInput(`input_${counter}`, "*");
  }

  // 5. Force redraw — LiteGraph reads inputs[i].name lazily at paint,
  //    so .name mutation alone doesn't schedule a repaint.
  if (typeof node.setDirtyCanvas === "function") {
    node.setDirtyCanvas(true, true);
  }

  return { renames, removed };
}

// nextInputName helper was retired with the normalizeSlots rewrite —
// reindexInjectorSlots now controls the trailing-empty's name via a
// simple counter rather than a "find first unused" scan.

/** Move a row from one index to another and reassign every row's
 *  `slot_name` to its new position. Used by the widget's drag-to-
 *  reorder UX: the physical wires at each `input_N` socket stay put,
 *  but the binding (variable name) the user dragged now takes over
 *  the wire feed at its new position.
 *
 *  Pure function — operates on the rows array, doesn't touch litegraph.
 *  The widget calls this, persists the new JSON, and lets the engine
 *  resolve `{input_0, input_1, ...} → variables` by lookup at run time.
 *
 *  Only rows with `input_N` slot_names get renumbered (defensive
 *  check; current architecture always uses `input_N`). */
export function reorderInjectorRows(
  rows: InjectorRow[],
  fromIdx: number,
  toIdx: number,
): InjectorRow[] {
  if (fromIdx === toIdx) return rows;
  if (fromIdx < 0 || fromIdx >= rows.length) return rows;
  if (toIdx < 0 || toIdx > rows.length) return rows;
  // A custom pin label belongs to the physical SOCKET (input_N), which stays
  // put on reorder — only the binding/template moves. Snapshot socket→label
  // BEFORE moving so each row picks up the label of the socket it LANDS on,
  // instead of dragging its old socket's label along (which left a swapped
  // pair both showing the same stale label).
  const pattern = /^input_\d+$/;
  const socketLabel = new Map<string, string | undefined>();
  for (const r of rows) {
    if (pattern.test(r.slot_name)) socketLabel.set(r.slot_name, r.slot_label);
  }
  const moved = rows.slice();
  const [taken] = moved.splice(fromIdx, 1);
  // toIdx is the desired POST-removal insertion index. When toIdx
  // > fromIdx, the splice above already shifted indices down by 1;
  // the caller hands us the visual target so we just insert there.
  const insertAt = toIdx > fromIdx ? toIdx - 1 : toIdx;
  moved.splice(insertAt, 0, taken);
  // Reassign slot_name sequentially so position == socket, and pull the
  // slot_label from the socket that now sits at that position.
  let counter = 0;
  return moved.map((r) => {
    if (!pattern.test(r.slot_name)) return r;
    const newName = `input_${counter++}`;
    const label = socketLabel.get(newName);
    const next: InjectorRow = { ...r, slot_name: newName };
    if (typeof label === "string" && label.trim() !== "") next.slot_label = label;
    else delete next.slot_label;
    return next;
  });
}

export function create(node: InjectorNode, inputName: string) {
  const initial = serializeWidgetJson(
    parseWidgetJson<InjectorRowsValue>("", emptyInjectorRowsValue()),
  );
  const currentJson = ref(initial);

  // Forward-declare so the InjectorWidget setup callbacks (which
  // close over `host` for `requestRelayout`) can be invoked during
  // mount without hitting the const TDZ. createDomWidgetHost
  // synchronously invokes wrapper.setup(), and InjectorWidget's
  // `immediate: true` watch fires `request-min-width` from inside
  // setup — that handler hits `host.requestRelayout()` BEFORE the
  // surrounding `const host = createDomWidgetHost(...)` line had a
  // chance to return + bind. Hoisting to a `let` initialized to null
  // means the early call no-ops on the null check instead of crashing
  // with a ReferenceError.
  let host: ReturnType<typeof createDomWidgetHost> | null = null;

  // State-driven minWidth. Initialized to the worst-case-fits value so
  // the node has a sensible width on first paint, before Vue has
  // mounted and emitted its computed value. InjectorWidget emits a
  // `request-min-width` event whenever its row state changes, which
  // updates this var + triggers a relayout. createDomWidgetHost wires
  // `() => dynamicMinWidth` into widget.computeLayoutSize so each
  // litegraph layout pass reads the current value.
  let dynamicMinWidth = 470;

  // Hoisted refs + compute fns so normalizeSlots (defined below in
  // create() scope, OUTSIDE setup()) can force a refresh of
  // reactiveFromGraph state after renaming inputs[i].name. The
  // reactiveFromGraph chain ran BEFORE our rAF normalize, so those
  // refs hold pre-rename names until we manually re-evaluate them.
  let connectedSlotsRef: import("vue").Ref<string[]> | null = null;
  let slotTypesRef: import("vue").Ref<Record<string, string>> | null = null;
  let slotLabelsRef: import("vue").Ref<Record<string, string>> | null = null;
  let computeConnectedSlotsFn: (() => string[]) | null = null;
  let computeSlotTypesFn: (() => Record<string, string>) | null = null;
  let computeSlotLabelsFn: (() => Record<string, string>) | null = null;


  const wrapper: Component = {
    setup() {
      // Poll-based slot reconciliation. ComfyUI's
      // `onConnectionsChange` callback doesn't fire reliably for V3
      // Autogrow dynamic inputs (verified empirically — wires drop in
      // but no event), so mirror the ContextWidget pattern: walk
      // node.inputs on a poll/event tick and emit the current set of
      // connected `input_*` slot names. Lives inside setup() so
      // Vue's reactivity system + onScopeDispose hooks bind to the
      // active component instance — calling it at module scope leaves
      // the ref dangling.
      // Extract compute fn so normalizeSlots can manually re-run it
      // post-rename (reactiveFromGraph refreshes on onConnectionsChange
      // BEFORE our rAF normalize runs — snapshots are stale by the
      // time the rename mutates inputs[i].name).
      const computeConnectedSlots = (): string[] => {
        const out: string[] = [];
        const inputs = node.inputs ?? [];
        for (const inp of inputs) {
          if (!inp) continue;
          const slot = injectorSlotName(inp);
          if (!slot) continue;
          if (inp.link == null) continue;
          out.push(slot);
        }
        return out;
      };
      const connectedSlots = reactiveFromGraph(
        node as unknown as Parameters<typeof reactiveFromGraph>[0],
        computeConnectedSlots,
        stringArrayEqual,
      );

      // Per-slot type label (STRING / INT / FLOAT / BOOLEAN / *) —
      // resolved by walking the upstream link to the source output's
      // type. The input's own `.type` stays `*` because Autogrow
      // inputs are wildcard-typed; the meaningful type lives on the
      // CONNECTED source socket. Drives the row's type chip + icon.
      const computeSlotTypes = (): Record<string, string> => {
        const out: Record<string, string> = {};
        const inputs = node.inputs ?? [];
        const graph = ((node as unknown as { graph?: { links?: Record<number, { origin_id: number; origin_slot: number }>; getNodeById?: (id: number) => { outputs?: Array<{ type?: string } | null | undefined> } | null }}).graph)
          ?? (app.graph as unknown as { links?: Record<number, { origin_id: number; origin_slot: number }>; getNodeById?: (id: number) => { outputs?: Array<{ type?: string } | null | undefined> } | null });
        if (!graph) return out;
        for (const inp of inputs) {
          if (!inp) continue;
          const slot = injectorSlotName(inp);
          if (!slot) continue;
          if (inp.link == null) continue;
          // Walk the link: input.link → graph.links[id] →
          // origin node → output[origin_slot].type. This is the
          // type ComfyUI actually wired through the connection,
          // not the wildcard-typed Autogrow slot's stored type.
          const link = graph.links?.[inp.link];
          if (!link) continue;
          const origin = graph.getNodeById?.(link.origin_id);
          const sourceOutput = origin?.outputs?.[link.origin_slot];
          const sourceType = sourceOutput?.type;
          if (typeof sourceType === "string" && sourceType !== "*") {
            out[slot] = sourceType;
          }
        }
        return out;
      };
      const slotTypes = reactiveFromGraph(
        node as unknown as Parameters<typeof reactiveFromGraph>[0],
        computeSlotTypes,
        (a, b) => {
          const ak = Object.keys(a);
          if (ak.length !== Object.keys(b).length) return false;
          for (const k of ak) if (a[k] !== b[k]) return false;
          return true;
        },
      );

      // Per-slot LIVE display label (expanded only). ComfyUI lets users
      // rename a socket's .label via its context menu; we surface it in
      // the row tag while expanded so they can correlate row ↔ wire. When
      // COLLAPSED the live .label is our placeholder ("inputs ×N" / " "),
      // not a real label — return {} and let the DURABLE row.slot_label
      // drive the tag (captured on collapse, see persistSlotLabelsToRows).
      // Falls back to slot_name when there's no custom label.
      const computeSlotLabels = (): Record<string, string> => {
        const out: Record<string, string> = {};
        if (readCollapsed(node as Parameters<typeof readCollapsed>[0])) return out;
        const inputs = node.inputs ?? [];
        for (const inp of inputs) {
          if (!inp) continue;
          const slot = injectorSlotName(inp);
          if (!slot) continue;
          if (inp.link == null) continue;
          const resolved = (inp as { label?: string }).label;
          // Skip the default mirroring case (label === name) — row
          // already shows slot_name as fallback. Only publish when
          // the label is genuinely different (= user customization).
          if (typeof resolved === "string" && resolved.trim() !== "" && resolved !== slot) {
            out[slot] = resolved;
          }
        }
        return out;
      };
      const slotLabels = reactiveFromGraph(
        node as unknown as Parameters<typeof reactiveFromGraph>[0],
        computeSlotLabels,
        (a, b) => {
          const ak = Object.keys(a);
          if (ak.length !== Object.keys(b).length) return false;
          for (const k of ak) if (a[k] !== b[k]) return false;
          return true;
        },
      );

      // Variables produced by anything upstream of this injector. Used
      // by the conflict scanner to flag bindings that shadow upstream
      // Context output (`shadows_upstream`, info-level).
      const upstreamVars = reactiveFromGraph(
        node as unknown as Parameters<typeof reactiveFromGraph>[0],
        () => {
          const startGraph =
            (node as unknown as { graph?: LiteGraphLike }).graph
            ?? (app.graph as unknown as LiteGraphLike);
          const rootGraph = findRootGraph(startGraph);
          return collectUpstreamVariables(rootGraph, node);
        },
        stringArrayEqual,
      );

      // Mode tracking for mute (2) / bypass (4) — drives a dim
      // overlay on the widget body so the muted state is visually
      // obvious. reactiveFromGraph hooks node.mode via property
      // descriptor for instant updates (no 400ms poll lag).
      const nodeMode = reactiveFromGraph(
        node as unknown as Parameters<typeof reactiveFromGraph>[0],
        () => (node as unknown as { mode?: number }).mode ?? 0,
        Object.is,
      );

      // Connection-collapse toggle — reactive read of the property
      // we manage via setCollapsed. The header button + reactive
      // pulse keep the widget icon in sync with the property when
      // toggled from any surface (button now, future menu items).
      const connectionsCollapsed = reactiveFromGraph(
        node as unknown as Parameters<typeof reactiveFromGraph>[0],
        () => readCollapsed(node as Parameters<typeof readCollapsed>[0]),
        Object.is,
      );

      // Publish refs + computes to the outer-scope hoists so
      // normalizeSlots can force a refresh post-rename.
      connectedSlotsRef = connectedSlots;
      slotTypesRef = slotTypes;
      slotLabelsRef = slotLabels;
      computeConnectedSlotsFn = computeConnectedSlots;
      computeSlotTypesFn = computeSlotTypes;
      computeSlotLabelsFn = computeSlotLabels;

      return () =>
        h(InjectorWidget, {
          nodeId: node.id,
          initialJson: currentJson.value,
          connectedSlots: connectedSlots.value,
          slotTypes: slotTypes.value,
          slotLabels: slotLabels.value,
          upstreamVars: upstreamVars.value,
          nodeMode: nodeMode.value,
          connectionsCollapsed: connectionsCollapsed.value,
          onToggleConnectionsCollapse: () => {
            // About to collapse? Snapshot the live pin labels into the
            // durable row.slot_label FIRST — collapse overwrites
            // slot.label with the placeholder (and serializes it), so
            // this is the last tick the real custom labels are readable.
            // Expanding needs no capture; expandedLabel restores them.
            if (!readCollapsed(node as Parameters<typeof readCollapsed>[0])) {
              persistSlotLabelsToRows();
            }
            const next = setCollapsed(
              node as Parameters<typeof setCollapsed>[0],
            );
            // Mirror the property change into the reactive ref so the
            // header icon flips this tick without waiting for the
            // 400ms reactive poll.
            connectionsCollapsed.value = next;
          },
          onChange: (json: string) => {
            // `host` is forward-declared as nullable above so the very
            // first `request-min-width` emit (fired during setup, before
            // the `host =` assignment lands) doesn't crash. By the time
            // onChange fires the host is always non-null — Vue's
            // `change` event only fires from user-driven mutations
            // that happen after mount.
            host!.setValue(json);
            // host.setValue is designed not to fire onValueRestored on
            // user-side mutations (prevents persist loops). But we DO
            // want currentJson to reflect the latest so normalizeSlots
            // (which reads currentJson) sees up-to-date rows. Manual
            // sync here.
            if (json !== currentJson.value) currentJson.value = json;
          },
          // Trash-button-from-row → LiteGraph disconnect at the
          // matching slot index. The subsequent onConnectionsChange
          // → normalizeSlots chain handles removal + renumber.
          onDisconnectSlot: (slotName: string) => {
            const idx = (node.inputs ?? []).findIndex(
              (inp) => inp != null && injectorSlotName(inp) === slotName,
            );
            if (idx < 0) return;
            const disconnectFn = (node as unknown as {
              disconnectInput?: (slot: number) => boolean;
            }).disconnectInput;
            if (typeof disconnectFn === "function") {
              disconnectFn.call(node, idx);
            }
          },
          // State-driven minWidth. InjectorWidget computes the
          // required width from its current props/state (which rows
          // render which children, e.g. type chip + conflict badge)
          // and emits it here whenever the value changes. We update
          // our local ref + tell the host to relayout — litegraph
          // then queries computeLayoutSize, which returns our latest
          // value, and applies it via the standard 3-step. No
          // observers, no measurement, no feedback loop.
          onRequestMinWidth: (w: number) => {
            if (w === dynamicMinWidth) return;
            dynamicMinWidth = w;
            // host is null during the very first emit (fired by the
            // `immediate: true` watch inside InjectorWidget.setup()
            // — happens BEFORE createDomWidgetHost has returned the
            // host reference). The initial width was already baked
            // into `dynamicMinWidth`'s seed value (470), so missing
            // that first relayout is harmless; the host's own
            // `computeLayoutSize` will read `dynamicMinWidth` on the
            // first paint anyway.
            host?.requestRelayout();
          },
        });
    },
  };

  host = createDomWidgetHost(node, inputName, wrapper, {
    initialValue: initial,
    // Floor sized for header-only state. The inner caret (pi-caret-
    // down) toggles the rows list visibility; when hidden, only the
    // 26-ish-px header remains. A higher floor would leave the node
    // body taller than the widget content, breaking the autosize
    // contract. ResizeObserver grows past this whenever rows render.
    minHeight: 36,
    // Pull-based width getter — called by litegraph during every
    // relayout. The actual value is computed in InjectorWidget.vue's
    // requiredMinWidth formula (sum of CSS-known child widths based
    // on which children are currently rendered) and emitted via
    // `request-min-width` whenever state changes. We stash it in
    // `dynamicMinWidth` and call host.requestRelayout() so litegraph
    // re-reads the getter.
    minWidth: () => dynamicMinWidth,
    // Height tracks content. Caret-collapse toggles the rows list +
    // shrinks the widget; a user-dragged tall height would otherwise
    // keep the node body large with empty space below the header.
    autoHeight: true,
    onValueRestored: (v: string) => {
      if (v !== currentJson.value) currentJson.value = v;
    },
  });
  attachThemeDetector(host!.widget.element, app);

  // Visual collapse of the dynamic input wires onto input_0's pin.
  // Predicate matches ONLY `input_N` slots so any fixed input (e.g.
  // future upstream context wire) stays at its own position. State
  // lives on node.properties.collapse_connections — persists with
  // the workflow. Collapsed-state label is computed as
  // `inputs ×${count}` so the user can read how many wires are
  // merged into the single pin without expanding.
  const matchDynamicInput = (inp: { name?: string }) =>
    injectorSlotName(inp) !== null;
  attachCollapsableConnections(node as Parameters<typeof attachCollapsableConnections>[0], {
    matchInput: matchDynamicInput as (inp: unknown, idx: number) => boolean,
    collapsedInputLabel: (n) => {
      // Count only WIRED dynamic inputs — the trailing empty input_N
      // shouldn't bump the badge count. Reads "inputs ×N" when more
      // than one wire is merged so the user sees scale at a glance.
      const inputs = (n as { inputs?: Array<{ name?: string; link?: number | null } | null | undefined> }).inputs ?? [];
      let count = 0;
      for (const inp of inputs) {
        if (!inp) continue;
        if (!matchDynamicInput(inp)) continue;
        if (inp.link == null) continue;
        count++;
      }
      return count > 1 ? `inputs ×${count}` : "inputs";
    },
    // Reconstruct the EXPANDED label from durable data, not the in-memory
    // stash (which dies on reload). A pin's real label lives in its row's
    // slot_label (captured on collapse); fall back to undefined = the
    // input_N name. This heals the reload bug — a node saved collapsed
    // baked the placeholder ("inputs ×N" / " ") into the serialized
    // slot.label, and the dead stash made expand restore it — AND
    // preserves a user-renamed pin label across collapse + reload.
    expandedLabel: (slot) => {
      const name = injectorSlotName(slot as { name?: string });
      if (!name) return undefined;
      const parsed = parseWidgetJson<InjectorRowsValue>(
        currentJson.value, emptyInjectorRowsValue(),
      );
      const lbl = parsed.rows.find((r) => r.slot_name === name)?.slot_label;
      return typeof lbl === "string" && lbl.trim() !== "" ? lbl : undefined;
    },
  });

  // Snapshot the live litegraph pin labels into the durable
  // row.slot_label. Called from the collapse toggle while the node is
  // still EXPANDED — the last tick the real custom labels are readable
  // before collapse overwrites slot.label with the placeholder. A pin
  // reset to its default name clears the row's slot_label.
  function persistSlotLabelsToRows(): void {
    const parsed = parseWidgetJson<InjectorRowsValue>(
      currentJson.value, emptyInjectorRowsValue(),
    );
    const inputs = (node.inputs ?? []) as Array<{ name?: string; label?: string } | null | undefined>;
    let changed = false;
    const rows = parsed.rows.map((r) => {
      if (r.kind === "general" || !r.slot_name) return r;
      const inp = inputs.find((i) => i != null && injectorSlotName(i) === r.slot_name);
      const lbl = inp && typeof inp.label === "string" ? inp.label : undefined;
      const custom = lbl && lbl.trim() !== "" && lbl !== r.slot_name ? lbl : undefined;
      if (custom) {
        if (custom !== r.slot_label) { changed = true; return { ...r, slot_label: custom }; }
        return r;
      }
      if (r.slot_label != null) {
        changed = true;
        const rest = { ...r };
        delete rest.slot_label;
        return rest;
      }
      return r;
    });
    if (!changed) return;
    const json = serializeWidgetJson({ ...parsed, rows });
    host!.setValue(json);
    if (json !== currentJson.value) currentJson.value = json;
  }

  // Manual socket management. The schema declares NO dynamic inputs
  // (V3 Autogrow doesn't shrink on disconnect, so we drop it). We
  // maintain ONE trailing empty `input_N` slot at all times — when
  // the user wires it up, we add a fresh empty one; when they
  // disconnect any non-trailing slot, we remove it. Engine-side,
  // `accept_all_inputs=True` lets the node receive arbitrary kwargs.
  function normalizeSlots(): void {
    if (!node.addInput || !node.removeInput) return;
    const { renames, removed } = reindexInjectorSlots(node as ReindexSurface);
    if (renames.size === 0 && removed.size === 0) {
      // Even when no rename happened, addInput may have appended a
      // fresh empty input_N — if we're currently collapsed, blank
      // its label so it doesn't render next to the unified "inputs"
      // label.
      applyCollapsedLabels(node as Parameters<typeof applyCollapsedLabels>[0]);
      return;
    }
    // reindexInjectorSlots mutated inputs[i].name but didn't touch
    // .label. For every renamed slot whose label was the DEFAULT
    // (label === old name), sync the label to the new name so the
    // node body renders consistently. User-customized labels
    // (predicate fails) stay put. relabelSlotIf transparently
    // handles the collapsed case where the label sits in the stash.
    if (renames.size > 0) {
      const inputs = (node.inputs ?? []) as Array<{ name?: string } | null | undefined>;
      for (const [oldName, newName] of renames) {
        const inp = inputs.find((i) => i != null && i.name === newName);
        if (!inp) continue;
        relabelSlotIf(
          inp as Parameters<typeof relabelSlotIf>[0],
          newName,
          (cur) => cur === oldName,
        );
      }
    }
    // The reactiveFromGraph chain refreshed BEFORE our rAF normalize
    // (onConnectionsChange handler order — see reactive.ts). Their
    // snapshots hold pre-rename slot names. Manually re-run the
    // compute fns + assign so connectedSlots / slotTypes match the
    // freshly-mutated inputs[] before the next paint.
    if (connectedSlotsRef && computeConnectedSlotsFn) {
      connectedSlotsRef.value = computeConnectedSlotsFn();
    }
    if (slotTypesRef && computeSlotTypesFn) {
      slotTypesRef.value = computeSlotTypesFn();
    }
    if (slotLabelsRef && computeSlotLabelsFn) {
      slotLabelsRef.value = computeSlotLabelsFn();
    }
    // Push the slot mutation through to row JSON in the same tick.
    // Drop rows whose socket disappeared (removed set), then remap
    // surviving rows to their new socket name (renames map). Reorder
    // by new slot_name so the visual list matches socket pin order.
    // Without this atomic update, the InjectorWidget Vue watcher
    // would false-positive every row as severed and wipe bindings.
    const parsed = parseWidgetJson<InjectorRowsValue>(currentJson.value, emptyInjectorRowsValue());
    const remappedRows = parsed.rows
      .filter((r) => !removed.has(r.slot_name))
      .map((r) => {
        const newName = renames.get(r.slot_name);
        return newName ? { ...r, slot_name: newName } : r;
      })
      .sort((a, b) => parseInputIndex(a.slot_name) - parseInputIndex(b.slot_name));
    const changed =
      remappedRows.length !== parsed.rows.length ||
      remappedRows.some((r, i) => r.slot_name !== parsed.rows[i].slot_name);
    if (changed) {
      const next = serializeWidgetJson({ ...parsed, rows: remappedRows });
      host!.setValue(next);
      // Mirror the manual currentJson sync from the parent's onChange
      // handler — host.setValue only updates internal state, not
      // currentJson. Without this the InjectorWidget watcher reads
      // stale props.initialJson and drops rows whose old slot name
      // is no longer in connectedSlots.
      if (next !== currentJson.value) currentJson.value = next;
    }
    // Renames mutated inputs[i].name in place — if currently
    // collapsed, the stashed `_wpOrigLabel` on each slot no longer
    // matches the new identity, and any newly-added trailing slot
    // is unmasked. Re-apply labels so the unified "inputs" + blank
    // siblings render correctly.
    applyCollapsedLabels(node as Parameters<typeof applyCollapsedLabels>[0]);
  }

  const origOnConnectionsChange = (node as { onConnectionsChange?: (...args: unknown[]) => void })
    .onConnectionsChange;
  (node as { onConnectionsChange?: (...args: unknown[]) => void }).onConnectionsChange =
    function (...args: unknown[]) {
      origOnConnectionsChange?.apply(this, args);
      // Defer to next tick — litegraph hasn't fully settled the
      // inputs array when the event fires.
      requestAnimationFrame(() => normalizeSlots());
    };

  // Initial pass: ensures fresh nodes get a trailing empty slot, and
  // workflows saved with the old V3 Autogrow shape get reduced to
  // connected + 1.
  requestAnimationFrame(() => normalizeSlots());

  return host;
}
