import { defineAsyncComponent, h, ref, watch, type Component } from "vue";
import { attachRowOutputs, queueRowOutputs, type RowOutputNode } from "../extension/row-outputs";
import { attachFieldSockets, type FieldSocketNode } from "../extension/field-sockets";
import {
  applyControl,
  controlState,
  type ControlState,
  groupTitles,
  isCtlInput,
  releaseTargets,
  toggleTargets,
  wantedCtlInputs,
  type CtlNode,
} from "../extension/toggle-control";
import { createDomWidgetHost, serializeWidgetJson, type MountTargetNode } from "./_shared";
import { reactiveFromGraph } from "../extension/reactive";
import {
  effectiveToggles,
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
  addInput?: (name: string, type: string) => unknown;
  removeInput?: (slot: number) => void;
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

/** Make the node's `ctl_*` inputs match the toggles that mute or bypass.
 *  `names` (shared with the field sockets) is updated in place. */
function fitCtlInputs(node: TogglesHostNode, cfg: TogglesConfig, names: string[]): void {
  const want = wantedCtlInputs(cfg);
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

/** Toggle id → the ids of the nodes it drives right now. */
function wiring(node: TogglesHostNode, cfg: TogglesConfig): Map<string, CtlNode[]> {
  const out = new Map<string, CtlNode[]>();
  for (const t of toggleRows(cfg)) {
    if (t.control) out.set(t.id, toggleTargets(node as unknown as CtlNode, t.id, t.groups));
  }
  return out;
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
  /** `ctl_*` input names, shared with `attachFieldSockets`. */
  const ctlNames: string[] = [];
  const ctlNode = node as unknown as CtlNode;

  function store(next: TogglesConfig): void {
    config.value = next;
    host.setValue(serializeWidgetJson(next));
  }

  /** Bring outputs and config into line (new node, load, paste, merge). */
  function reconcile(): void {
    const fixed = normalizeOuts(config.value);
    fitOutputs(node, fixed);
    fitCtlInputs(node, fixed, ctlNames);
    if (JSON.stringify(fixed) !== JSON.stringify(config.value)) store(fixed);
    node.setDirtyCanvas?.(true, true);
    queueRowOutputs();
  }

  function onUpdate(next: TogglesConfig): void {
    const before = wiring(node, config.value);
    const prevRows = new Map(toggleRows(config.value).map((t) => [t.id, t]));
    const plan = planOutputs(config.value, next);
    for (const slot of plan.remove) {
      if (node.removeOutput) node.removeOutput(slot);
    }
    for (let i = 0; i < plan.add; i++) {
      const n = node.outputs?.length ?? 1;
      node.addOutput?.(`toggle_${n}`, "BOOLEAN");
    }
    relabel(node, plan.config);
    // A toggle that stops muting / bypassing (or switches which) lets go of
    // the nodes it held before the new setting takes them.
    const nextRows = new Map(toggleRows(plan.config).map((t) => [t.id, t]));
    for (const [id, targets] of before) {
      const was = prevRows.get(id);
      const now = nextRows.get(id);
      if (!was?.control) continue;
      const kept = now?.control === was.control ? new Set(wiring(node, plan.config).get(id) ?? []) : new Set<CtlNode>();
      releaseTargets(targets.filter((t) => !kept.has(t)), was.control);
    }
    fitCtlInputs(node, plan.config, ctlNames);
    store(plan.config);
    applyControl(ctlNode, plan.config);
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
      // What each controlled toggle drives, polled: links to the control
      // dots don't reliably raise onConnectionsChange on V3 nodes. A target
      // that appears gets the toggle's mode; one that goes runs again.
      const drives = reactiveFromGraph(
        node as unknown as Parameters<typeof reactiveFromGraph>[0],
        () => wiring(node, config.value),
        sameWiring,
      );
      watch(drives, (now, was) => {
        for (const t of toggleRows(config.value)) {
          if (!t.control) continue;
          const old = new Set(was.get(t.id) ?? []);
          const cur = new Set(now.get(t.id) ?? []);
          releaseTargets([...old].filter((n) => !cur.has(n)), t.control);
          if ([...cur].some((n) => !old.has(n))) applyControl(ctlNode, config.value, new Set([t.id]));
        }
      });
      const canvasGroups = reactiveFromGraph(
        node as unknown as Parameters<typeof reactiveFromGraph>[0],
        () => groupTitles(ctlNode.graph),
        (a, b) => a.join("\u0000") === b.join("\u0000"),
      );
      return () => {
        const controls: Record<string, ControlState> = {};
        const eff = effectiveToggles(config.value);
        for (const t of toggleRows(config.value)) {
          if (!t.control) continue;
          const st = controlState(drives.value.get(t.id) ?? [], t.control, t.groups ?? [], !!eff.get(t.id), t.invert);
          if (st) controls[t.id] = st;
        }
        void drives.value;
        return h(TogglesWidget, {
          modelValue: config.value,
          nodeMode: nodeMode.value,
          controls,
          canvasGroups: canvasGroups.value,
          "onUpdate:modelValue": onUpdate,
        });
      };
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
  host.onCleanup(attachFieldSockets(node as unknown as FieldSocketNode, host.element, inputName, ctlNames));
  return host;
}

function sameWiring(a: Map<string, CtlNode[]>, b: Map<string, CtlNode[]>): boolean {
  if (a.size !== b.size) return false;
  for (const [id, list] of a) {
    const other = b.get(id);
    if (!other || other.length !== list.length || list.some((n, i) => n !== other[i])) return false;
  }
  return true;
}
