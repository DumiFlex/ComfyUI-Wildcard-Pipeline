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
  removeInput?: (slot: number) => void;
  setSize?: (size: [number, number]) => void;
  size?: [number, number];
  computeSize?: () => [number, number];
};

/**
 * V3 Autogrow inputs are namespaced with the parent input id — `name`
 * is e.g. `inputs.input_0`. The trailing segment (`input_0`) is the
 * stable slot id and matches what the engine receives after the
 * namespace strip in `injector_node.execute`. `label` is NOT used
 * since ComfyUI lets the user rename labels (right-click → Rename),
 * which would break our row-to-slot mapping.
 */
function injectorSlotName(inp: { name?: string }): string | null {
  if (typeof inp.name !== "string") return null;
  const tail = inp.name.split(".").pop() ?? "";
  return tail.startsWith("input_") ? tail : null;
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

  // V3 Autogrow declares all `max` dynamic slots statically — they
  // appear in the socket list whether connected or not, and disconnect
  // doesn't free them. To get the conventional grow-on-connect /
  // shrink-on-disconnect UX (one trailing "+ new input" placeholder),
  // walk `node.inputs` after every connection change and call
  // litegraph's `removeInput` to drop unused trailing `input_*` slots.
  // Keeps exactly one trailing empty slot so the user has somewhere
  // to drop the next wire.
  function normalizeSlots(): void {
    const inputs = node.inputs ?? [];
    if (!node.removeInput) return;
    // Find indices of all `input_*` slots and classify connected vs empty.
    type SlotInfo = { idx: number; connected: boolean };
    const dynamicSlots: SlotInfo[] = [];
    for (let i = 0; i < inputs.length; i++) {
      const inp = inputs[i];
      if (!inp) continue;
      const slot = injectorSlotName(inp);
      if (!slot) continue;
      dynamicSlots.push({ idx: i, connected: inp.link != null });
    }
    // Walk slots in REVERSE so removing earlier ones doesn't shift
    // indices we still need. Keep all connected slots; keep exactly
    // one trailing empty as the "+ new input" affordance; drop the
    // rest.
    let trailingEmptyKept = false;
    for (let k = dynamicSlots.length - 1; k >= 0; k--) {
      const s = dynamicSlots[k];
      if (s.connected) continue;
      if (!trailingEmptyKept) {
        trailingEmptyKept = true;
        continue;
      }
      node.removeInput(s.idx);
    }
  }

  // Hook node.onConnectionsChange. The reactive poll inside the widget
  // handles row state; this hook handles the SOCKET layout (separate
  // concern — the graph node's input array, not the widget JSON).
  const origOnConnectionsChange = (node as { onConnectionsChange?: (...args: unknown[]) => void })
    .onConnectionsChange;
  (node as { onConnectionsChange?: (...args: unknown[]) => void }).onConnectionsChange =
    function (...args: unknown[]) {
      origOnConnectionsChange?.apply(this, args);
      // Defer to next tick — litegraph hasn't fully settled the
      // inputs array when the event fires. requestAnimationFrame is
      // enough; setTimeout(0) also works.
      requestAnimationFrame(() => normalizeSlots());
    };

  // Initial pass for nodes loaded from a saved workflow that may
  // have stale empty slots from the previous Autogrow declaration.
  requestAnimationFrame(() => normalizeSlots());

  return host;
}
