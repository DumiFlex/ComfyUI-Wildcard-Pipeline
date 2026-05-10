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

type InjectorNode = LiteNodeLike & MountTargetNode & {
  inputs?: Array<{ name?: string; link?: number | null; type?: string } | null | undefined>;
};

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
            if (!inp || typeof inp.name !== "string") continue;
            if (!inp.name.startsWith("input_")) continue;
            if (inp.link == null) continue;
            out.push(inp.name);
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
            if (!inp || typeof inp.name !== "string") continue;
            if (!inp.name.startsWith("input_")) continue;
            if (inp.link == null) continue;
            if (typeof inp.type === "string" && inp.type !== "*") {
              out[inp.name] = inp.type;
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

  return host;
}
