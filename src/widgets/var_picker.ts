/**
 * Lazy-loaded glue between ComfyUI's widget pipeline and the VarPicker
 * Vue SFC. Registered via `getCustomWidgets["WP_VAR_PICKER"]` in
 * `src/main.ts` — invoked sync at node creation, returns a `{ widget }`
 * pair where `widget.element` is the host div Vue mounts into.
 *
 * State sources:
 *  - `node.properties.var_name` — persisted "$seed" string (workflow JSON)
 *  - upstream graph walk via `collectUpstreamVariables` — refreshed by
 *    the standard `reactiveFromGraph` poll (~400ms) + connection events
 *  - the chosen var's RESOLVED value (post-wildcard-roll) — pulled from
 *    the upstream context snapshot the assembler already computes; we
 *    re-use the same helper (`collectUpstreamResolved`) so the preview
 *    matches what the engine will see at run time.
 *  - parsed preview value — computed locally via the TS mirror parser
 *    (`parser.ts`) so the widget is responsive without server round trips.
 *
 * The kind of parser to run is selected by inspecting `node.type`:
 *   WP_VarToInt  → parseInt
 *   WP_VarToFloat→ parseFloat
 *   WP_VarToBool → parseBool
 */
import { defineAsyncComponent, h, type Component } from "vue";
import { app } from "#comfyui/app";
import { createDomWidgetHost, type DomWidgetHost, type MountTargetNode } from "./_shared";
import {
  collectUpstreamResolved,
  collectUpstreamVariables,
  findRootGraph,
  type LiteGraphLike,
  type LiteNodeLike,
} from "../extension/graph";
import { reactiveFromGraph } from "../extension/reactive";
import { parseBool, parseFloat as parseFloatStr, parseInt as parseIntStr } from "../components/var-picker/parser";

const VarPicker = defineAsyncComponent(() => import("../components/var-picker/VarPicker.vue"));

interface VarPickerNode extends MountTargetNode, LiteNodeLike {
  properties?: Record<string, unknown>;
  widgets?: { name: string; value: unknown }[];
}

interface PickerSnapshot {
  upstreamVars: string[];
  previewSource: string;
  previewParsed: string | null;
  previewDefault: string;
}

function indexOf(node: VarPickerNode): number {
  const w = node.widgets?.find((x) => x.name === "index");
  const n = Number(w?.value);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0;
}

function defaultStr(node: VarPickerNode): string {
  const w = node.widgets?.find((x) => x.name === "default");
  return w?.value === undefined ? "" : String(w.value);
}

function previewParsedFor(node: VarPickerNode, source: string): string | null {
  if (!source) return null;
  const idx = indexOf(node);
  if (node.type === "WP_VarToInt") {
    const parsed = parseIntStr(source, idx, Number.NaN);
    return Number.isNaN(parsed) ? null : String(parsed);
  }
  if (node.type === "WP_VarToFloat") {
    const parsed = parseFloatStr(source, idx, Number.NaN);
    return Number.isNaN(parsed) ? null : String(parsed);
  }
  if (node.type === "WP_VarToBool") {
    // Distinguish "fell back to default" from "parsed False": run twice
    // with sentinel defaults; mismatch means no real bool token at idx.
    const a = parseBool(source, idx, true);
    const b = parseBool(source, idx, false);
    if (a === b) return String(a);
    return null;
  }
  return null;
}

function snapshotsEqual(a: PickerSnapshot, b: PickerSnapshot): boolean {
  if (a.previewSource !== b.previewSource) return false;
  if (a.previewParsed !== b.previewParsed) return false;
  if (a.previewDefault !== b.previewDefault) return false;
  if (a.upstreamVars.length !== b.upstreamVars.length) return false;
  for (let i = 0; i < a.upstreamVars.length; i++) {
    if (a.upstreamVars[i] !== b.upstreamVars[i]) return false;
  }
  return true;
}

function computeSnapshot(node: VarPickerNode): PickerSnapshot {
  const startGraph =
    (node as unknown as { graph?: LiteGraphLike }).graph
    ?? (app.graph as unknown as LiteGraphLike);
  if (!startGraph) {
    return { upstreamVars: [], previewSource: "", previewParsed: null, previewDefault: defaultStr(node) };
  }
  const root = findRootGraph(startGraph);
  const upstreamVars = collectUpstreamVariables(root, node).map((n) => `$${n}`);
  const resolved = (collectUpstreamResolved(root, node) ?? {}) as Record<string, string | undefined>;
  const bare = String(node.properties?.var_name ?? "").replace(/^\$+/, "");
  const src = bare && bare in resolved ? String(resolved[bare] ?? "") : "";
  return {
    upstreamVars,
    previewSource: src,
    previewParsed: previewParsedFor(node, src),
    previewDefault: defaultStr(node),
  };
}

export function create(node: VarPickerNode, inputName: string) {
  if (!node.properties) node.properties = {};
  if (typeof node.properties.var_name !== "string") node.properties.var_name = "";

  // Reactive snapshot — refreshes on connection events + 400ms poll
  // + workflow-load. Recomputes upstream vars, source value, parsed
  // preview, and default literal in one pass so the SFC always reads
  // a consistent view.
  const snapshot = reactiveFromGraph(node, () => computeSnapshot(node), snapshotsEqual);

  // Forward-declared so the wrapper's onUpdate closure can call
  // `host.setValue(next)` and keep ComfyUI's widget state aligned with
  // `node.properties.var_name`. Without `setValue`, the host's internal
  // `state` stays at its initial empty string and `execute()` receives
  // `""` regardless of what the user picked — preview would look right
  // (it reads `node.properties` directly) but the node would always
  // fall through to `default`. Closure binding resolves to the assigned
  // value by the time the user fires a pick.
  let host: DomWidgetHost | null = null;

  const wrapper: Component = {
    setup() {
      function onUpdate(next: string): void {
        if (!node.properties) node.properties = {};
        node.properties.var_name = next;
        // Keep host.state in lock-step with node.properties so getValue
        // (which feeds ComfyUI's execute kwargs) returns the picked
        // name, not the initial empty string.
        host?.setValue(next);
        // Trigger an immediate snapshot refresh so the preview updates
        // without waiting for the 400ms poll.
        snapshot.value = computeSnapshot(node);
      }
      return () =>
        h(VarPicker, {
          modelValue: String(node.properties?.var_name ?? ""),
          upstreamVars: snapshot.value.upstreamVars,
          previewSource: snapshot.value.previewSource,
          previewParsed: snapshot.value.previewParsed,
          previewDefault: snapshot.value.previewDefault,
          "onUpdate:modelValue": onUpdate,
        });
    },
  };

  host = createDomWidgetHost(node, inputName, wrapper, {
    initialValue: String(node.properties?.var_name ?? ""),
    onValueRestored: (v: string) => {
      // ComfyUI restored the widget value from workflow JSON. Mirror
      // it back into node.properties so downstream code reading either
      // path sees the same value. `host.state` is already in sync —
      // ComfyUI's restore path sets it before calling this hook.
      if (!node.properties) node.properties = {};
      node.properties.var_name = v;
      snapshot.value = computeSnapshot(node);
    },
    minHeight: 92,
    minWidth: 260,
  });
  return host;
}
