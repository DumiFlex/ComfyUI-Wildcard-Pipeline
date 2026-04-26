import { defineAsyncComponent, h, ref, type Component } from "vue";
import { app } from "#comfyui/app";
import {
  createDomWidgetHost, parseWidgetJson, serializeWidgetJson, emptyContextValue,
  type ContextWidgetValue, type MountTargetNode,
} from "./_shared";
import { collectUpstreamVariables, type LiteGraphLike, type LiteNodeLike } from "../extension/graph";
import { reactiveFromGraph, stringArrayEqual } from "../extension/reactive";

const ContextWidget = defineAsyncComponent(() => import("../components/context/ContextWidget.vue"));

type ContextNode = LiteNodeLike & MountTargetNode;

export function create(node: ContextNode, inputName: string) {
  const initial = serializeWidgetJson(parseWidgetJson<ContextWidgetValue>("", emptyContextValue()));
  // Reactive `initialJson` prop — workflow load races (setValue can fire
  // before the async SFC chunk mounts) are handled by the SFC's watch on this
  // prop. No imperative remount, no focus loss on edits.
  const currentJson = ref(initial);

  const wrapper: Component = {
    setup() {
      const upstreamVars = reactiveFromGraph(
        node as unknown as Parameters<typeof reactiveFromGraph>[0],
        () => collectUpstreamVariables(app.graph as unknown as LiteGraphLike, node),
        stringArrayEqual,
      );
      return () => h(ContextWidget, {
        nodeId: node.id,
        initialJson: currentJson.value,
        upstreamVars: upstreamVars.value,
        onChange: (json: string) => host.setValue(json),
      });
    },
  };

  const host = createDomWidgetHost(node, inputName, wrapper, {
    initialValue: initial,
    minHeight: 80,
    minWidth: 280,
    onValueRestored: (v: string) => {
      // Workflow load — push the restored value into the reactive prop so the
      // SFC picks it up whether it has already mounted or not.
      if (v !== currentJson.value) currentJson.value = v;
    },
  });

  return host;
}
