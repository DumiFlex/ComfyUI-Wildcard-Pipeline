import { computed, defineAsyncComponent, h, ref, type Component } from "vue";
import { app } from "#comfyui/app";
import {
  collectUpstreamProducers,
  collectUpstreamVariables,
  findRootGraph,
  type LiteGraphLike,
  type LiteNodeLike,
} from "../extension/graph";
import { createDomWidgetHost, isMirrorBuild, serializeWidgetJson, type MountTargetNode } from "./_shared";
import { nodeEditors } from "../extension/_stashes";
import { reactiveFromGraph, stringArrayEqual } from "../extension/reactive";
import { padConfig, sliderOutputType, sliderRows, type SlidersConfig } from "../extension/sliders";

const SliderPadWidget = defineAsyncComponent(
  () => import("../components/sliders/SliderPadWidget.vue"),
);

interface PadOutput {
  name: string;
  type: string;
  label?: string;
  localized_name?: string;
}

export interface SliderPadHostNode extends MountTargetNode {
  setDirtyCanvas?: (fg: boolean, bg?: boolean) => void;
  mode?: number;
  outputs?: PadOutput[];
}

/** Label and type (INT or FLOAT, `sliderOutputType`) of the x, y (and z)
 *  outputs. The schema says `*`, so any number input takes them. */
export function relabelPad(node: SliderPadHostNode, cfg: SlidersConfig, dims: 2 | 3 = 2): void {
  const outs = node.outputs ?? [];
  sliderRows(cfg).slice(0, dims).forEach((s, i) => {
    const slot = outs[i + 1];
    if (!slot) return;
    slot.type = sliderOutputType(s);
    slot.label = s.name;
    slot.localized_name = s.name;
  });
}

/**
 * Mount glue for WP_Slider2D's one widget (`WP_SLIDER_PAD`) and, with
 * `dims` 3, WP_Slider3D's (`WP_SLIDER_3D`). The value is the JSON
 * `SlidersConfig` with two rows, X then Y, or three plus an optional phrase
 * (`padConfig`); the node parses it at run time like WP Slider's. The
 * outputs are named after the axes and typed from them.
 */
export function create(node: SliderPadHostNode, inputName: string, dims: 2 | 3 = 2) {
  const mirrored = isMirrorBuild(node);
  const config = ref<SlidersConfig>(padConfig("", dims));
  const editRequest = ref(0);
  if (!mirrored) {
    nodeEditors.set(node, () => {
      editRequest.value += 1;
    });
  }

  function store(next: SlidersConfig): void {
    config.value = next;
    host.setValue(serializeWidgetJson(next));
    if (!mirrored) relabelPad(node, next, dims);
    node.setDirtyCanvas?.(true, true);
  }

  const wrapper: Component = {
    setup() {
      const nodeMode = reactiveFromGraph(
        node as unknown as Parameters<typeof reactiveFromGraph>[0],
        () => node.mode ?? 0,
        Object.is,
      );
      const rootGraph = (): LiteGraphLike | null => {
        const start = (node as unknown as { graph?: LiteGraphLike }).graph ?? (app.graph as unknown as LiteGraphLike);
        return start ? findRootGraph(start) : null;
      };
      const upstreamVars = reactiveFromGraph<string[]>(
        node as unknown as Parameters<typeof reactiveFromGraph>[0],
        () => {
          const g = rootGraph();
          return g ? collectUpstreamVariables(g, node as unknown as LiteNodeLike) : [];
        },
        stringArrayEqual,
      );
      const varProducers = computed(() => {
        void upstreamVars.value;
        const g = rootGraph();
        return g ? new Map(Object.entries(collectUpstreamProducers(g, node as unknown as LiteNodeLike))) : undefined;
      });
      return () => h(SliderPadWidget, {
        modelValue: config.value,
        dims,
        nodeMode: nodeMode.value,
        editRequest: editRequest.value,
        nodeTitle: (node as { title?: string }).title ?? "",
        upstreamVars: upstreamVars.value,
        varProducers: varProducers.value,
        "onUpdate:modelValue": (next: SlidersConfig) => store(padConfig(next, dims)),
      });
    },
  };

  const host = createDomWidgetHost(node, inputName, wrapper, {
    initialValue: serializeWidgetJson(config.value),
    minHeight: 60,
    // The pad's own box (size s / m) raises the floor through `content`.
    sizing: { width: { min: 240, content: true }, height: "content", container: true },
    onValueRestored: (raw: string) => {
      const parsed = padConfig(raw, dims);
      if (JSON.stringify(parsed) === JSON.stringify(config.value)) return;
      config.value = parsed;
      if (!mirrored) relabelPad(node, parsed, dims);
    },
  });

  if (!mirrored) queueMicrotask(() => relabelPad(node, config.value, dims));
  return host;
}
