import { defineAsyncComponent, h, ref, type Component } from "vue";
import { app } from "#comfyui/app";
import {
  createDomWidgetHost,
  emptyInjectorRowsValue,
  parseWidgetJson,
  serializeWidgetJson,
  type InjectorRowsValue,
  type MountTargetNode,
} from "./_shared";
import { attachThemeDetector } from "../extension/theme-detector";
import { reactiveFromGraph, stringArrayEqual } from "../extension/reactive";
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

  // 4. Add the trailing empty slot at input_${counter}.
  node.addInput(`input_${counter}`, "*");

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

export function create(node: InjectorNode, inputName: string) {
  const initial = serializeWidgetJson(
    parseWidgetJson<InjectorRowsValue>("", emptyInjectorRowsValue()),
  );
  const currentJson = ref(initial);

  // Hoisted refs + compute fns so normalizeSlots (defined below in
  // create() scope, OUTSIDE setup()) can force a refresh of
  // reactiveFromGraph state after renaming inputs[i].name. The
  // reactiveFromGraph chain ran BEFORE our rAF normalize, so those
  // refs hold pre-rename names until we manually re-evaluate them.
  let connectedSlotsRef: import("vue").Ref<string[]> | null = null;
  let slotTypesRef: import("vue").Ref<Record<string, string>> | null = null;
  let computeConnectedSlotsFn: (() => string[]) | null = null;
  let computeSlotTypesFn: (() => Record<string, string>) | null = null;

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

      // Publish refs + computes to the outer-scope hoists so
      // normalizeSlots can force a refresh post-rename.
      connectedSlotsRef = connectedSlots;
      slotTypesRef = slotTypes;
      computeConnectedSlotsFn = computeConnectedSlots;
      computeSlotTypesFn = computeSlotTypes;

      return () =>
        h(InjectorWidget, {
          nodeId: node.id,
          initialJson: currentJson.value,
          connectedSlots: connectedSlots.value,
          slotTypes: slotTypes.value,
          upstreamVars: upstreamVars.value,
          nodeMode: nodeMode.value,
          onChange: (json: string) => host.setValue(json),
        });
    },
  };

  const host = createDomWidgetHost(node, inputName, wrapper, {
    initialValue: initial,
    minHeight: 80,
    minWidth: 280,
    onValueRestored: (v: string) => {
      if (v !== currentJson.value) currentJson.value = v;
    },
  });
  attachThemeDetector(host.widget.element, app);

  // Manual socket management. The schema declares NO dynamic inputs
  // (V3 Autogrow doesn't shrink on disconnect, so we drop it). We
  // maintain ONE trailing empty `input_N` slot at all times — when
  // the user wires it up, we add a fresh empty one; when they
  // disconnect any non-trailing slot, we remove it. Engine-side,
  // `accept_all_inputs=True` lets the node receive arbitrary kwargs.
  function normalizeSlots(): void {
    if (!node.addInput || !node.removeInput) return;
    const { renames, removed } = reindexInjectorSlots(node as ReindexSurface);
    if (renames.size === 0 && removed.size === 0) return;
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
      host.setValue(serializeWidgetJson({ ...parsed, rows: remappedRows }));
    }
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
