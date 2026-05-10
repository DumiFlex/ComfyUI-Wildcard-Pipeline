import { defineAsyncComponent, h, ref, type Component, type ComponentPublicInstance } from "vue";
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
import type { LiteNodeLike } from "../extension/graph";

const InjectorWidget = defineAsyncComponent(
  () => import("../components/injector/InjectorWidget.vue"),
);

type InjectorNode = LiteNodeLike & MountTargetNode & {
  onConnectionsChange?: (
    type: number,
    slotIndex: number,
    isConnected: boolean,
    link: unknown,
    slotInfo: { name?: string },
  ) => void;
  inputs?: Array<{ name?: string; link?: number | null } | null | undefined>;
};

interface InjectorWidgetExposed {
  addRow: (slotName: string) => void;
  removeRow: (uid: string) => void;
}

export function create(node: InjectorNode, inputName: string) {
  const initial = serializeWidgetJson(
    parseWidgetJson<InjectorRowsValue>("", emptyInjectorRowsValue()),
  );
  const currentJson = ref(initial);
  const widgetRef = ref<(ComponentPublicInstance & InjectorWidgetExposed) | null>(null);

  const wrapper: Component = {
    setup() {
      return () =>
        h(InjectorWidget, {
          ref: widgetRef,
          nodeId: node.id,
          initialJson: currentJson.value,
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

  // Listen for ComfyUI socket events. ComfyUI calls
  // onConnectionsChange(type, slotIndex, isConnected, link, slotInfo)
  // where type 1 = input, type 2 = output. We only care about inputs.
  const TYPE_INPUT = 1;
  const origOnConnectionsChange = node.onConnectionsChange?.bind(node);
  node.onConnectionsChange = function (type, slotIndex, isConnected, link, slotInfo) {
    origOnConnectionsChange?.(type, slotIndex, isConnected, link, slotInfo);
    if (type !== TYPE_INPUT) return;
    if (!isConnected) return; // disconnect → row stays (handled inside widget)
    const slotName = slotInfo?.name ?? node.inputs?.[slotIndex]?.name;
    // The static `upstream` + `rows` sockets always exist; only add a
    // row when the connected slot is one of the dynamic `input_*`.
    if (typeof slotName !== "string" || !slotName.startsWith("input_")) return;
    widgetRef.value?.addRow(slotName);
  };

  return host;
}
