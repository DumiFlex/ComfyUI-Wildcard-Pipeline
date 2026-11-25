import { computed, defineAsyncComponent, h, ref, watch, type Component } from "vue";
import { app } from "#comfyui/app";
import {
  collectUpstreamProducers,
  collectUpstreamVariables,
  findRootGraph,
  type LiteGraphLike,
  type LiteNodeLike,
} from "../extension/graph";
import { attachRowOutputs, queueRowOutputs, type RowOutputNode } from "../extension/row-outputs";
import { attachFieldSockets, type FieldSocketNode } from "../extension/field-sockets";
import {
  ctlInputName,
  focusSpots,
  groupTitles,
  isCtlInput,
  type ControlState,
  type CtlNode,
  type FocusSpotView,
} from "../extension/toggle-control";
import {
  applySliderControl,
  releaseSliderTargets,
  sliderControlState,
  sliderWiring,
  wantedSliderCtlInputs,
} from "../extension/slider-control";
import { jumpToRect } from "./bookmark";
import { createDomWidgetHost, isMirrorBuild, serializeWidgetJson, type MountTargetNode } from "./_shared";
import { nodeEditors } from "../extension/_stashes";
import { reactiveFromGraph, stringArrayEqual } from "../extension/reactive";
import {
  defaultSlidersConfig,
  hasSliderDot,
  levelGroups,
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
  addInput?: (name: string, type: string) => unknown;
  removeInput?: (slot: number) => void;
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
  // A level dot's tooltip says the slider's name, not its `ctl_<id>`.
  for (const s of sliderRows(cfg)) {
    const input: { name: string; label?: string; localized_name?: string } | undefined = hasSliderDot(s)
      ? node.inputs?.find((i) => i.name === ctlInputName(s.id))
      : undefined;
    if (input) {
      input.label = s.name;
      input.localized_name = s.name;
    }
  }
}

/** Make the node's `ctl_*` inputs match the sliders whose levels mute or
 *  bypass. `names` (shared with the field sockets) is updated in place. */
function fitCtlInputs(node: SlidersHostNode, cfg: SlidersConfig, names: string[]): void {
  const want = wantedSliderCtlInputs(cfg);
  const inputs = node.inputs ?? [];
  for (let i = inputs.length - 1; i >= 0; i--) {
    const name = inputs[i]?.name ?? "";
    if (isCtlInput(name) && !want.includes(name)) node.removeInput?.(i);
  }
  for (const name of want) {
    if (!(node.inputs ?? []).some((i) => i.name === name)) node.addInput?.(name, "*");
  }
  names.splice(0, names.length, ...want);
}

function sameWiring(a: Map<string, CtlNode[]>, b: Map<string, CtlNode[]>): boolean {
  if (a.size !== b.size) return false;
  for (const [id, list] of a) {
    const other = b.get(id);
    if (!other || other.length !== list.length || list.some((n, i) => n !== other[i])) return false;
  }
  return true;
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
  /** `ctl_*` input names, shared with `attachFieldSockets`. */
  const ctlNames: string[] = [];
  const ctlNode = node as unknown as CtlNode;
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
    fitCtlInputs(node, fixed, ctlNames);
    if (JSON.stringify(fixed) !== JSON.stringify(config.value)) store(fixed);
    node.setDirtyCanvas?.(true, true);
    queueRowOutputs();
  }

  function onUpdate(next: SlidersConfig): void {
    const before = sliderWiring(ctlNode, config.value);
    const plan = planOutputs(config.value, next);
    const outsChange = plan.remove.length > 0 || plan.add > 0;
    for (const slot of plan.remove) node.removeOutput?.(slot);
    for (let i = 0; i < plan.add; i++) {
      const n = node.outputs?.length ?? 1;
      node.addOutput?.(`value_${n}`, "FLOAT");
    }
    fitCtlInputs(node, plan.config, ctlNames);
    relabel(node, plan.config);
    store(plan.config);
    // Nodes a slider stops driving (a level or group gone) run again; the
    // rest follow the values.
    const kept = new Set([...sliderWiring(ctlNode, plan.config).values()].flat());
    releaseSliderTargets([...new Set([...before.values()].flat())].filter((n) => !kept.has(n)));
    applySliderControl(ctlNode, plan.config);
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
      // What each slider drives, polled like WP Toggles: links into the
      // level dots don't reliably raise onConnectionsChange on V3 nodes.
      const drives = reactiveFromGraph(
        node as unknown as Parameters<typeof reactiveFromGraph>[0],
        () => sliderWiring(ctlNode, config.value),
        sameWiring,
      );
      if (!mirrored) watch(drives, (now, was) => {
        const cur = new Set([...now.values()].flat());
        const old = new Set([...was.values()].flat());
        const gone = [...old].filter((n) => !cur.has(n));
        releaseSliderTargets(gone);
        if ([...cur].some((n) => !old.has(n))) applySliderControl(ctlNode, config.value);
      });
      const canvasGroups = reactiveFromGraph(
        node as unknown as Parameters<typeof reactiveFromGraph>[0],
        () => groupTitles(ctlNode.graph),
        (a, b) => a.join("\u0000") === b.join("\u0000"),
      );
      const varProducers = computed(() => {
        void upstreamVars.value;
        const g = rootGraph();
        return g ? new Map(Object.entries(collectUpstreamProducers(g, node as unknown as LiteNodeLike))) : undefined;
      });
      return () => {
        void drives.value;
        const controls: Record<string, ControlState> = {};
        const spots: Record<string, FocusSpotView[]> = {};
        for (const s of sliderRows(config.value)) {
          const st = sliderControlState(ctlNode, s);
          if (!st) continue;
          controls[s.id] = st;
          spots[s.id] = focusSpots(ctlNode, s.id, levelGroups(s), hasSliderDot(s)).map(({ key, label, kind, count }) => ({ key, label, kind, count }));
        }
        return h(SlidersWidget, {
        modelValue: config.value,
        controls,
        focusSpots: spots,
        canvasGroups: canvasGroups.value,
        onFocusTarget: (rowId: string, key: string) => focusTarget(ctlNode, config.value, rowId, key),
        nodeMode: nodeMode.value,
        editRequest: editRequest.value,
        nodeTitle: (node as { title?: string }).title ?? "",
        upstreamVars: upstreamVars.value,
        varProducers: varProducers.value,
        "onUpdate:modelValue": onUpdate,
        });
      };
    },
  };

  const host = createDomWidgetHost(node, inputName, wrapper, {
    initialValue: serializeWidgetJson(config.value),
    minHeight: 60,
    // Rows stack their name over the track below 300 px (SliderRow.vue).
    sizing: { width: { min: 260, content: true }, height: "content", breakpoints: { narrow: 300 }, container: true },
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
  host.onCleanup(attachFieldSockets(node as unknown as FieldSocketNode, host.element, inputName, ctlNames));
  return host;
}

/** Glide the canvas to one of a slider's mute / bypass targets. */
function focusTarget(node: CtlNode, cfg: SlidersConfig, rowId: string, key: string): void {
  const s = sliderRows(cfg).find((r) => r.id === rowId);
  if (!s) return;
  const spot = focusSpots(node, s.id, levelGroups(s), hasSliderDot(s)).find((p) => p.key === key);
  if (spot) jumpToRect(node.graph as LiteGraphLike | null | undefined, spot.rect);
}
