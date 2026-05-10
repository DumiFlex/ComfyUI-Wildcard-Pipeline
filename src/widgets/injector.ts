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
import type { LiteNodeLike } from "../extension/graph";

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

/** Next available `input_N` name not currently on the node. */
function nextInputName(inputs: Array<InjectorInput | null | undefined>): string {
  const used = new Set<string>();
  for (const inp of inputs) {
    if (!inp) continue;
    const slot = injectorSlotName(inp);
    if (slot) used.add(slot);
  }
  for (let i = 0; i < 100; i++) {
    const name = `input_${i}`;
    if (!used.has(name)) return name;
  }
  return `input_${inputs.length}`;  // fallback — should never hit
}

export function create(node: InjectorNode, inputName: string) {
  const initial = serializeWidgetJson(
    parseWidgetJson<InjectorRowsValue>("", emptyInjectorRowsValue()),
  );
  const currentJson = ref(initial);

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
      const connectedSlots = reactiveFromGraph(
        node as unknown as Parameters<typeof reactiveFromGraph>[0],
        () => {
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
        },
        stringArrayEqual,
      );

      // Per-slot type label (STRING / INT / FLOAT / BOOLEAN / *) —
      // read from the input's `type` field (set by ComfyUI when the
      // connection resolves). Drives the row's type chip.
      const slotTypes = reactiveFromGraph(
        node as unknown as Parameters<typeof reactiveFromGraph>[0],
        () => {
          const out: Record<string, string> = {};
          const inputs = node.inputs ?? [];
          for (const inp of inputs) {
            if (!inp) continue;
            const slot = injectorSlotName(inp);
            if (!slot) continue;
            if (inp.link == null) continue;
            if (typeof inp.type === "string" && inp.type !== "*") {
              out[slot] = inp.type;
            }
          }
          return out;
        },
        (a, b) => {
          const ak = Object.keys(a);
          if (ak.length !== Object.keys(b).length) return false;
          for (const k of ak) if (a[k] !== b[k]) return false;
          return true;
        },
      );

      return () =>
        h(InjectorWidget, {
          nodeId: node.id,
          initialJson: currentJson.value,
          connectedSlots: connectedSlots.value,
          slotTypes: slotTypes.value,
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
    const inputs = node.inputs ?? [];
    if (!node.addInput || !node.removeInput) return;
    type SlotInfo = { idx: number; connected: boolean; name: string };
    const dynamicSlots: SlotInfo[] = [];
    for (let i = 0; i < inputs.length; i++) {
      const inp = inputs[i];
      if (!inp) continue;
      const slot = injectorSlotName(inp);
      if (!slot) continue;
      dynamicSlots.push({ idx: i, connected: inp.link != null, name: slot });
    }
    // Drop empty slots — we'll add exactly one trailing back below.
    // Walk in reverse so index removal doesn't shift higher entries.
    for (let k = dynamicSlots.length - 1; k >= 0; k--) {
      const s = dynamicSlots[k];
      if (!s.connected) node.removeInput(s.idx);
    }
    // Ensure exactly one trailing empty slot exists. Re-read inputs
    // since removeInput mutated the array.
    const after = node.inputs ?? [];
    const hasEmpty = after.some((inp) => {
      if (!inp) return false;
      if (!injectorSlotName(inp)) return false;
      return inp.link == null;
    });
    if (!hasEmpty) {
      const name = nextInputName(after);
      node.addInput(name, "*");
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
