import { defineAsyncComponent, h, ref, type Component } from "vue";
import { app } from "#comfyui/app";
import { createDomWidgetHost, serializeWidgetJson, type MountTargetNode } from "./_shared";
import { reactiveFromGraph } from "../extension/reactive";
import {
  defaultModelInfoConfig,
  parseModelInfoConfig,
  recordModelInfoRun,
  lastModelInfoRun,
  loaderFileName,
  type ModelInfoConfig,
  type ModelInfoRun,
} from "../extension/model-info";
import type { LiteGraphLike } from "../extension/graph";

const ModelInfoWidget = defineAsyncComponent(
  () => import("../components/model-info/ModelInfoWidget.vue"),
);

interface ModelInfoHostNode extends MountTargetNode {
  id?: string | number;
  mode?: number;
  graph?: LiteGraphLike;
  inputs?: { name: string; link: number | null }[];
}

/**
 * Mount glue for WP_ModelInfo's one widget (`WP_MODEL_INFO`). The value is
 * the JSON `ModelInfoConfig` (rule rows + pins) the node parses at run time.
 *
 * The widget also shows what the node will write. The canvas reads the
 * loader's file name live; the family needs the loaded model, so it comes
 * from the last run's `wp_model_info` UI payload (`wp_nodes/model_info_node.py`),
 * which is also recorded for the graph walkers' preview.
 */
export function create(node: ModelInfoHostNode, inputName: string) {
  const config = ref<ModelInfoConfig>(defaultModelInfoConfig());
  const lastRun = ref<ModelInfoRun | null>(lastModelInfoRun(node));

  const wrapper: Component = {
    setup() {
      const nodeMode = reactiveFromGraph(
        node as unknown as Parameters<typeof reactiveFromGraph>[0],
        () => node.mode ?? 0,
        Object.is,
      );
      const loaderName = reactiveFromGraph(
        node as unknown as Parameters<typeof reactiveFromGraph>[0],
        () => loaderFileName(node as Parameters<typeof loaderFileName>[0], node.graph as Parameters<typeof loaderFileName>[1]),
        Object.is,
      );
      const modelWired = reactiveFromGraph(
        node as unknown as Parameters<typeof reactiveFromGraph>[0],
        () => node.inputs?.find((i) => i.name === "model")?.link != null,
        Object.is,
      );
      function onUpdate(next: ModelInfoConfig): void {
        config.value = next;
        host.setValue(serializeWidgetJson(next));
      }
      return () => h(ModelInfoWidget, {
        modelValue: config.value,
        loaderName: loaderName.value,
        modelWired: modelWired.value,
        lastRun: lastRun.value,
        nodeMode: nodeMode.value,
        "onUpdate:modelValue": onUpdate,
      });
    },
  };

  const host = createDomWidgetHost(node, inputName, wrapper, {
    initialValue: serializeWidgetJson(config.value),
    minHeight: 220,
    minWidth: 330,
    autoHeight: true,
    onValueRestored: (raw: string) => {
      config.value = parseModelInfoConfig(raw);
    },
  });

  type ExecutedEvent = CustomEvent<{ node: string | number; output?: unknown }>;
  function onExecuted(ev: Event) {
    const detail = (ev as ExecutedEvent).detail;
    if (!detail || String(detail.node) !== String(node.id)) return;
    const out = detail.output as Record<string, unknown> | undefined;
    const raw = out?.wp_model_info;
    const run = Array.isArray(raw) ? raw[0] : raw;
    if (!run || typeof run !== "object") return;
    const r = run as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === "string" ? v : "");
    const next: ModelInfoRun = {
      family: str(r.family),
      variant: str(r.variant),
      name: str(r.name),
      sources: (r.sources && typeof r.sources === "object" ? r.sources : {}) as ModelInfoRun["sources"],
    };
    recordModelInfoRun(node, next);
    lastRun.value = next;
  }
  const apiObj = (app as unknown as { api?: {
    addEventListener: (n: string, fn: (e: Event) => void) => void;
  } }).api;
  apiObj?.addEventListener("executed", onExecuted);

  return host;
}
