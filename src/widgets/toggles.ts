import { defineAsyncComponent, h, ref, type Component } from "vue";
import { attachRowOutputs, queueRowOutputs, type RowOutputNode } from "../extension/row-outputs";
import { createDomWidgetHost, serializeWidgetJson, type MountTargetNode } from "./_shared";
import { reactiveFromGraph } from "../extension/reactive";
import {
  defaultTogglesConfig,
  normalizeOuts,
  parseTogglesConfig,
  planOutputs,
  toggleRows,
  type TogglesConfig,
} from "../extension/toggles";

const TogglesWidget = defineAsyncComponent(
  () => import("../components/toggles/TogglesWidget.vue"),
);

interface ToggleOutput {
  name: string;
  type: string;
  label?: string;
  links?: number[] | null;
}

export interface TogglesHostNode extends MountTargetNode, RowOutputNode {
  mode?: number;
  outputs?: ToggleOutput[];
  addOutput?: (name: string, type: string) => unknown;
  removeOutput?: (slot: number) => void;
}

/** Output names this node's toggles drive (`toggle_1` … `toggle_16`). */
export const isToggleOutput = (name: string): boolean => /^toggle_\d+$/.test(name);

/** Make the node's outputs match `cfg`: context + one BOOLEAN per pin. */
function fitOutputs(node: TogglesHostNode, cfg: TogglesConfig): void {
  const outs = node.outputs;
  if (!outs || !outs.length) return;
  const want = toggleRows(cfg).filter((t) => t.pin).length + 1;
  while (outs.length > want) {
    // A node still being built has no graph and no links: drop it directly.
    if (node.graph && node.removeOutput) node.removeOutput(outs.length - 1);
    else outs.pop();
  }
  while (outs.length < want && node.addOutput) node.addOutput(`toggle_${outs.length}`, "BOOLEAN");
  relabel(node, cfg);
}

function relabel(node: TogglesHostNode, cfg: TogglesConfig): void {
  const outs = node.outputs ?? [];
  for (const t of toggleRows(cfg)) {
    const slot = t.pin ? outs[t.out] : undefined;
    if (!slot) continue;
    slot.name = `toggle_${t.out}`;
    slot.type = "BOOLEAN";
    slot.label = t.name;
  }
}

/**
 * Mount glue for WP_Toggles' one widget (`WP_TOGGLES`). The value is the
 * JSON `TogglesConfig` the node parses at run time.
 *
 * Owns the node's outputs too: the schema declares 16 BOOLEANs and this
 * keeps one per pinned toggle (`planOutputs` for edits, `fitOutputs` for a
 * new or loaded node), labelled with the toggle's name, and puts each dot
 * at the right edge of its row (`extension/row-outputs.ts`).
 */
export function create(node: TogglesHostNode, inputName: string) {
  const config = ref<TogglesConfig>(defaultTogglesConfig());

  function store(next: TogglesConfig): void {
    config.value = next;
    host.setValue(serializeWidgetJson(next));
  }

  /** Bring outputs and config into line (new node, load, paste, merge). */
  function reconcile(): void {
    const fixed = normalizeOuts(config.value);
    fitOutputs(node, fixed);
    if (JSON.stringify(fixed) !== JSON.stringify(config.value)) store(fixed);
    node.setDirtyCanvas?.(true, true);
    queueRowOutputs();
  }

  function onUpdate(next: TogglesConfig): void {
    const plan = planOutputs(config.value, next);
    for (const slot of plan.remove) {
      if (node.removeOutput) node.removeOutput(slot);
    }
    for (let i = 0; i < plan.add; i++) {
      const n = node.outputs?.length ?? 1;
      node.addOutput?.(`toggle_${n}`, "BOOLEAN");
    }
    relabel(node, plan.config);
    store(plan.config);
    node.setDirtyCanvas?.(true, true);
    queueRowOutputs();
  }

  const wrapper: Component = {
    setup() {
      const nodeMode = reactiveFromGraph(
        node as unknown as Parameters<typeof reactiveFromGraph>[0],
        () => node.mode ?? 0,
        Object.is,
      );
      return () => h(TogglesWidget, {
        modelValue: config.value,
        nodeMode: nodeMode.value,
        "onUpdate:modelValue": onUpdate,
      });
    },
  };

  const host = createDomWidgetHost(node, inputName, wrapper, {
    initialValue: serializeWidgetJson(config.value),
    minHeight: 80,
    minWidth: 300,
    autoHeight: true,
    onValueRestored: (raw: string) => {
      const parsed = normalizeOuts(parseTogglesConfig(raw));
      if (JSON.stringify(parsed) === JSON.stringify(config.value)) return;
      config.value = parsed;
      reconcile();
    },
  });

  // The constructor adds outputs after widgets, so trim them once it is done
  // (a load or paste configures the node in the same task, before this runs).
  queueMicrotask(reconcile);

  host.onCleanup(attachRowOutputs(node, host.element, inputName, isToggleOutput));
  return host;
}
