import { computed, defineAsyncComponent, h, ref, type Component } from "vue";
import { app } from "#comfyui/app";
import {
  collectUpstreamProducers,
  collectUpstreamVariables,
  findRootGraph,
  type LiteGraphLike,
  type LiteNodeLike,
} from "../extension/graph";
import { attachRowOutputs, queueRowOutputs, type RowOutputNode } from "../extension/row-outputs";
import { createDomWidgetHost, isMirrorBuild, serializeWidgetJson, type MountTargetNode } from "./_shared";
import { nodeEditors } from "../extension/_stashes";
import { reactiveFromGraph, stringArrayEqual } from "../extension/reactive";
import {
  defaultSlidersConfig,
  normalizeOuts,
  parseSlidersConfig,
  planOutputs,
  sliderOutputType,
  sliderRows,
  type SlidersConfig,
} from "../extension/sliders";

const SlidersWidget = defineAsyncComponent(
  () => import("../components/sliders/SlidersWidget.vue"),
);

interface SliderOutput {
  name: string;
  type: string;
  label?: string;
  localized_name?: string;
  links?: number[] | null;
}

export interface SlidersHostNode extends MountTargetNode, RowOutputNode {
  mode?: number;
  outputs?: SliderOutput[];
  addOutput?: (name: string, type: string) => unknown;
  removeOutput?: (slot: number) => void;
}

/** Output names this node's sliders drive (`value_1` … `value_16`). */
export const isSliderOutput = (name: string): boolean => /^value_\d+$/.test(name);

/** Make the node's outputs match `cfg`: context + one number per pin. */
function fitOutputs(node: SlidersHostNode, cfg: SlidersConfig): void {
  const outs = node.outputs;
  if (!outs || !outs.length) return;
  const want = sliderRows(cfg).filter((s) => s.pin).length + 1;
  while (outs.length > want) {
    if (node.graph && node.removeOutput) node.removeOutput(outs.length - 1);
    else outs.pop();
  }
  while (outs.length < want && node.addOutput) node.addOutput(`value_${outs.length}`, "FLOAT");
  relabel(node, cfg);
}

/** Name, label and type (INT or FLOAT, `sliderOutputType`) of each pinned
 *  slider's output. The schema says `*`, so any number input takes it. */
function relabel(node: SlidersHostNode, cfg: SlidersConfig): void {
  const outs = node.outputs ?? [];
  for (const s of sliderRows(cfg)) {
    const slot = s.pin ? outs[s.out] : undefined;
    if (!slot) continue;
    slot.name = `value_${s.out}`;
    slot.type = sliderOutputType(s);
    slot.label = s.name;
    slot.localized_name = s.name;
  }
}

/**
 * Mount glue for WP_Slider's one widget (`WP_SLIDERS`). The value is the
 * JSON `SlidersConfig` the node parses at run time.
 *
 * Owns the node's outputs too: the schema declares 16 `*` outputs and this
 * keeps one per pinned slider (`planOutputs` for edits, `fitOutputs` for a
 * new or loaded node), labelled with the slider's name and typed from its
 * decimals, and puts each dot at the right edge of its row
 * (`extension/row-outputs.ts`).
 */
export function create(node: SlidersHostNode, inputName: string) {
  const mirrored = isMirrorBuild(node);
  const config = ref<SlidersConfig>(defaultSlidersConfig());
  const editRequest = ref(0);
  if (!mirrored) {
    nodeEditors.set(node, () => {
      editRequest.value += 1;
    });
  }

  function store(next: SlidersConfig): void {
    config.value = next;
    host.setValue(serializeWidgetJson(next));
  }

  function reconcile(): void {
    const fixed = normalizeOuts(config.value);
    fitOutputs(node, fixed);
    if (JSON.stringify(fixed) !== JSON.stringify(config.value)) store(fixed);
    node.setDirtyCanvas?.(true, true);
    queueRowOutputs();
  }

  function onUpdate(next: SlidersConfig): void {
    const plan = planOutputs(config.value, next);
    const outsChange = plan.remove.length > 0 || plan.add > 0;
    for (const slot of plan.remove) node.removeOutput?.(slot);
    for (let i = 0; i < plan.add; i++) {
      const n = node.outputs?.length ?? 1;
      node.addOutput?.(`value_${n}`, "FLOAT");
    }
    relabel(node, plan.config);
    store(plan.config);
    node.setDirtyCanvas?.(true, true);
    if (outsChange) queueRowOutputs();
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
      return () => h(SlidersWidget, {
        modelValue: config.value,
        nodeMode: nodeMode.value,
        editRequest: editRequest.value,
        nodeTitle: (node as { title?: string }).title ?? "",
        upstreamVars: upstreamVars.value,
        varProducers: varProducers.value,
        "onUpdate:modelValue": onUpdate,
      });
    },
  };

  const host = createDomWidgetHost(node, inputName, wrapper, {
    initialValue: serializeWidgetJson(config.value),
    minHeight: 60,
    minWidth: 320,
    autoHeight: true,
    onValueRestored: (raw: string) => {
      const parsed = normalizeOuts(parseSlidersConfig(raw));
      if (JSON.stringify(parsed) === JSON.stringify(config.value)) return;
      config.value = parsed;
      if (!mirrored) reconcile();
    },
  });

  // The constructor adds outputs after widgets, so trim them once it is done.
  if (mirrored) return host;
  queueMicrotask(reconcile);
  host.onCleanup(attachRowOutputs(node, host.element, inputName, isSliderOutput));
  return host;
}
