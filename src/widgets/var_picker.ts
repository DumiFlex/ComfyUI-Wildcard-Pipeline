/**
 * Lazy-loaded glue between ComfyUI's widget pipeline and the VarPicker
 * Vue SFC. Registered via `getCustomWidgets["WP_VAR_PICKER"]` in
 * `src/main.ts` — invoked sync at node creation, returns a `{ widget }`
 * pair where `widget.element` is the host div Vue mounts into.
 *
 * State sources:
 *  - `node.properties.var_name` — persisted "$seed" string (workflow JSON)
 *  - upstream graph walk via `collectUpstreamVariables` — refreshed by
 *    the standard `reactiveFromGraph` poll (~400ms) + connection events.
 *    Drives the dropdown of available `$vars`.
 *  - `executed` event from ComfyUI's API — the Python node emits a
 *    `wp_varpicker_*` UI payload on every run; the widget mirrors that
 *    into its `last execute` strip. Static client-side parsing was
 *    misleading for wildcard-template vars (e.g. `{1|2|3}` parses to
 *    `1` while the engine rolls a real pick), so we now only show
 *    what actually came out of the engine.
 */
import { defineAsyncComponent, h, ref, type Component } from "vue";
import { app } from "#comfyui/app";
import { createDomWidgetHost, type DomWidgetHost, type MountTargetNode } from "./_shared";
import {
  collectUpstreamVariables,
  findRootGraph,
  type LiteGraphLike,
  type LiteNodeLike,
} from "../extension/graph";
import { reactiveFromGraph } from "../extension/reactive";

const VarPicker = defineAsyncComponent(() => import("../components/var-picker/VarPicker.vue"));

interface VarPickerNode extends MountTargetNode, LiteNodeLike {
  properties?: Record<string, unknown>;
  widgets?: { name: string; value: unknown }[];
  mode?: number;
}

interface ExecutedDetail {
  node: string | number;
  output?: Record<string, unknown> | null;
}

interface ExecutedEvent extends Event {
  detail?: ExecutedDetail;
}

function defaultStr(node: VarPickerNode): string {
  const w = node.widgets?.find((x) => x.name === "default");
  return w?.value === undefined ? "" : String(w.value);
}

function upstreamVarsOf(node: VarPickerNode): string[] {
  const startGraph =
    (node as unknown as { graph?: LiteGraphLike }).graph
    ?? (app.graph as unknown as LiteGraphLike);
  if (!startGraph) return [];
  const root = findRootGraph(startGraph);
  return collectUpstreamVariables(root, node).map((n) => `$${n}`);
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Read the first non-undefined value out of an executed-event payload.
 *  ComfyUI normalises ui dicts under either `output.<key>` (array) or
 *  `output.ui.<key>` (array) depending on version + node-kind path. */
function pickFirst(obj: Record<string, unknown>, key: string): unknown {
  const direct = obj[key];
  if (direct !== undefined) return Array.isArray(direct) ? direct[0] : direct;
  const ui = obj.ui as Record<string, unknown> | undefined;
  if (ui) {
    const fromUi = ui[key];
    if (fromUi !== undefined) return Array.isArray(fromUi) ? fromUi[0] : fromUi;
  }
  return undefined;
}

export function create(node: VarPickerNode, inputName: string) {
  if (!node.properties) node.properties = {};
  if (typeof node.properties.var_name !== "string") node.properties.var_name = "";

  // Reactive list of available upstream `$vars`. Refreshes on graph
  // events + 400ms poll (handles wildcard-name edits in upstream Context
  // nodes that don't fire connection events on us).
  const upstreamVars = reactiveFromGraph(node, () => upstreamVarsOf(node), arraysEqual);

  // Track ComfyUI's litegraph mode (0=ALWAYS, 2=NEVER/mute, 4=BYPASS)
  // so the widget visually dims to mirror node-level mute/bypass.
  // Mirrors the cleaner / context / debug widget pattern.
  const nodeMode = reactiveFromGraph(node, () => node.mode ?? 0, Object.is);

  // Last execute payload from the Python node. Stays empty until the
  // workflow runs at least once; flips to live values after each run.
  const previewSource = ref<string>("");
  const previewParsed = ref<string | null>(null);
  const previewDefault = ref<string>(defaultStr(node));
  const hasExecuted = ref<boolean>(false);

  let host: DomWidgetHost | null = null;

  const wrapper: Component = {
    setup() {
      function onUpdate(next: string): void {
        if (!node.properties) node.properties = {};
        node.properties.var_name = next;
        // Keep host.state in sync so getValue (which feeds ComfyUI's
        // execute kwargs) returns the picked name, not the initial
        // empty string.
        host?.setValue(next);
      }
      return () =>
        h(VarPicker, {
          modelValue: String(node.properties?.var_name ?? ""),
          upstreamVars: upstreamVars.value,
          previewSource: hasExecuted.value ? previewSource.value : "",
          previewParsed: hasExecuted.value ? previewParsed.value : null,
          previewDefault: previewDefault.value,
          nodeMode: nodeMode.value,
          "onUpdate:modelValue": onUpdate,
        });
    },
  };

  host = createDomWidgetHost(node, inputName, wrapper, {
    initialValue: String(node.properties?.var_name ?? ""),
    onValueRestored: (v: string) => {
      if (!node.properties) node.properties = {};
      node.properties.var_name = v;
    },
    minHeight: 92,
    minWidth: 260,
  });

  // Subscribe to ComfyUI's "executed" event so the widget's `last
  // execute` strip mirrors what the Python node actually produced this
  // run. The matching `wp_varpicker_*` UI payload is emitted from
  // `wp_nodes/var_to_{int,float,bool}.py:execute()`.
  function onExecuted(ev: Event): void {
    const detail = (ev as ExecutedEvent).detail;
    if (!detail || String(detail.node) !== String(node.id)) return;
    if (!detail.output || typeof detail.output !== "object") return;
    const out = detail.output as Record<string, unknown>;
    const src = pickFirst(out, "wp_varpicker_source");
    const parsed = pickFirst(out, "wp_varpicker_parsed");
    const def = pickFirst(out, "wp_varpicker_default");
    if (typeof src === "string") previewSource.value = src;
    // Python sends `null` when the parser fell back to default — keep
    // the null so the SFC paints the amber "default" state.
    previewParsed.value = typeof parsed === "string" ? parsed : null;
    if (typeof def === "string") previewDefault.value = def;
    hasExecuted.value = true;
  }
  const apiObj = (app as unknown as { api?: {
    addEventListener: (n: string, fn: (e: Event) => void) => void;
    removeEventListener: (n: string, fn: (e: Event) => void) => void;
  } }).api;
  apiObj?.addEventListener("executed", onExecuted);

  return host;
}
